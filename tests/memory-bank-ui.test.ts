import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createIndexedDBFoundationStorage, browserFoundationStorage } from "../lib/foundation-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { MemoryStorage } from "../lib/memory/storage";

// Mount helper copied from character-routine-note-ui.test.ts (same Foundation fixture and router stub).
async function mounted(run: (app: {
  dom: JSDOM; container: HTMLElement; render: (child: ReactNode) => Promise<void>;
  click: (button: HTMLButtonElement) => Promise<void>; wait: (check: () => boolean) => Promise<void>;
  cleanup: () => Promise<void>; pushed: string[]; factory: IDBFactory;
}) => Promise<void>) {
  const dom = new JSDOM('<div class="phone-shell"><div class="phone-content"><div id="root"></div></div><div id="unrelated-scroll"></div></div>',
    { url: "http://localhost/", pretendToBeVisual: true });
  const names = ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name as keyof typeof dom.window] }));
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) {
    if (request.endsWith(".css")) return {};
    return originalLoad.call(this, request, ...args);
  };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { ThemeProvider } = await import("../components/theme-provider");
  const factory = new IDBFactory();
  const storage = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => factory));
  await storage.transact(() => normalizeFoundation({
    user: { name: "Profile owner", aboutMe: "A profile long enough to scroll." },
    characters: [{ characterId: "p", name: "Peter", backstory: "A character profile long enough to scroll." }],
  }));
  const original = { load: browserFoundationStorage.load, transact: browserFoundationStorage.transact };
  browserFoundationStorage.load = storage.load.bind(storage);
  browserFoundationStorage.transact = storage.transact.bind(storage);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const pushed: string[] = [];
  const router = { bfcacheId: "memory-bank-ui-test", push(href: string) { pushed.push(href); }, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = (child: ReactNode) => act(async () => root.render(createElement(StrictMode, null,
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: "/profile/details" },
        createElement(ThemeProvider, null, createElement(FoundationProvider, null, child)))))));
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) {
      assert.ok(Date.now() < deadline, "mounted profile did not reach the expected state");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  };
  const click = (button: HTMLButtonElement) => act(async () => { button.click(); });
  const cleanup = async () => {
    await act(async () => root.unmount());
    Object.assign(browserFoundationStorage, original);
    loader._load = originalLoad;
    dom.window.close();
    names.forEach((name, i) => { if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name); });
  };
  try { await run({ dom, container, render, click, wait, cleanup, pushed, factory }); }
  finally { await cleanup(); }
}



const button = (container: HTMLElement, label: string | RegExp) =>
  [...container.ownerDocument.querySelectorAll("button")].find((item) => typeof label === "string"
    ? item.textContent?.trim() === label : label.test(item.textContent ?? "")) as HTMLButtonElement | undefined;
const passthrough: PersistenceWriteGate = { withWrite: (operation) => operation() };

test("the Character page links to its Memory Bank", async () => {
  await mounted(async (app) => {
    const pages = await import("../components/profile-pages");
    await app.render(createElement(pages.CharacterPage, { characterId: "p" }));
    await app.wait(() => !!app.container.querySelector('a[href="/characters/p/memory"]'));
  });
});

test("the Memory Bank adds, deletes and undoes a memory, and the undo survives a reload", async () => {
  await mounted(async (app) => {
    const { MemoryBankPage } = await import("../components/memory-bank");
    let clock = 1000;
    const storage = new MemoryStorage(() => app.factory, () => ++clock, passthrough);
    await app.render(createElement(MemoryBankPage, { characterId: "p", storage }));
    await app.wait(() => app.container.textContent!.includes("No memories yet."));
    assert.equal(button(app.container, "Nothing to undo")?.disabled, true);

    await app.click(button(app.container, "Add memory")!);
    const textarea = app.dom.window.document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Afraid of thunder");
      textarea.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    await app.click(button(app.container, "Save")!);
    await app.wait(() => !!app.container.querySelector('[aria-label="Memories"]')?.textContent?.includes("Afraid of thunder"));
    assert.equal((await storage.listMemories("p"))[0].origin, "manual");

    await app.click(button(app.container, "Delete")!);
    const dialog = app.dom.window.document.querySelector('[role="dialog"]')!;
    await app.click([...dialog.querySelectorAll("button")].find((item) => item.textContent === "Delete") as HTMLButtonElement);
    await app.wait(() => app.container.textContent!.includes("No memories yet."));
    assert.equal((await storage.listSuppressions("p")).length, 1);

    // A new page instance reads the undo history from storage.
    await app.render(createElement("div"));
    const reloaded = new MemoryStorage(() => app.factory, () => ++clock, passthrough);
    await app.render(createElement(MemoryBankPage, { characterId: "p", storage: reloaded }));
    await app.wait(() => !!button(app.container, "Undo: Deleted a memory"));
    await app.click(button(app.container, "Undo: Deleted a memory")!);
    await app.wait(() => !!app.container.querySelector('[aria-label="Memories"]')?.textContent?.includes("Afraid of thunder"));
    assert.deepEqual(await reloaded.listSuppressions("p"), []);
    await app.wait(() => !!button(app.container, "Undo: Added a memory"));
  });
});

test("a Memory Bank for an unknown Character shows not found and offers no edits", async () => {
  await mounted(async (app) => {
    const { MemoryBankPage } = await import("../components/memory-bank");
    const storage = new MemoryStorage(() => app.factory, () => 1, passthrough);
    await app.render(createElement(MemoryBankPage, { characterId: "nobody", storage }));
    await app.wait(() => app.container.textContent!.includes("Character not found."));
    assert.equal(button(app.container, "Add memory"), undefined);
  });
});

test("an edit that collides with another tab keeps the user's text and saves on the second try", async () => {
  await mounted(async (app) => {
    const { MemoryBankPage } = await import("../components/memory-bank");
    const { addManualMemory, editMemory } = await import("../lib/memory/bank");
    let clock = 1000;
    const storage = new MemoryStorage(() => app.factory, () => ++clock, passthrough);
    const otherTab = new MemoryStorage(() => app.factory, () => ++clock, passthrough);
    await addManualMemory(storage, "p", { kind: "fact", text: "Lives by the sea" });
    await app.render(createElement(MemoryBankPage, { characterId: "p", storage }));
    await app.wait(() => !!button(app.container, "Edit"));
    await app.click(button(app.container, "Edit")!);
    const textarea = app.dom.window.document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Lives in the mountains");
      textarea.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    await editMemory(otherTab, (await otherTab.listMemories("p"))[0], { kind: "fact", text: "Lives in a city" });

    await app.click(button(app.container, "Save")!);
    await app.wait(() => !!app.dom.window.document.querySelector('[role="dialog"]')?.textContent?.includes("changed somewhere else"));
    assert.equal(app.dom.window.document.querySelector("textarea")!.value, "Lives in the mountains");
    assert.equal((await storage.listMemories("p"))[0].text, "Lives in a city");

    await app.click(button(app.container, "Save")!);
    await app.wait(() => !app.dom.window.document.querySelector('[role="dialog"]'));
    assert.equal((await storage.listMemories("p"))[0].text, "Lives in the mountains");
  });
});

test("the Journal section adds a keyword entry apart from the memory list, and delete removes it", async () => {
  await mounted(async (app) => {
    const { MemoryBankPage } = await import("../components/memory-bank");
    let clock = 1000;
    const storage = new MemoryStorage(() => app.factory, () => ++clock, passthrough);
    await app.render(createElement(MemoryBankPage, { characterId: "p", storage }));
    await app.wait(() => app.container.textContent!.includes("No Journal entries yet."));
    await app.click(button(app.container, "Add Journal entry")!);
    const [text, keywords] = [...app.dom.window.document.querySelectorAll("textarea")];
    const set = (area: Element, value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
      area.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    await set(text, "Grew up near the lake");
    await set(keywords, "lake, 湖");
    await app.click(button(app.container, "Save")!);
    await app.wait(() => !!app.container.querySelector('[aria-label="Journal entries"]')?.textContent?.includes("Keywords: lake, 湖"));
    assert.equal(app.container.querySelector('[aria-label="Memories"]'), null, "journal rows stay out of the memory list");
    assert.deepEqual((await storage.listMemories("p")).map((row) => [row.origin, row.keywords]), [["journal", ["lake", "湖"]]]);
    await app.click(button(app.container, "Delete")!);
    const dialog = app.dom.window.document.querySelector('[role="dialog"]')!;
    await app.click([...dialog.querySelectorAll("button")].find((item) => item.textContent === "Delete") as HTMLButtonElement);
    await app.wait(() => app.container.textContent!.includes("No Journal entries yet."));
    assert.deepEqual(await storage.listSuppressions("p"), []);
  });
});
