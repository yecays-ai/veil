import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { act, createElement, type ReactElement } from "react";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation, type FoundationDocument } from "../lib/foundation-types";
import { browserWorldBookStorage } from "../lib/worldbook-storage";
import { normalizeWorldBook, type WorldBookDocument } from "../lib/worldbook";
import { browserThemeStorage } from "../lib/theme-storage";
import { defaultSnapshot } from "../lib/theme-types";

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const settle = async () => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
async function until(check: () => boolean) {
  for (let n = 0; !check(); n++) { assert.ok(n < 100, "mounted UI did not settle"); await settle(); }
}
function seed() {
  return normalizeFoundation({ universe: { id: "primary", name: "Primary", relations: [{ id: "r", characterAId: "a", characterBId: "b", label: "Friends" }] },
    universes: [{ id: "cod", name: "Call of Duty" }], characters: [{ characterId: "a", name: "A", universeId: "primary" },
      { characterId: "b", name: "B", universeId: "primary" }] });
}

async function fixture(initial = seed()) {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/universe", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "FormData"] as const) install(name, dom.window[name]);
  install("self", dom.window); install("BroadcastChannel", undefined); install("IS_REACT_ACT_ENVIRONMENT", true);
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const factory = new IDBFactory(); install("indexedDB", factory);
  Object.defineProperty(dom.window, "indexedDB", { configurable: true, value: factory });
  const old = { load: browserFoundationStorage.load, transact: browserFoundationStorage.transact, subscribe: browserFoundationStorage.subscribe,
    booksLoad: browserWorldBookStorage.load, booksTransact: browserWorldBookStorage.transact, themeLoad: browserThemeStorage.load };
  let document = initial, books: WorldBookDocument = { version: 1, books: [normalizeWorldBook({ name: "Existing", universeId: "primary" })] };
  let refresh: (() => void) | undefined, loadGate: Promise<FoundationDocument> | undefined, saveGate: Promise<void> | undefined;
  let writes = 0;
  browserFoundationStorage.load = async () => loadGate ?? document;
  browserFoundationStorage.subscribe = (listener) => { refresh = listener; return () => { refresh = undefined; }; };
  browserFoundationStorage.transact = async (update) => { writes++; await saveGate; document = normalizeFoundation(update(structuredClone(document))); return document; };
  browserWorldBookStorage.load = async () => books;
  browserWorldBookStorage.transact = async (update) => { books = update(structuredClone(books)); return books; };
  browserThemeStorage.load = async () => ({ version: 1, current: defaultSnapshot(), presets: [] });
  let answer = false; const confirms: string[] = [];
  dom.window.confirm = (message) => { confirms.push(message ?? ""); return answer; };
  const [{ createRoot }, { FoundationProvider }, { AppRouterContext }, { ThemeProvider }] = await Promise.all([
    import("react-dom/client"), import("../components/foundation-provider"), import("next/dist/shared/lib/app-router-context.shared-runtime"), import("../components/theme-provider")]);
  const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (element: ReactElement, theme = false) => act(async () => root.render(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(FoundationProvider, null, theme ? createElement(ThemeProvider, null, element) : element))));
  const button = (text: string) => { const el = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text); assert.ok(el, `missing button ${text}`); return el; };
  const click = (text: string) => act(async () => button(text).click());
  const select = () => dom.window.document.querySelector<HTMLSelectElement>("select")!;
  const choose = (value: string) => act(async () => { select().value = value; select().dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const type = (selector: string, value: string) => act(async () => {
    const el = dom.window.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector); assert.ok(el, selector);
    const proto = el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  return { dom, render, click, button, select, choose, type, confirms, answer: (next: boolean) => { answer = next; },
    document: () => document, books: () => books, writes: () => writes,
    loadGate: (next: Promise<FoundationDocument>) => { loadGate = next; }, saveGate: (next: Promise<void>) => { saveGate = next; },
    replace: async (next: FoundationDocument) => { document = next; await act(async () => refresh?.()); },
    async close() { await act(async () => root.unmount()); browserFoundationStorage.load = old.load; browserFoundationStorage.transact = old.transact;
      browserFoundationStorage.subscribe = old.subscribe; browserWorldBookStorage.load = old.booksLoad; browserWorldBookStorage.transact = old.booksTransact;
      browserThemeStorage.load = old.themeLoad; dom.window.close(); for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      } },
  };
}

for (const kind of ["Universe", "new relation", "existing relation"] as const) {
  for (const transition of ["select", "create"] as const) {
    test(`${kind} draft survives declined ${transition}; accepted discard transitions once`, async () => {
      const ui = await fixture();
      try {
        const { UniversePage } = await import("../components/universe-page"); await ui.render(createElement(UniversePage));
        await until(() => ui.select()?.value === "primary");
        await ui.click(kind === "Universe" ? "Edit" : kind === "new relation" ? "Add relationship" : "Friends");
        const draftSelector = kind === "Universe" ? 'input[name="universe-name"]' : 'section form input[maxlength="100"]';
        await ui.type(draftSelector, "Unsaved draft"); await ui.type('form > label input', "New world");
        const change = () => transition === "select" ? ui.choose("cod") : ui.click("Create Universe");
        await change();
        assert.equal(ui.confirms.length, 1); assert.equal(ui.select().value, "primary"); assert.equal(ui.writes(), 0);
        assert.equal(ui.document().universes?.length, 1);
        assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>(draftSelector)?.value, "Unsaved draft");
        ui.answer(true); await change();
        await until(() => ui.select().value !== "primary");
        assert.equal(ui.confirms.length, 2);
        assert.equal(ui.writes(), transition === "create" ? 1 : 0);
        assert.equal(ui.dom.window.document.querySelector(draftSelector), null);
      } finally { await ui.close(); }
    });
  }
}

for (const kind of ["Universe", "relation"] as const) test(`${kind} save blocks Universe transitions until it commits`, async () => {
  const ui = await fixture(); const pending = deferred<void>();
  try {
    const { UniversePage } = await import("../components/universe-page"); await ui.render(createElement(UniversePage)); await until(() => ui.select()?.value === "primary");
    await ui.click(kind === "Universe" ? "Edit" : "Add relationship");
    await ui.type(kind === "Universe" ? 'input[name="universe-name"]' : 'section form input[maxlength="100"]', "Saved edit");
    ui.saveGate(pending.promise); await ui.click("Save"); await until(() => ui.writes() === 1);
    assert.equal(ui.select().disabled, true); assert.equal(ui.button("Create Universe").disabled, true);
    await ui.choose("cod"); assert.equal(ui.select().value, "primary");
    pending.resolve(); await until(() => !ui.select().disabled);
    assert.equal(ui.select().value, "primary"); assert.equal(ui.writes(), 1);
  } finally { pending.resolve(); await ui.close(); }
});

for (const kind of ["Universe", "new relation", "existing relation"] as const) test(`${kind} clean and reverted drafts leave without a discard prompt`, async () => {
  const ui = await fixture();
  try {
    const { UniversePage } = await import("../components/universe-page"); await ui.render(createElement(UniversePage)); await until(() => ui.select()?.value === "primary");
    const open = () => ui.click(kind === "Universe" ? "Edit" : kind === "new relation" ? "Add relationship" : "Friends");
    await open(); await ui.choose("cod"); assert.equal(ui.confirms.length, 0);
    await ui.choose("primary"); await open();
    const field = kind === "Universe" ? 'input[name="universe-name"]' : 'section form input[maxlength="100"]';
    const original = ui.dom.window.document.querySelector<HTMLInputElement>(field)!.value;
    await ui.type(field, "Temporary"); await ui.type(field, original);
    const context = kind === "Universe" ? 'textarea[name="world-setting"]' : "section form textarea";
    await ui.type(context, "Temporary context"); await ui.type(context, ""); await ui.choose("cod");
    assert.equal(ui.confirms.length, 0); assert.equal(ui.writes(), 0);
  } finally { await ui.close(); }
});

test("failed Universe creation preserves the confirmed old draft and new Universe name for retry", async () => {
  const ui = await fixture(); const pending = deferred<void>();
  try {
    const { UniversePage } = await import("../components/universe-page"); await ui.render(createElement(UniversePage)); await until(() => ui.select()?.value === "primary");
    await ui.click("Edit"); await ui.type('input[name="universe-name"]', "Keep this draft");
    await ui.type('form > label input', "New world"); ui.answer(true); ui.saveGate(pending.promise);
    // The transaction rejects before committing, as a failed local save would.
    const previous = browserFoundationStorage.transact;
    browserFoundationStorage.transact = async () => { await pending.promise; throw new Error("Simulated save failure"); };
    try {
      await ui.click("Create Universe");
      assert.equal(ui.select().disabled, true);
      assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>('form > label input')?.disabled, true);
      pending.resolve(); await until(() => !ui.select().disabled);
      assert.match(ui.dom.window.document.body.textContent!, /Simulated save failure/);
      assert.equal(ui.select().value, "primary"); assert.equal(ui.document().universes?.length, 1);
      assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>('input[name="universe-name"]')?.value, "Keep this draft");
      assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>('form > label input')?.value, "New world");
    } finally { browserFoundationStorage.transact = previous; }
  } finally { pending.resolve(); await ui.close(); }
});

test("new Character saves into the loaded nondefault primary without touching the Universe selector", async () => {
  const ui = await fixture();
  try {
    const { CharacterPage } = await import("../components/profile-pages"); await ui.render(createElement(CharacterPage), true);
    await until(() => !!ui.dom.window.document.querySelector('input[maxlength="100"]'));
    await ui.type('input[maxlength="100"]', "New Character"); await ui.click("Create Character");
    await until(() => ui.document().characters.length === 3);
    assert.equal(ui.document().characters.at(-1)?.universeId, "primary");
  } finally { await ui.close(); }
});

test("WorldBook selection follows loaded primary and falls back after a selected Universe disappears", async () => {
  const ui = await fixture(); const loaded = deferred<FoundationDocument>(); ui.loadGate(loaded.promise);
  try {
    const { WorldBookList } = await import("../components/settings/worldbooks/worldbook-list"); await ui.render(createElement(WorldBookList));
    assert.equal(ui.select().disabled, true);
    loaded.resolve(ui.document()); await until(() => !ui.select().disabled && !ui.button("New").disabled);
    assert.equal(ui.select().value, "primary"); assert.match(ui.dom.window.document.body.textContent!, /Existing/);
    await ui.click("New"); await until(() => ui.books().books.length === 2);
    assert.equal(ui.books().books[1].universeId, "primary");
    await ui.choose("cod"); await ui.click("New"); await until(() => ui.books().books.length === 3);
    assert.equal(ui.books().books[2].universeId, "cod");
    // The next Foundation refresh replaces a previously valid selection.
    const replacement = normalizeFoundation({ ...ui.document(), universes: [] });
    loaded.resolve(replacement);
    // load() is already resolved to the earlier snapshot; switch its authority for this refresh.
    ui.loadGate(Promise.resolve(replacement)); await ui.replace(replacement);
    await until(() => ui.select().value === "primary");
    const file = ui.dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, "files", { configurable: true, value: [{ text: async () => JSON.stringify({ name: "Imported", entries: [] }) }] });
    await act(async () => file.dispatchEvent(new ui.dom.window.Event("change", { bubbles: true })));
    await until(() => ui.books().books.length === 4);
    assert.equal(ui.books().books[3].universeId, "primary");
    assert.ok(!ui.books().books.some((b) => b.universeId === "veil-universe"));
  } finally { loaded.resolve(ui.document()); await ui.close(); }
});
