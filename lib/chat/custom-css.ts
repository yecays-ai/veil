export const CHAT_SESSION_CSS_EXAMPLE = `/* Only this conversation */
:root {
  --c-bubble-self: #246bfd;
  --c-bubble-other: #ffffff;
  --c-text-title: #202124;
  --c-input: #f2f2f7;
}

.chat-bubble-role-user {
  background: var(--c-bubble-self);
  color: #ffffff;
  border-radius: 12px;
}

.chat-bubble-role-assistant {
  background: var(--c-bubble-other);
  color: var(--c-text-title);
  border-radius: 12px;
}

.chat-input-textarea {
  background: var(--c-input);
}`;

export type SessionCssResult = { css: string; errors: string[] };

const KEYFRAME_PREFIX = "veil-session-";
// Container at-rules whose rules we recurse into and scope like top-level rules.
const CONTAINER_RULES = new Set(["media", "supports", "layer", "container"]);
const REJECTED_HINT: Record<string, string> = {
  import: "loads a stylesheet that cannot be limited to this conversation",
  "font-face": "registers a font family for the whole app",
  property: "registers a custom property for the whole app",
  "counter-style": "defines a counter style for the whole app",
  "font-feature-values": "defines font features for the whole app",
  "font-palette-values": "defines a font palette for the whole app",
  page: "styles the whole printed page",
  namespace: "changes selector namespaces for the whole app",
  charset: "is not allowed in conversation CSS",
  "view-transition": "affects page transitions for the whole app",
  scope: "cannot be limited to this conversation",
};

/**
 * Scope conversation CSS to one root and report rules that cannot be limited to it.
 * Rejected rules are dropped from `css`; every rejection adds an explanatory error.
 */
export function analyzeSessionCSS(raw: string, scope: string): SessionCssResult {
  const errors: string[] = [];
  const note = (message: string) => { if (!errors.includes(message)) errors.push(message); };
  if (!raw.trim()) return { css: "", errors };
  if (/<\/style|<!--/i.test(raw)) {
    note("Custom CSS cannot contain \"</style\" or \"<!--\".");
    return { css: "", errors };
  }
  const names = collectKeyframeNames(raw);
  return { css: scopeBlock(raw, scope, names, note), errors };
}

/** Errors that should stop a save; empty means every rule can be scoped. */
export function validateSessionCSS(raw: string, scope = ".chat-room-wrapper"): string[] {
  return analyzeSessionCSS(raw, scope).errors;
}

type Note = (message: string) => void;

function scopeBlock(raw: string, scope: string, keyframes: ReadonlySet<string>, note: Note): string {
  const out: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const white = /^\s+/.exec(raw.slice(index));
    if (white) { out.push(white[0]); index += white[0].length; continue; }
    if (raw.startsWith("/*", index)) {
      const end = raw.indexOf("*/", index + 2);
      index = end === -1 ? raw.length : end + 2;
      continue;
    }
    if (raw[index] === "}") { note("Custom CSS has an unmatched \"}\"."); index++; continue; }
    const atRule = raw[index] === "@";
    const stop = scanPrelude(raw, index);
    const prelude = stripComments(raw.slice(index, stop.end)).trim();
    if (stop.kind === "eof" || stop.kind === "close") {
      if (prelude) note(atRule ? "An at-rule is incomplete." : "A rule is missing its { } block.");
      index = stop.kind === "close" ? stop.end : raw.length;
      continue;
    }
    if (stop.kind === "semicolon") {
      index = stop.end + 1;
      if (!atRule) { note(`Unexpected text before ";": ${shorten(prelude)}`); continue; }
      const name = atName(prelude);
      if (name === "layer") out.push(`${prelude};`);
      else rejectAt(name, note);
      continue;
    }
    const close = findBlockEnd(raw, stop.end);
    if (close === -1) { note("Custom CSS has an unclosed { block."); break; }
    const inner = raw.slice(stop.end + 1, close);
    index = close + 1;
    if (atRule) {
      const name = atName(prelude);
      if (name === "keyframes" || name === "-webkit-keyframes") {
        out.push(`@keyframes ${KEYFRAME_PREFIX}${keyframeName(prelude)} {${inner}}`);
      } else if (CONTAINER_RULES.has(name)) {
        out.push(`${prelude} {${scopeBlock(inner, scope, keyframes, note)}}`);
      } else rejectAt(name, note);
      continue;
    }
    const selectors = splitTopLevel(prelude, ",").map((part) => scopeSelector(part.trim(), scope));
    if (selectors.some((selector) => selector === null)) {
      note(`Selector "${shorten(prelude)}" would reach outside this conversation and was removed.`);
      continue;
    }
    const scopedList = selectors as string[];
    const escaping = findEscapingNested(stripComments(inner), scopedList.some((item) => isRootCompound(item.slice(scope.length))));
    if (escaping !== null) {
      note(`Nested rule "${shorten(escaping)}" would reach outside this conversation and was removed.`);
      continue;
    }
    out.push(`${scopedList.join(", ")} {${renameAnimations(inner, keyframes)}}`);
  }
  return out.join("");
}

function rejectAt(name: string, note: Note) {
  const reason = REJECTED_HINT[name] ?? "cannot be limited to this conversation";
  note(`@${name || "rule"} is not supported in conversation CSS because it ${reason}.`);
}

function shorten(text: string) { return text.length > 60 ? `${text.slice(0, 57)}…` : text; }

/** CSS escapes in an ident (`\69 mport`, `\@`) decoded so lookups cannot be bypassed. */
function decodeIdent(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\n])/g, (_m, hex?: string, char?: string) => {
    if (hex === undefined) return char ?? "";
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
}

function atName(prelude: string): string {
  const match = /^@((?:[\w-]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n]|[^\u0000-\u007f])+)/.exec(prelude);
  return match ? decodeIdent(match[1]).toLowerCase() : "";
}

function keyframeName(prelude: string): string {
  const rest = prelude.replace(/^@\S+\s*/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  return decodeIdent(rest).replace(/[^\w-]/g, "_");
}

function collectKeyframeNames(raw: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of raw.matchAll(/@(?:-webkit-)?keyframes\s+(?:"([^"]+)"|'([^']+)'|([^\s{]+))/gi))
    names.add(keyframeName(`@keyframes ${match[1] ?? match[2] ?? match[3]}`));
  return names;
}

/** Point `animation` / `animation-name` at the renamed keyframes so names stay private. */
function renameAnimations(body: string, names: ReadonlySet<string>): string {
  if (!names.size || !/animation/i.test(body)) return body;
  return body.replace(/(animation(?:-name)?\s*:\s*)([^;{}]*)/gi, (_m, head: string, value: string) =>
    head + value.replace(/(["']?)([A-Za-z_][\w-]*)\1/g, (token, quote: string, word: string) =>
      names.has(word) ? `${quote}${KEYFRAME_PREFIX}${word}${quote}` : token));
}

/**
 * Prefix one complex selector with the conversation root. Returns null when the selector
 * could match outside the root (a sibling combinator right after the root, or a root
 * written as `body`/`html`/`:root` followed by one).
 */
function scopeSelector(selector: string, scope: string): string | null {
  if (!selector) return null;
  const root = /^(?:body|html|:root)(?![\w-])/i.exec(selector);
  let scoped: string;
  if (root) {
    const rest = selector.slice(root[0].length);
    scoped = scope + rest;
  } else if (selector === scope || selector.startsWith(`${scope} `) || selector.startsWith(`${scope}:`) ||
    selector.startsWith(`${scope}[`) || selector.startsWith(`${scope}.`) || selector.startsWith(`${scope}>`)) {
    scoped = selector;
  } else scoped = `${scope} ${selector}`;
  return reachesRootSiblings(scoped.slice(scope.length)) ? null : scoped;
}

/**
 * True when the root's own compound selector (`:not(.x)`, `.dark`, `[a]`, `:has(…)` …) is
 * followed by a sibling combinator, which would select elements next to the conversation root.
 * `rest` is everything after the root token, already free of comments.
 */
function reachesRootSiblings(rest: string): boolean {
  let i = 0, depth = 0;
  for (; i < rest.length; i++) {
    const char = rest[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(rest, i); continue; }
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0 && (/\s/.test(char) || char === ">" || char === "+" || char === "~")) break;
  }
  while (i < rest.length && /\s/.test(rest[i])) i++;
  return rest[i] === "+" || rest[i] === "~";
}

/** True when `rest` (text after a selector's root token) is still the root's own compound selector. */
function isRootCompound(rest: string): boolean {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(rest, i); continue; }
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0 && (/\s/.test(char) || char === ">" || char === "+" || char === "~")) return false;
  }
  return true;
}

/** Positions of the nesting selector `&`, ignoring strings and escapes. */
function nestingPositions(selector: string): number[] {
  const found: number[] = [];
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(selector, i); continue; }
    if (char === "&") found.push(i);
  }
  return found;
}

/**
 * CSS nesting resolves `&` to the parent rule. A nested selector that contains `&` anywhere but its
 * start is no longer implicitly limited to the parent's descendants (`:not(&)`, `:has(&)`), and a
 * sibling combinator on a parent that is the conversation root reaches its neighbours. Returns the
 * offending nested selector list, or null when every nested rule stays inside the root.
 */
function findEscapingNested(body: string, parentIsRoot: boolean): string | null {
  let i = 0;
  while (i < body.length) {
    const stop = scanPrelude(body, i);
    if (stop.kind === "eof") break;
    if (stop.kind === "close") { i = stop.end; continue; }
    if (stop.kind === "semicolon") { i = stop.end + 1; continue; }
    const prelude = body.slice(i, stop.end).trim();
    const close = findBlockEnd(body, stop.end);
    const inner = body.slice(stop.end + 1, close === -1 ? body.length : close);
    i = close === -1 ? body.length : close + 1;
    if (prelude.startsWith("@")) {
      // Grouping at-rules inside a rule keep the same parent.
      const found = findEscapingNested(inner, parentIsRoot);
      if (found !== null) return found;
      continue;
    }
    let childIsRoot = false;
    for (const part of splitTopLevel(prelude, ",")) {
      const selector = part.trim();
      if (!selector) continue;
      const amps = nestingPositions(selector);
      if (!amps.length) {
        if (/^[+~]/.test(selector) && parentIsRoot) return prelude;
        continue;
      }
      if (amps.length > 1 || amps[0] !== 0) return prelude;
      const rest = selector.slice(1);
      if (parentIsRoot && reachesRootSiblings(rest)) return prelude;
      if (parentIsRoot && isRootCompound(rest)) childIsRoot = true;
    }
    const found = findEscapingNested(inner, childIsRoot);
    if (found !== null) return found;
  }
  return null;
}

/** Comments are insignificant to the browser; removing them keeps checks from being hidden by one. */
function stripComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { out += text.slice(i, i + 2); i++; continue; }
    if (char === '"' || char === "'") { const end = skipString(text, i); out += text.slice(i, end + 1); i = end; continue; }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    out += char;
  }
  return out;
}

type Stop = { kind: "block" | "semicolon" | "close" | "eof"; end: number };

/** Find where a prelude ends: `{`, `;`, a stray `}`, or the end of text. */
function scanPrelude(text: string, from: number): Stop {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(text, i); continue; }
    if (char === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (depth === 0) {
      if (char === "{") return { kind: "block", end: i };
      if (char === "}") return { kind: "close", end: i + 1 };
      if (char === ";") return { kind: "semicolon", end: i };
    }
  }
  return { kind: "eof", end: text.length };
}

function skipString(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === quote || text[i] === "\n") return i;
  }
  return text.length;
}

/** Index of the `}` matching the `{` at `open`, ignoring braces in strings, comments, escapes and url(). */
function findBlockEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(text, i); continue; }
    if (char === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Split on a separator that is not inside parentheses, brackets, strings or escapes. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === '"' || char === "'") { i = skipString(text, i); continue; }
    if (char === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}
