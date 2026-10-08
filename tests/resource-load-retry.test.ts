import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createLiveDocument } from "../lib/live-document";
import { browserBindingStorage } from "../lib/binding-storage";
import type { BindingDocument } from "../lib/bindings";
import { browserPresetStorage } from "../lib/preset-storage";
import { browserRegexStorage } from "../lib/regex-storage";
import { browserWorldBookStorage } from "../lib/worldbook-storage";
import { browserApiConfigStorage } from "../lib/api-config-storage";
import { createPresetDocument } from "../lib/preset";
import { copyPreset } from "../lib/preset-library";
import { newRegexGroup, newRegexRule } from "../lib/regex";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { normalizeWorldBook } from "../lib/worldbook";
import { normalizeFoundation } from "../lib/foundation-types";

function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let liveBindings: ReturnType<typeof createLiveDocument<BindingDocument>>;
const liveBridge = { get liveBindings() { return liveBindings; } };
const foundationBridge = { useFoundation: () => ({ document: normalizeFoundation({ characters: [{ characterId: "c", name: "Character" }] }), ready: true }) };
type Kind = "Preset" | "Regex" | "WorldBook" | "Binding" | "Binding document";

async function fixture(kind: Kind) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const) install(name, dom.window[name]);
  install("self", dom.window); install("IS_REACT_ACT_ENVIRONMENT", true);
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/foundation-provider")) return foundationBridge;
    if (request.endsWith("/contacts-bindings-live")) return liveBridge;
    return originalLoad.call(this, request, ...rest);
  };
  const preset = copyPreset(createPresetDocument(), undefined, "Custom Preset", "p");
  const regex = { version: 1 as const, groups: [defaultRegexGroup(), {
    ...newRegexGroup(), id: "g", name: "Custom Regex", rules: [{ ...newRegexRule(), id: "r", name: "Custom Rule" }],
  }] };
  const book = normalizeWorldBook({ name: "Custom WorldBook", entries: [{ name: "Entry", content: "lore" }] }, "b");
  book.entries[0].id = "e";
  const worldbook = { version: 1 as const, books: [book] };
  dom.window.localStorage.setItem("veil.preset.v1", JSON.stringify(preset));
  const binding = { global: {}, characters: {} };
  const requests: ReturnType<typeof deferred>[] = [];
  const controlled = async () => { const request = deferred(); requests.push(request); return await request.promise; };
  const originals = [browserPresetStorage.load, browserRegexStorage.load, browserWorldBookStorage.load,
    browserBindingStorage.load, browserApiConfigStorage.listApiConfigs] as const;
  browserPresetStorage.load = kind === "Preset" || kind === "Binding" ? () => controlled() as Promise<typeof preset> : async () => preset;
  browserRegexStorage.load = kind === "Regex" ? () => controlled() as Promise<typeof regex> : async () => regex;
  browserWorldBookStorage.load = kind === "WorldBook" ? () => controlled() as Promise<typeof worldbook> : async () => worldbook;
  browserBindingStorage.load = kind === "Binding document" ? () => controlled() as Promise<typeof binding> : async () => binding;
  browserApiConfigStorage.listApiConfigs = async () => [];
  liveBindings = createLiveDocument({ initial: binding, load: () => browserBindingStorage.load(),
    key: "veil.bindings.v1", event: "veil-bindings-change", error: "Bindings could not be loaded.", getWindow: () => dom.window as unknown as Window });
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = async (child: ReactNode, strict = false) => { await act(async () => {
    const page = createElement(AppRouterContext.Provider, { value: router as never }, child);
    root.render(strict ? createElement(StrictMode, null, page) : page);
  }); };
  const value = kind === "Regex" ? regex : kind === "WorldBook" ? worldbook : kind === "Binding document" ? binding : preset;
  const settle = async (index: number, error?: string, result: unknown = value) => { await act(async () => {
    const request = requests[index]; assert.ok(request, `request ${index} started`);
    if (error) request.reject(new Error(error)); else request.resolve(result);
    await request.promise.catch(() => {});
  }); };
  const button = (label: string) => {
    const result = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
    assert.ok(result, `button ${label} exists`); return result;
  };
  const close = async () => {
    await act(async () => { root.unmount(); requests.forEach((request) => request.resolve(value));
      await Promise.allSettled(requests.map((request) => request.promise)); });
    [browserPresetStorage.load, browserRegexStorage.load, browserWorldBookStorage.load, browserBindingStorage.load,
      browserApiConfigStorage.listApiConfigs] = originals;
    loader._load = originalLoad; dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { dom, requests, render, settle, button, close, value };
}

const pages: { name: string; kind: Kind; page: () => Promise<ReactNode> }[] = [
  { name: "Binding home", kind: "Binding", page: async () => createElement((await import("../components/settings/bindings/binding-manager")).BindingHome) },
  { name: "Binding editor", kind: "Binding", page: async () => createElement((await import("../components/settings/bindings/binding-manager")).BindingEditor, { characterId: "c" }) },
  { name: "Binding document", kind: "Binding document", page: async () => createElement((await import("../components/settings/bindings/binding-manager")).BindingHome) },
  { name: "Preset list", kind: "Preset", page: async () => createElement((await import("../components/settings/presets/preset-list")).PresetList) },
  { name: "Preset detail", kind: "Preset", page: async () => createElement((await import("../components/settings/presets/preset-detail")).PresetDetail, { presetId: "p" }) },
  { name: "New Prompt", kind: "Preset", page: async () => createElement((await import("../components/settings/presets/prompt-editor")).NewPromptEditor, { presetId: "p" }) },
  { name: "Regex list", kind: "Regex", page: async () => createElement((await import("../components/settings/regex/regex-list")).RegexList) },
  { name: "Regex detail", kind: "Regex", page: async () => createElement((await import("../components/settings/regex/regex-detail")).RegexDetail, { groupId: "g" }) },
  { name: "Regex rule", kind: "Regex", page: async () => createElement((await import("../components/settings/regex/regex-rule-editor")).RegexRuleEditor, { groupId: "g", ruleId: "r" }) },
  { name: "Regex new", kind: "Regex", page: async () => createElement((await import("../components/settings/regex/regex-new")).RegexNew) },
  { name: "WorldBook list", kind: "WorldBook", page: async () => createElement((await import("../components/settings/worldbooks/worldbook-list")).WorldBookList) },
  { name: "WorldBook detail", kind: "WorldBook", page: async () => createElement((await import("../components/settings/worldbooks/worldbook-detail")).WorldBookDetail, { bookId: "b" }) },
  { name: "WorldBook entry", kind: "WorldBook", page: async () => createElement((await import("../components/settings/worldbooks/worldbook-entry-editor")).WorldBookEntryEditor, { bookId: "b", entryId: "e" }) },
];

for (const page of pages) test(`${page.name}: failed load, deduplicated Retry, another failure, successful recovery`, { timeout: 3000 }, async () => {
  const ui = await fixture(page.kind);
  try {
    await ui.render(await page.page()); assert.equal(ui.requests.length, 1);
    await ui.settle(0, "Storage blocked");
    assert.match(ui.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /Storage blocked|Bindings could not be loaded/);
    const retry = ui.button("Retry");
    await act(async () => { retry.click(); retry.click(); });
    assert.equal(ui.requests.length, 2); assert.equal(ui.button("Retrying…").disabled, true);
    await ui.settle(1, "Still blocked");
    assert.ok(ui.dom.window.document.querySelector('[role="alert"]'));
    assert.equal(ui.button("Retry").disabled, false);
    await act(async () => { ui.button("Retry").click(); });
    await ui.settle(2);
    assert.equal(ui.requests.length, 3);
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null);
    assert.ok(![...ui.dom.window.document.querySelectorAll("button")].some((item) => item.textContent === "Retry"));
    assert.doesNotMatch(ui.dom.window.document.body.textContent ?? "", /not found|Loading /);
  } finally { await ui.close(); }
});

for (const kind of ["Binding", "Preset", "Regex", "WorldBook"] as const)
  for (const failure of [false, true]) test(`${kind}: pending Retry completing after remount cannot overwrite the new successful page (${failure ? "error" : "success"})`, { timeout: 3000 }, async () => {
    const ui = await fixture(kind), page = pages.find((item) => item.kind === kind)!;
    try {
      await ui.render(await page.page()); await ui.settle(0, "First failure");
      await act(async () => { ui.button("Retry").click(); });
      await ui.render(createElement("p", null, "Other page"));
      await ui.render(await page.page()); assert.equal(ui.requests.length, 3);
      await ui.settle(2);
      const healthy = ui.dom.window.document.body.textContent;
      const obsolete = structuredClone(ui.value) as { presets?: { name: string }[]; groups?: { name: string }[]; books?: { name: string }[] };
      for (const row of obsolete.presets ?? obsolete.groups ?? obsolete.books ?? []) row.name = "Obsolete resource";
      await ui.settle(1, failure ? "Obsolete failure" : undefined, obsolete);
      assert.equal(ui.dom.window.document.body.textContent, healthy);
      assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null);
    } finally { await ui.close(); }
  });

test("Regex new: Retry preserves the existing unsaved draft", { timeout: 3000 }, async () => {
  const ui = await fixture("Regex");
  try {
    await ui.render(await pages.find((item) => item.name === "Regex new")!.page());
    const input = ui.dom.window.document.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(ui.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "My unsaved draft");
      input.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
    });
    await ui.settle(0, "Blocked"); await act(async () => { ui.button("Retry").click(); }); await ui.settle(1);
    assert.equal(input.value, "My unsaved draft");
  } finally { await ui.close(); }
});

for (const kind of ["Preset", "Regex", "WorldBook"] as const)
  test(`${kind}: Strict Mode replay rejects an obsolete initial result on the same hook`, { timeout: 3000 }, async () => {
    const ui = await fixture(kind), page = pages.find((item) => item.kind === kind)!;
    try {
      await ui.render(await page.page(), true);
      assert.equal(ui.requests.length, 2);
      await ui.settle(1);
      const healthy = ui.dom.window.document.body.textContent;
      const obsolete = structuredClone(ui.value) as { presets?: { name: string }[]; groups?: { name: string }[]; books?: { name: string }[] };
      for (const row of obsolete.presets ?? obsolete.groups ?? obsolete.books ?? []) row.name = "Obsolete resource";
      await ui.settle(0, undefined, obsolete);
      assert.equal(ui.dom.window.document.body.textContent, healthy);
    } finally { await ui.close(); }
  });

test("Preset: normal first load and New Preset write still work without showing a load Retry", { timeout: 3000 }, async () => {
  const ui = await fixture("Preset");
  try {
    await ui.render(await pages.find((item) => item.name === "Preset list")!.page()); await ui.settle(0);
    const before = JSON.parse(ui.dom.window.localStorage.getItem("veil.preset.v1")!).presets.length;
    await act(async () => { ui.button("New Preset").click(); });
    assert.equal(JSON.parse(ui.dom.window.localStorage.getItem("veil.preset.v1")!).presets.length, before + 1);
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null);
    assert.ok(![...ui.dom.window.document.querySelectorAll("button")].some((item) => item.textContent === "Retry"));
  } finally { await ui.close(); }
});
