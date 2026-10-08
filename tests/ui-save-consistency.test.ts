import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { Switch } from "../components/settings/ui/switch";

const read = (path: string) => readFileSync(path, "utf8");

test("mounted disabled Switch blocks direct and label clicks, then works when re-enabled", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const changes: boolean[] = [];
  function Probe({ disabled }: { disabled: boolean }) {
    const [checked, setChecked] = useState(false);
    return createElement("label", null, "Setting", createElement(Switch, { checked, disabled,
      onChange: (next) => { changes.push(next); setChecked(next); } }));
  }
  try {
    await act(async () => { root.render(createElement(Probe, { disabled: true })); });
    const input = container.querySelector<HTMLInputElement>('input[role="switch"]')!;
    const label = container.querySelector("label")!;
    await act(async () => { input.click(); label.click(); });
    assert.deepEqual(changes, [], "disabled native and label activation never invokes onChange");
    assert.equal(input.checked, false);
    await act(async () => { root.render(createElement(Probe, { disabled: false })); });
    await act(async () => { label.click(); });
    assert.deepEqual(changes, [true], "the same mounted Switch works once enabled");
    assert.equal(input.checked, true);
    await act(async () => { root.render(createElement(Probe, { disabled: true })); });
    await act(async () => { label.click(); input.click(); });
    assert.deepEqual(changes, [true], "disabling again blocks further changes without clearing the value");
    assert.equal(input.checked, true);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("shared Switch keeps switch semantics, theme accent, keyboard focus and touch target", () => {
  const component = read("components/settings/ui/switch.tsx");
  const globalCss = read("app/globals.css");
  assert.match(component, /role="switch"/);
  assert.match(component, /checked=\{checked\}/);
  assert.match(component, /disabled=\{disabled\}/);
  assert.match(component, /onChange=\{handleChange\}/);
  assert.match(component, /aria-label/);
  assert.match(globalCss, /--theme-accent/);
  assert.match(globalCss, /width:\s*48px;[\s\S]*height:\s*29px/);
  assert.match(globalCss, /inset:\s*-7px -4px/);
  assert.match(globalCss, /:focus-visible \+ \.veil-switch-track/);
  assert.match(globalCss, /prefers-reduced-motion:\s*reduce/);
});

test("global control focus resets browser rings and keeps a theme-colored keyboard focus indicator", () => {
  const globalCss = read("app/globals.css");
  const foundationCss = read("app/foundation.css");
  assert.match(globalCss, /:where\(button, input, select, textarea, \[tabindex\]\):focus \{\s*outline: none;/);
  assert.match(globalCss, /:where\(button, input, select, textarea, \[tabindex\]\):focus-visible \{\s*outline: 2px solid var\(--theme-accent\);/);
  assert.match(globalCss, /a:focus-visible \{ outline: 2px solid var\(--theme-accent\);/);
  assert.doesNotMatch(globalCss, /#2563eb/);
  assert.match(foundationCss, /\.foundation-form input:focus-visible/);
  assert.doesNotMatch(foundationCss, /\.foundation-form input:focus,/);
});

test("all boolean settings use the shared Switch while selection checkboxes remain checkboxes", () => {
  const sources = [
    "components/chat/chat-room.tsx",
    "components/settings/runtime-settings.tsx",
    "components/settings/presets/prompt-editor.tsx",
    "components/settings/presets/preset-detail.tsx",
    "components/settings/regex/regex-inline-rule.tsx",
    "components/settings/regex/regex-rule-editor.tsx",
    "components/settings/regex/regex-new.tsx",
    "components/settings/regex/regex-detail.tsx",
    "components/settings/worldbooks/worldbook-list.tsx",
    "components/settings/worldbooks/worldbook-detail.tsx",
    "components/settings/worldbooks/worldbook-entry-editor.tsx",
  ].map(read).join("\n");
  assert.doesNotMatch(sources, /chat-info-switch|<input[^>]*type="checkbox"[^>]*checked=\{[^}]*\.(?:enabled|constant|caseSensitive|timeAware|pinned|streamOnline|autoReplyOnKeyboardDismiss)/);
  assert.match(read("components/appearance.tsx"), /type="checkbox"[\s\S]*checked=\{document\.current\.dockLayout\.includes\(app\.id\)\}/);
  for (const path of [
    "components/settings/regex/regex-rule-editor.tsx",
    "components/settings/regex/regex-new.tsx",
    "components/settings/regex/regex-inline-rule.tsx",
  ]) assert.match(read(path), /type="checkbox" checked=\{(?:draft|editing)\.appliesTo\.includes/);
  assert.match(read("components/settings/regex/regex-list.tsx"), /<RegexInlineRule/);
  assert.match(read("components/settings/regex/regex-inline-rule.tsx"), /<Switch aria-label=\{`Enable/);
});

test("Regex inline rule rows use one unlabeled control and preserve enable persistence", () => {
  const inline = read("components/settings/regex/regex-inline-rule.tsx");
  const css = read("app/settings/regex/regex.css");
  assert.match(inline, /<strong>\{rule\.name\}<\/strong><small>\{rule\.mode/);
  assert.match(inline, /<Switch aria-label=\{`Enable \$\{rule\.name \|\| "rule"\}`\} checked=\{rule\.enabled\}/);
  assert.doesNotMatch(inline, />Enabled<\/label>/);
  assert.match(inline, /await onSave\(next\)[\s\S]*if \(closeAfterSave\) setOpen\(false\)/);
  assert.match(inline, /catch \(reason\) \{ setError/);
  assert.match(css, /\.regex-inline-summary > \.veil-switch/);
});

test("Character creation opens its detail page after persistence and editing stays on detail", () => {
  const character = read("components/profile-pages.tsx");
  const profileForm = read("components/profile-form.tsx");
  assert.match(character, /const saved = await commit\(\(d\) =>[\s\S]*if \(isNew\) \{[\s\S]*const created = saved\.characters\.at\(-1\)[\s\S]*router\.push\(`\/characters\/\$\{encodeURIComponent\(created\.characterId\)\}`\)[\s\S]*else setEditing\(false\)/);
  assert.match(profileForm, /catch \(e\) \{[\s\S]*setNotice\(e instanceof Error/);
});

test("Text API and Regex Rule saves finish at a result view only after persistence", () => {
  const api = read("components/settings/text-api-settings.tsx");
  const apiModal = read("components/settings/text-api-settings.tsx");
  const regexRule = read("components/settings/regex/regex-rule-editor.tsx");
  const regexHook = read("components/settings/regex/use-regex.ts");
  assert.match(api, /await browserApiConfigStorage\.saveApiConfig\(next, baseline\)[\s\S]*setConfigs\([\s\S]*setDraft\(null\)/);
  assert.match(apiModal, /catch \(err\)[\s\S]*setError\([\s\S]*finally \{[\s\S]*setBusy\(""\)/);
  assert.match(regexRule, /await change\([\s\S]*router\.push\(back\)/);
  assert.match(regexHook, /catch \(reason\)[\s\S]*setError\(reason instanceof Error/);
});

test("other object create/edit flows navigate to results or leave immediate controls in place", () => {
  const presetList = read("components/settings/presets/preset-list.tsx");
  const presetDetail = read("components/settings/presets/preset-detail.tsx");
  const promptEditor = read("components/settings/presets/prompt-editor.tsx");
  const worldBookList = read("components/settings/worldbooks/worldbook-list.tsx");
  const worldBookDetail = read("components/settings/worldbooks/worldbook-detail.tsx");
  const worldBookEntry = read("components/settings/worldbooks/worldbook-entry-editor.tsx");
  const regexNew = read("components/settings/regex/regex-new.tsx");
  const regexDetail = read("components/settings/regex/regex-detail.tsx");
  const userProfile = read("components/profile-pages.tsx");
  const universe = read("components/universe-page.tsx");

  assert.match(presetList, /await change\(newPreset\)/);
  assert.doesNotMatch(presetList, /useRouter|router\.push/);
  assert.match(presetDetail, /await change\([\s\S]*router\.push\("\/settings\/presets"\)/);
  assert.match(promptEditor, /await change\([\s\S]*router\.push\(backHref\)/);
  assert.match(worldBookList, /await change\(\(current\) => \(\{ \.\.\.current, books: \[\.\.\.current\.books, book\] \}\)\)/);
  assert.doesNotMatch(worldBookList, /useRouter|router\.push/);
  assert.match(worldBookDetail, /await change\([\s\S]*router\.push\("\/settings\/worldbooks"\)/);
  assert.match(worldBookEntry, /await change\([\s\S]*router\.push\(base\)/);
  assert.match(regexNew, /await change\([\s\S]*router\.replace\("\/settings\/regex"\)/);
  assert.match(regexDetail, /await change\([\s\S]*router\.push\("\/settings\/regex"\)/);
  assert.match(userProfile, /await commit\(\(d\) => saveUser\([\s\S]*setEditing\(false\)/);
  assert.match(universe, /await commit\([\s\S]*setEditingInfo\(false\)/);
});

test("Appearance image editing sections start collapsed without changing asset persistence", () => {
  const appearance = read("components/appearance.tsx");
  const imageStorageTests = read("tests/appearance-image-storage.test.ts");
  assert.doesNotMatch(appearance, /<details\b[^>]*\bopen/);
  assert.match(appearance, /<summary>壁纸<\/summary>[\s\S]*<ImageEditor[\s\S]*label="Wallpaper"/);
  assert.match(appearance, /<summary>图标<\/summary>[\s\S]*APP_REGISTRY\.map[\s\S]*<ImageEditor/);
  assert.match(appearance, /<summary>Dock<\/summary>[\s\S]*label="Dock image"/);
  assert.match(appearance, /persistAppearanceImage\(/);
  assert.match(imageStorageTests, /asset write failure never applies a theme reference/);
});
