import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { newRegexGroup, newRegexRule, type RegexDocument } from "../lib/regex";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { normalizeWorldBook, type WorldBookDocument } from "../lib/worldbook";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function environment() {
  const dom = new JSDOM('<div class="phone-shell"><div id="a"></div><div id="b"></div></div>', {
    url: "http://localhost/settings", pretendToBeVisual: true,
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "localStorage", "Event"] as const)
    install(name, dom.window[name]);
  const held = new Set<string>();
  Object.defineProperty(dom.window.navigator, "locks", { configurable: true, value: { async request<T>(name: string,
    options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: "exclusive" } as Lock); }
    finally { held.delete(name); }
  } } });
  dom.window.confirm = () => true;
  install("self", dom.window); install("IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const navigations: string[] = [];
  const router = { bfcacheId: "test", push: (href: string) => { navigations.push(href); }, replace: (href: string) => { navigations.push(href); },
    back: () => {}, forward: () => {}, refresh: () => {}, hmrRefresh: () => {}, prefetch: () => {} };
  const roots = new Set<Root>();
  const container = (id: string) => dom.window.document.getElementById(id)!;
  const mount = async (id: string, element: ReactElement) => {
    const root = createRoot(container(id)); roots.add(root);
    const render = async (next: ReactElement) => { await act(async () => {
      root.render(createElement(AppRouterContext.Provider, { value: router }, next));
    }); };
    await render(element);
    return { render, unmount: async () => { await act(async () => { root.unmount(); }); roots.delete(root); } };
  };
  const wait = async (condition: () => boolean) => {
    for (let round = 0; round < 60 && !condition(); round++)
      await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
    assert(condition(), "expected the actual operation to reach its terminal UI state");
  };
  const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
  const input = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  return { dom, container, mount, wait, click, input, navigations, held,
    close: async () => {
      for (const root of roots) await act(async () => { root.unmount(); });
      dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
    } };
}
function seed(dom: JSDOM) {
  const regex: RegexDocument = { version: 1, groups: [defaultRegexGroup(), {
    ...newRegexGroup(), id: "g", name: "My Group", rules: [{ ...newRegexRule(), id: "r", name: "Rule", find: "old" }],
  }] };
  const book = normalizeWorldBook({ name: "My Book", entries: [{ name: "Entry", content: "old" }] }, "b");
  book.entries[0].id = "e";
  const worldbooks: WorldBookDocument = { version: 1, books: [book] };
  dom.window.localStorage.setItem("veil.regex.v1", JSON.stringify(regex));
  dom.window.localStorage.setItem("veil.worldbooks.v1", JSON.stringify(worldbooks));
  return { regex, worldbooks };
}
async function fixture(kind: "Regex" | "WorldBook") {
  const env = await environment(); seed(env.dom);
  const { RegexRuleEditor } = await import("../components/settings/regex/regex-rule-editor");
  const { WorldBookEntryEditor } = await import("../components/settings/worldbooks/worldbook-entry-editor");
  const { browserRegexStorage } = await import("../lib/regex-storage");
  const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
  const editor = () => kind === "Regex" ? createElement(RegexRuleEditor, { groupId: "g", ruleId: "r" })
    : createElement(WorldBookEntryEditor, { bookId: "b", entryId: "e" });
  const field = (id: string) => env.container(id).querySelector<HTMLTextAreaElement>(kind === "Regex" ? "textarea" : ".worldbook-content")!;
  const save = (id: string) => env.container(id).querySelector<HTMLButtonElement>(".settings-header-action")!;
  const stored = async () => kind === "Regex" ? (await browserRegexStorage.load()).groups.find((g) => g.id === "g")?.rules.find((r) => r.id === "r")?.find
    : (await browserWorldBookStorage.load()).books.find((b) => b.id === "b")?.entries.find((e) => e.id === "e")?.content;
  const drop = async () => {
    if (kind === "Regex") await browserRegexStorage.transact((d) => ({ ...d, groups: d.groups.map((g) => ({ ...g, rules: g.rules.filter((r) => r.id !== "r") })) }));
    else await browserWorldBookStorage.transact((d) => ({ ...d, books: d.books.map((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== "e") })) }));
  };
  return { ...env, editor, field, save, stored, drop };
}

for (const kind of ["Regex", "WorldBook"] as const) {
  test(`${kind}: mounted editors refuse an interleaved stale draft; quota failure preserves a fresh draft for retry and re-entry`, async () => {
    const env = await fixture(kind);
    let restore: (() => void) | undefined;
    try {
      const first = await env.mount("a", env.editor()); await env.mount("b", env.editor());
      await env.wait(() => !!env.field("a") && !!env.field("b"));
      await env.input(env.field("a"), "Draft A"); await env.input(env.field("b"), "Saved B");
      await env.click(env.save("b")); await env.wait(() => env.navigations.length === 1);
      assert.equal(await env.stored(), "Saved B");
      await env.click(env.save("a"));
      await env.wait(() => !!env.container("a").querySelector('[role="alert"]') || env.navigations.length > 1);
      assert.equal(env.navigations.length, 1, "conflicts never navigate as though saving succeeded");
      assert.match(env.container("a").textContent!, /changed elsewhere/);
      assert.equal(env.field("a").value, "Draft A"); assert.equal(await env.stored(), "Saved B");
      await first.unmount();
      const fresh = await env.mount("a", env.editor()); await env.wait(() => !!env.field("a"));
      assert.equal(env.field("a").value, "Saved B");
      await env.input(env.field("a"), "Retry draft");
      const prototype = env.dom.window.Storage.prototype, original = prototype.setItem;
      prototype.setItem = () => { throw new Error("Quota blocked"); };
      restore = () => { prototype.setItem = original; };
      await env.click(env.save("a")); await env.wait(() => !!env.container("a").querySelector('[role="alert"]'));
      assert.match(env.container("a").textContent!, /Quota blocked/);
      assert.equal(env.field("a").value, "Retry draft"); assert.equal(env.navigations.length, 1);
      restore(); restore = undefined;
      assert.equal(await env.stored(), "Saved B");
      await env.click(env.save("a")); await env.wait(() => env.navigations.length === 2);
      assert.equal(await env.stored(), "Retry draft");
      await fresh.unmount(); await env.mount("a", env.editor()); await env.wait(() => !!env.field("a"));
      assert.equal(env.field("a").value, "Retry draft");
    } finally { restore?.(); await env.close(); }
  });
  test(`${kind}: saving a deleted target shows a conflict and preserves the mounted draft instead of reporting success`, async () => {
    const env = await fixture(kind);
    try {
      await env.mount("a", env.editor()); await env.wait(() => !!env.field("a"));
      await env.input(env.field("a"), "Do not lose this draft"); await env.drop();
      await env.click(env.save("a"));
      await env.wait(() => !!env.container("a").querySelector('[role="alert"]') || env.navigations.length > 0);
      assert.equal(env.navigations.length, 0);
      assert.match(env.container("a").textContent!, /deleted/);
      assert.equal(env.field("a").value, "Do not lose this draft"); assert.equal(await env.stored(), undefined);
    } finally { await env.close(); }
  });
}

test("Regex inline save failure stays open with its original draft and no success closure", async () => {
  const env = await environment();
  const { RegexInlineRule } = await import("../components/settings/regex/regex-inline-rule");
  const rule = { ...newRegexRule(), name: "Inline", find: "old" };
  let calls = 0;
  try {
    await env.mount("a", createElement(RegexInlineRule, { rule, busy: false, initiallyOpen: true,
      onSave: async () => { calls++; throw new Error("changed elsewhere"); } }));
    const field = env.container("a").querySelector<HTMLTextAreaElement>("textarea")!;
    await env.input(field, "Keep my inline draft");
    const save = [...env.container("a").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save Rule")!;
    await act(async () => { save.click(); save.click(); });
    await env.wait(() => !!env.container("a").querySelector('[role="alert"]'));
    assert.equal(calls, 1); assert.equal(field.value, "Keep my inline draft");
    assert.equal(env.container("a").querySelector('[aria-expanded="true"]') !== null, true);
  } finally { await env.close(); }
});

test("Regex inline toggle conflicts remain visible even when the editor is collapsed", async () => {
  const env = await environment();
  const { RegexInlineRule } = await import("../components/settings/regex/regex-inline-rule");
  const rule = { ...newRegexRule(), name: "Collapsed", find: "old" };
  try {
    await env.mount("a", createElement(RegexInlineRule, { rule, busy: false,
      onSave: async () => { throw new Error("changed elsewhere"); } }));
    const toggle = env.container("a").querySelector<HTMLInputElement>('[role="switch"]')!;
    await env.click(toggle); await env.wait(() => !!env.container("a").querySelector('[role="alert"]'));
    assert.match(env.container("a").textContent!, /changed elsewhere/);
    assert.equal(toggle.checked, true); assert.equal(env.container("a").querySelector("textarea"), null);
  } finally { await env.close(); }
});

test("Regex inline draft retains its original baseline when refreshed props contain a newer Rule", async () => {
  const env = await environment();
  const { RegexInlineRule } = await import("../components/settings/regex/regex-inline-rule");
  const rule = { ...newRegexRule(), name: "Original", find: "old" };
  let writes = 0;
  const onSave = async () => { writes++; };
  try {
    const root = await env.mount("a", createElement(RegexInlineRule, { rule, busy: false, initiallyOpen: true, onSave }));
    const field = env.container("a").querySelector<HTMLTextAreaElement>("textarea")!;
    await env.input(field, "Original draft");
    await root.render(createElement(RegexInlineRule, { rule: { ...rule, name: "Newer name" }, busy: false, initiallyOpen: true, onSave }));
    const button = [...env.container("a").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save Rule")!;
    await env.click(button); await env.wait(() => !!env.container("a").querySelector('[role="alert"]'));
    assert.equal(writes, 0); assert.equal(field.value, "Original draft");
    assert.match(env.container("a").textContent!, /changed elsewhere/);
  } finally { await env.close(); }
});

type Library<D> = { document?: D; run(operation: () => Promise<void>): Promise<void>;
  change(update: (current: D) => D): Promise<D> };
type StorageAdapter<D> = { load(): Promise<D>;
  transact(update: (current: D) => D, expected?: D): Promise<D> };
function lifecycleCases<D>(name: string, configure: (documents: ReturnType<typeof seed>) => Promise<{
  useLibrary: (scope: string) => Library<D>; storage: StorageAdapter<D>; old: D; fresh: D; edit: (current: D) => D;
}>) {
  test(`${name}: a late load from the previous route cannot replace the new route snapshot`, async () => {
    const env = await environment(), config = await configure(seed(env.dom));
    const original = config.storage.load, first = deferred<D>(), second = deferred<D>();
    let calls = 0, current!: Library<D>;
    config.storage.load = () => (++calls === 1 ? first.promise : second.promise);
    const useLibrary = config.useLibrary;
    function Probe({ scope }: { scope: string }) { current = useLibrary(scope); return createElement("pre", null, JSON.stringify(current.document)); }
    try {
      const root = await env.mount("a", createElement(Probe, { scope: "old" }));
      await root.render(createElement(Probe, { scope: "new" }));
      assert.equal(calls, 2, "changing route scope must load its own snapshot");
      await act(async () => { second.resolve(config.fresh); await second.promise; });
      assert.deepEqual(current.document, config.fresh);
      await act(async () => { first.resolve(config.old); await first.promise; });
      assert.deepEqual(current.document, config.fresh, "assert after the entire old load continuation has finished");
    } finally { first.resolve(config.old); second.resolve(config.fresh); config.storage.load = original; await env.close(); }
  });
  test(`${name}: pending file preparation from a closed editor cannot write or navigate after re-entry`, async () => {
    const env = await environment(), config = await configure(seed(env.dom));
    let current!: Library<D>, pending: Promise<void> | undefined;
    const file = deferred<void>(), useLibrary = config.useLibrary;
    function Probe({ scope }: { scope: string }) { current = useLibrary(scope); return createElement("pre", null, JSON.stringify(current.document)); }
    try {
      const root = await env.mount("a", createElement(Probe, { scope: "old" }));
      await env.wait(() => !!current.document); const before = await config.storage.load(), old = current;
      await act(async () => { pending = old.run(async () => {
        await file.promise; await old.change(config.edit); env.navigations.push("stale success");
      }); });
      await root.render(createElement(Probe, { scope: "new" })); await env.wait(() => !!current.document);
      await act(async () => { file.resolve(); await pending; });
      assert.deepEqual(await config.storage.load(), before); assert.deepEqual(env.navigations, []);
      assert.deepEqual(current.document, before);
    } finally { file.resolve(); await pending; await env.close(); }
  });
  test(`${name}: a delayed save checks ownership inside the eventual commit, not only before awaiting it`, async () => {
    const env = await environment(), config = await configure(seed(env.dom));
    const original = config.storage.transact, gate = deferred<void>();
    let current!: Library<D>, pending: Promise<void> | undefined;
    const useLibrary = config.useLibrary;
    function Probe({ scope }: { scope: string }) { current = useLibrary(scope); return createElement("pre", null, JSON.stringify(current.document)); }
    config.storage.transact = async (update, expected) => { await gate.promise; return original(update, expected); };
    try {
      const root = await env.mount("a", createElement(Probe, { scope: "old" }));
      await env.wait(() => !!current.document); const before = await config.storage.load(), old = current;
      await act(async () => { pending = old.run(async () => { await old.change(config.edit); env.navigations.push("stale success"); }); });
      await root.unmount(); await env.mount("a", createElement(Probe, { scope: "new" }));
      await env.wait(() => !!current.document);
      await act(async () => { gate.resolve(); await pending; });
      assert.deepEqual(await config.storage.load(), before); assert.deepEqual(env.navigations, []);
    } finally { gate.resolve(); await pending; config.storage.transact = original; await env.close(); }
  });
}
lifecycleCases<RegexDocument>("Regex", async ({ regex }) => {
  const { useRegex } = await import("../components/settings/regex/use-regex");
  const { browserRegexStorage } = await import("../lib/regex-storage");
  const edit = (document: RegexDocument) => ({ ...document, groups: document.groups.map((g) => g.id === "g" ? { ...g, name: "Fresh route" } : g) });
  return { useLibrary: useRegex, storage: browserRegexStorage, old: regex, fresh: edit(regex), edit };
});
lifecycleCases<WorldBookDocument>("WorldBook", async ({ worldbooks }) => {
  const { useWorldBooks } = await import("../components/settings/worldbooks/use-worldbooks");
  const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
  const edit = (document: WorldBookDocument) => ({ ...document, books: document.books.map((b) => b.id === "b" ? { ...b, name: "Fresh route" } : b) });
  return { useLibrary: useWorldBooks, storage: browserWorldBookStorage, old: worldbooks, fresh: edit(worldbooks), edit };
});

for (const kind of ["Regex", "WorldBook"] as const) {
  test(`${kind}: an old detail page cannot delete a library updated in another instance`, async () => {
    const env = await environment(); seed(env.dom);
    const { RegexDetail } = await import("../components/settings/regex/regex-detail");
    const { WorldBookDetail } = await import("../components/settings/worldbooks/worldbook-detail");
    const { browserRegexStorage } = await import("../lib/regex-storage");
    const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
    try {
      await env.mount("a", kind === "Regex" ? createElement(RegexDetail, { groupId: "g" }) : createElement(WorldBookDetail, { bookId: "b" }));
      const button = () => [...env.container("a").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === (kind === "Regex" ? "Delete Regex Group" : "Delete WorldBook"));
      await env.wait(() => !!button());
      if (kind === "Regex") await browserRegexStorage.transact((d) => ({ ...d, groups: d.groups.map((g) => g.id === "g" ? { ...g, name: "Newer name" } : g) }));
      else await browserWorldBookStorage.transact((d) => ({ ...d, books: d.books.map((b) => b.id === "b" ? { ...b, name: "Newer name" } : b) }));
      await env.click(button()!);
      await env.wait(() => !!env.container("a").querySelector('[role="alert"]') || env.navigations.length > 0);
      assert.deepEqual(env.navigations, []); assert.match(env.container("a").textContent!, /changed elsewhere/);
      const name = kind === "Regex" ? (await browserRegexStorage.load()).groups.find((g) => g.id === "g")?.name
        : (await browserWorldBookStorage.load()).books.find((b) => b.id === "b")?.name;
      assert.equal(name, "Newer name"); assert.equal(env.dom.window.localStorage.getItem("veil.bindings.v1"), null);
    } finally { await env.close(); }
  });
}

for (const kind of ["Regex", "WorldBook"] as const) {
  test(`${kind}: contention and unavailable browser locks report failure with the draft intact`, async () => {
    const env = await fixture(kind), key = kind === "Regex" ? "veil.regex.v1" : "veil.worldbooks.v1";
    try {
      await env.mount("a", env.editor()); await env.wait(() => !!env.field("a"));
      await env.input(env.field("a"), "Protected draft"); env.held.add(key);
      await env.click(env.save("a")); await env.wait(() => !!env.container("a").querySelector('[role="alert"]'));
      assert.match(env.container("a").textContent!, /saved elsewhere/);
      assert.equal(env.field("a").value, "Protected draft"); assert.deepEqual(env.navigations, []);
      env.held.delete(key);
      Reflect.deleteProperty(env.dom.window.navigator, "locks");
      await env.click(env.save("a")); await env.wait(() => /requires browser Web Locks/.test(env.container("a").textContent!));
      assert.equal(env.field("a").value, "Protected draft"); assert.equal(await env.stored(), "old");
      assert.deepEqual(env.navigations, []);
    } finally { env.held.delete(key); await env.close(); }
  });
}
