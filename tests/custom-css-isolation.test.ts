import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { analyzeSessionCSS, removeCssImports, scopeSessionCSS, validateSessionCSS } from "../lib/chat/custom-css";
import { legacyRemoveCssImports, legacyScopeSessionCSS } from "./custom-css-legacy";

const SCOPE = ".chat-room-wrapper";

function topLevelSelectors(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  return [...parts, text.slice(start)];
}

/** Everything the browser would apply from this CSS that is not confined to the scope. */
function leaks(css: string): string[] {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  const style = dom.window.document.createElement("style");
  style.textContent = css;
  dom.window.document.head.append(style);
  const found: string[] = [];
  // Independent oracle: a real selector engine against elements next to and around the root.
  const probe = new JSDOM(`<!doctype html><html class="dark"><body class="dark"><header class="x dark" id="before"></header>
    <div class="chat-room-wrapper dark" data-a="1"><span class="a b x dark" id="inside"></span></div>
    <p class="x a dark" id="after"></p><p class="b" id="after2"></p></body></html>`);
  const root = probe.window.document.querySelector(SCOPE)!;
  const outside = (selector: string) => {
    try {
      return [...probe.window.document.querySelectorAll(selector)].some((el) => el !== root && !root.contains(el));
    } catch { return false; } // an invalid selector matches nothing in the browser either
  };
  const walk = (rules: ArrayLike<CSSRule>) => {
    for (const rule of Array.from(rules)) {
      const text = rule.cssText.trimStart();
      if (/^@layer[^{]*;$/i.test(text)) continue;
      if (/^@import/i.test(text)) found.push("import");
      else if (/^@font-face/i.test(text)) found.push("font-face");
      else if (/^@(?:-webkit-)?keyframes/i.test(text)) {
        if (!/^@(?:-webkit-)?keyframes\s+veil-session-/i.test(text)) found.push("keyframes");
      } else if ("selectorText" in rule && typeof (rule as CSSStyleRule).selectorText === "string") {
        for (const selector of topLevelSelectors((rule as CSSStyleRule).selectorText)) {
          const trimmed = selector.trim();
          const rest = trimmed.startsWith(SCOPE) ? trimmed.slice(SCOPE.length).trimStart() : null;
          if (rest === null || /^[+~]/.test(rest) || outside(trimmed)) found.push(`selector:${trimmed}`);
        }
      } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      else found.push(`other:${text.slice(0, 20)}`);
    }
  };
  walk(style.sheet!.cssRules);
  dom.window.close(); probe.window.close();
  return found;
}

const hostile: Record<string, string> = {
  "uppercase import": '@IMPORT url("https://evil.test/x.css"); .a { color: red }',
  "mixed-case import": "@ImPoRt 'https://evil.test/x.css'; .a { color: red }",
  "escaped import": '@\\69mport url("https://evil.test/x.css"); .a { color: red }',
  "font-face": '@font-face { font-family: "Inter"; src: url(https://evil.test/f.woff2) }',
  "uppercase font-face": "@FONT-FACE { font-family: x; src: local(y) }",
  "unprefixed keyframes": "@keyframes spin { to { opacity: 0 } } .a { animation: spin 1s }",
  "brace inside string": '.a { content: "}" } body { background: red } .b { color: blue }',
  "brace inside comment": ".a { color: red /* } */ } html { background: red }",
  "brace inside url": ".a { background: url(data:image/svg+xml;x}) } body { margin: 0 }",
  "escaped brace": ".a { content: \\} } body { margin: 0 }",
  "sibling of the root": `${SCOPE} ~ .x { display: none }`,
  "sibling via body": "body ~ .x { display: none }",
  "root sibling combinator": "html + body { display: none }",
  "comment hides sibling combinator": "body /**/ ~ .x { display: none }",
  "comment before leading combinator": "/**/+ .x { display: none }",
  "root pseudo-class then sibling": ":root:not(.missing) ~ * { display: none }",
  "root class then sibling": "html.dark ~ * { display: none }",
  "root :has then sibling": "body:has(.a)~* { display: none }",
  "scope attribute then sibling": `${SCOPE}[data-a] ~ * { display: none }`,
  "leading sibling combinator": "+ .x { display: none }",
  "scope literal sibling": `${SCOPE} + .x { display: none }`,
  "nested at-rule leak": "@media screen { @import 'x.css'; body ~ .x { color: red } }",
  "global at-rules": "@property --x { syntax: '<color>'; inherits: false; initial-value: red } @page { margin: 0 }",
};

test("@import in any case or escaped form is rejected with a clear error and never emitted", () => {
  for (const css of [hostile["uppercase import"], hostile["mixed-case import"], hostile["escaped import"]]) {
    const result = analyzeSessionCSS(css, SCOPE);
    assert.match(result.errors.join(" "), /@import is not supported/);
    assert.doesNotMatch(result.css, /import|evil\.test/i);
    assert.match(result.css, /\.chat-room-wrapper \.a \{ color: red \}/, "the safe rule beside it is preserved");
    assert.deepEqual(leaks(result.css), []);
  }
  assert.doesNotMatch(removeCssImports('@IMPORT url("https://evil.test/x.css");\n.a{}'), /evil\.test/i);
  assert.deepEqual(validateSessionCSS(".a { color: red }"), []);
});

test("global at-rules are renamed (keyframes) or safely rejected (font-face, property, page, namespace, unknown)", () => {
  const keyframes = analyzeSessionCSS("@keyframes spin { to { opacity: 0 } } .a { animation: spin 1s linear; animation-name: spin, other }", SCOPE);
  assert.deepEqual(keyframes.errors, []);
  assert.match(keyframes.css, /@keyframes veil-session-spin \{/);
  assert.match(keyframes.css, /animation: veil-session-spin 1s linear/);
  assert.match(keyframes.css, /animation-name: veil-session-spin, other/);
  assert.deepEqual(leaks(keyframes.css), []);
  for (const [css, name] of [[hostile["font-face"], "font-face"], [hostile["uppercase font-face"], "font-face"],
    ["@property --x { syntax: '*'; inherits: false }", "property"], ["@page { margin: 0 }", "page"],
    ["@namespace svg url(http://www.w3.org/2000/svg);", "namespace"], ["@charset 'utf-8';", "charset"],
    ["@scope (.a) { .b { color: red } }", "scope"], ["@mystery { .a { color: red } }", "mystery"]]) {
    const result = analyzeSessionCSS(css, SCOPE);
    assert.match(result.errors.join(" "), new RegExp(`@${name} is not supported`));
    assert.equal(result.css.trim(), "", `${name} must not be emitted`);
  }
});

test("ordinary selectors and allowed nesting keep working", () => {
  const source = `:root { --bubble: pink; }
body.dark .chat-bubble-role-user, .chat-input-bar { color: red; }
.list:is(.a, .b) > li:not(.x, .y) { margin: 0 }
.card { color: red; &:hover { color: blue } .title { font-weight: 600 } @media (width < 400px) { padding: 0 } }
@media (max-width: 500px) { .chat-bubble-role-assistant { padding: 8px; } }
@supports (display: grid) { .grid { display: grid } }
@layer base { .a { color: green } }
@layer one, two;
@container (min-width: 300px) { .c { color: teal } }
/* comment with } and { */ .d[data-x="a,b"] { color: red }`;
  const result = analyzeSessionCSS(source, SCOPE);
  assert.deepEqual(result.errors, []);
  assert.match(result.css, /\.chat-room-wrapper \{ --bubble: pink; \}/);
  assert.match(result.css, /\.chat-room-wrapper\.dark \.chat-bubble-role-user, \.chat-room-wrapper \.chat-input-bar/);
  assert.match(result.css, /\.chat-room-wrapper \.list:is\(\.a, \.b\) > li:not\(\.x, \.y\) \{/);
  assert.match(result.css, /\.chat-room-wrapper \.card \{ color: red; &:hover \{ color: blue \} \.title \{ font-weight: 600 \} @media \(width < 400px\) \{ padding: 0 \} \}/);
  assert.match(result.css, /@media \(max-width: 500px\) \{ \.chat-room-wrapper \.chat-bubble-role-assistant/);
  assert.match(result.css, /@supports \(display: grid\) \{ \.chat-room-wrapper \.grid/);
  assert.match(result.css, /@layer base \{ \.chat-room-wrapper \.a/);
  assert.match(result.css, /@layer one, two;/);
  assert.match(result.css, /@container \(min-width: 300px\) \{ \.chat-room-wrapper \.c/);
  assert.match(result.css, /\.chat-room-wrapper \.d\[data-x="a,b"\]/);
  assert.deepEqual(leaks(result.css), []);
  assert.equal(scopeSessionCSS("", SCOPE), "");
  assert.doesNotThrow(() => scopeSessionCSS(".broken { color: red", SCOPE));
});

test("hostile or malformed CSS cannot style anything outside the conversation root", () => {
  for (const [name, css] of Object.entries(hostile)) {
    const result = analyzeSessionCSS(css, SCOPE);
    assert.deepEqual(leaks(result.css), [], `${name} leaked: ${result.css}`);
  }
  for (const name of ["sibling of the root", "sibling via body", "root sibling combinator", "leading sibling combinator", "scope literal sibling",
    "comment hides sibling combinator", "comment before leading combinator", "root pseudo-class then sibling",
    "root class then sibling", "root :has then sibling", "scope attribute then sibling"]) {
    const result = analyzeSessionCSS(hostile[name], SCOPE);
    assert.match(result.errors.join(" "), /reach outside this conversation/, name);
    assert.equal(result.css.trim(), "");
  }
  for (const css of ["</style><script>alert(1)</script>", ".a { color: red } <!--"]) {
    const result = analyzeSessionCSS(css, SCOPE);
    assert.match(result.errors.join(" "), /<\/style/);
    assert.equal(result.css, "");
  }
  // The string/comment/url cases keep the safe rules and scope the one that follows.
  assert.match(analyzeSessionCSS(hostile["brace inside string"], SCOPE).css, /\.chat-room-wrapper \{ background: red \}/);
  // Real computed style: elements outside the root are untouched, inside they are styled.
  const dom = new JSDOM(`<body><div class="chat-room-wrapper"><p class="b">in</p></div><p class="b" id="out">out</p></body>`);
  const style = dom.window.document.createElement("style");
  style.textContent = analyzeSessionCSS('.b { color: rgb(1, 2, 3) } .x { content: "}" } body ~ .b { color: red } ', SCOPE).css;
  dom.window.document.head.append(style);
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(".chat-room-wrapper .b")!).color, "rgb(1, 2, 3)");
  assert.notEqual(dom.window.getComputedStyle(dom.window.document.getElementById("out")!).color, "rgb(1, 2, 3)");
  dom.window.close();
});

test("fault injection: the previous implementation leaks on these inputs and these tests catch it", () => {
  const legacyLeaks = (css: string) => leaks(legacyScopeSessionCSS(legacyRemoveCssImports(css), SCOPE));
  for (const name of ["uppercase import", "mixed-case import", "font-face", "unprefixed keyframes", "brace inside string",
    "brace inside comment", "sibling via body", "scope literal sibling",
    "scope attribute then sibling"]) {
    assert.notDeepEqual(legacyLeaks(hostile[name]), [], `old scoper should leak: ${name}`);
    assert.deepEqual(leaks(analyzeSessionCSS(hostile[name], SCOPE).css), [], `fixed scoper must not leak: ${name}`);
  }
  // The root-compound rewrite is new in this PR, so the old scoper never had that leak; the fixed one must still block it.
  assert.deepEqual(leaks(analyzeSessionCSS(hostile["root pseudo-class then sibling"], SCOPE).css), []);
  assert.match(legacyRemoveCssImports('@IMPORT url("https://evil.test/x.css");'), /evil\.test/, "old import filter was case-sensitive");
});

test("Apply validates before saving and shows the reasons; render drops rejected rules instead of applying them", async () => {
  const { readFileSync } = await import("node:fs");
  const settings = readFileSync("components/chat/custom-css-settings.tsx", "utf8");
  assert.match(settings, /const problems = css \? validateSessionCSS\(css\) : \[\];\s*if \(problems\.length\) \{ setError\(problems\.join\(" "\)\); return; \}\s*setBusy\(true\)/);
  assert.match(readFileSync("components/chat/session-custom-css.tsx", "utf8"), /analyzeSessionCSS\(css, "\.chat-room-wrapper"\)\.css/);
});

/** CSS Nesting: `&` is the parent; a selector without `&` is `& <selector>`, one that starts with a combinator is relative to `&`. */
function resolveNested(selector: string, parent: string): string {
  if (selector.includes("&")) return selector.replaceAll("&", `:is(${parent})`);
  return /^[>+~]/.test(selector.trim()) ? `:is(${parent}) ${selector}` : `:is(${parent}) ${selector}`;
}

function reachesOutsideRoot(selector: string): boolean {
  const dom = new JSDOM(`<!doctype html><html><body><header class="x" id="before"></header>
    <div class="chat-room-wrapper dark"><div class="card"><span class="a title"></span></div></div>
    <p class="x" id="after"></p></body></html>`);
  const root = dom.window.document.querySelector(SCOPE)!;
  const outside = [...dom.window.document.querySelectorAll(selector)].some((el) => el !== root && !root.contains(el));
  dom.window.close();
  return outside;
}

const nestedEscapes: Record<string, { css: string; parent: string; nested: string }> = {
  "negated parent": { css: `${SCOPE} { :not(&) { display: none } }`, parent: SCOPE, nested: ":not(&)" },
  "negated root": { css: ":root { :not(&) { display: none } }", parent: SCOPE, nested: ":not(&)" },
  "negated descendant parent": { css: ".card { :not(&) { display: none } }", parent: `${SCOPE} .card`, nested: ":not(&)" },
  "ancestor of parent": { css: ".card { :has(&) { display: none } }", parent: `${SCOPE} .card`, nested: ":has(&)" },
  "root sibling": { css: ":root { & ~ * { display: none } }", parent: SCOPE, nested: "& ~ *" },
  "root relative sibling": { css: ":root { ~ .x { display: none } }", parent: SCOPE, nested: "~ .x" },
  "root adjacent sibling": { css: ":root { + .x { display: none } }", parent: SCOPE, nested: "+ .x" },
  "grouped at-rule": { css: ".card { @media (width > 1px) { :not(&) { display: none } } }", parent: `${SCOPE} .card`, nested: ":not(&)" },
  "deeply nested root sibling": { css: ":root { &.dark { & ~ * { display: none } } }", parent: `${SCOPE}.dark`, nested: "& ~ *" },
};

test("nested rules that would reach outside the conversation root are rejected, and the oracle proves they really escape", () => {
  for (const [name, { css, parent, nested }] of Object.entries(nestedEscapes)) {
    // Oracle: resolving the nested selector per the nesting spec really matches elements outside the root.
    assert.equal(reachesOutsideRoot(resolveNested(nested, parent)), true, `${name} should be a genuine escape`);
    const result = analyzeSessionCSS(css, SCOPE);
    assert.match(result.errors.join(" "), /Nested rule .* would reach outside this conversation/, name);
    assert.equal(result.css.trim(), "", `${name} must not be emitted`);
  }
});

test("ordinary nested rules stay usable and stay inside the root", () => {
  const safe = [
    `.card { color: red; &:hover { color: blue } .title { font-weight: 600 } > .a { margin: 0 } & ~ .b { color: red } @media (width < 400px) { padding: 0 } }`,
    `:root { --x: 1; & .title { color: red } & > .card { margin: 0 } .a { color: blue } &:hover { color: green } &.dark { color: pink } }`,
    `.card { & { color: red } & & { color: blue } }`.replace("& & {", "& .title {"),
  ];
  for (const css of safe) {
    const result = analyzeSessionCSS(css, SCOPE);
    assert.deepEqual(result.errors, [], css);
    assert.ok(result.css.includes("{"), css);
    assert.deepEqual(leaks(result.css), [], css);
  }
  for (const nested of ["&:hover", "& .title", "& > .card", ".a", "&.dark"])
    assert.equal(reachesOutsideRoot(resolveNested(nested, SCOPE)), false, `${nested} stays inside the root`);
});
