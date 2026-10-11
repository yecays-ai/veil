import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createIndexedDBFoundationStorage, browserFoundationStorage } from "../lib/foundation-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import { browserApiConfigStorage } from "../lib/api-config-storage";
import { setRoutineIssue } from "../lib/presence/routine-issue";

async function mounted(run: (app: {
  dom: JSDOM; container: HTMLElement; render: (child: ReactNode) => Promise<void>;
  click: (button: HTMLButtonElement) => Promise<void>; wait: (check: () => boolean) => Promise<void>;
  cleanup: () => Promise<void>; pushed: string[];
}) => Promise<void>) {
  const dom = new JSDOM('<div class="phone-shell"><div class="phone-content"><div id="root"></div></div><div id="unrelated-scroll"></div></div>',
    { url: "http://localhost/", pretendToBeVisual: true });
  const names = ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "IS_REACT_ACT_ENVIRONMENT"];
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
  const router = { bfcacheId: "profile-view-scroll-test", push(href: string) { pushed.push(href); }, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
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
  try { await run({ dom, container, render, click, wait, cleanup, pushed }); }
  finally { await cleanup(); }
}


const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
const NOTE = /Life rhythm not generated: no Text API is available/;

test("a routine failure that arrives after the save is shown on the Character page, survives leaving and returning, and clears on the next save", async () => {
  await mounted(async (app) => {
    const pages = await import("../components/profile-pages");
    let release!: () => void;
    let gate = new Promise<void>((resolve) => { release = resolve; });
    const original = browserApiConfigStorage.getApiConfig;
    let lookups = 0;
    browserApiConfigStorage.getApiConfig = async () => { lookups++; await gate; return undefined; };
    try {
      const open = () => app.render(createElement(pages.CharacterPage, { characterId: "p" }));
      const edit = async (backstory: string) => {
        await app.wait(() => !!button(app.container, "Edit"));
        await app.click(button(app.container, "Edit")!);
        const field = app.container.querySelector<HTMLTextAreaElement>("#profile-backstory")!;
        await act(async () => {
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, backstory);
          field.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
        });
        await app.click(button(app.container, "Save")!);
        await app.wait(() => !app.container.querySelector("form"));
      };
      await open();
      await edit("A new backstory.");
      // The save has finished and the page is back in view mode; the model request is still pending.
      assert.ok(!NOTE.test(app.container.textContent ?? ""), "nothing is said while the request is running");
      await app.wait(() => lookups === 1);
      release();
      // The same page instance updates by itself, with no reload or re-entry.
      await app.wait(() => NOTE.test(app.container.textContent ?? ""));
      assert.equal(app.container.querySelector('[role="status"]')?.textContent?.match(NOTE) !== null, true);
      // Leaving the page and coming back in the same session still shows the reason.
      await app.render(createElement("div", null, "elsewhere"));
      await open();
      await app.wait(() => !!button(app.container, "Edit"));
      assert.match(app.container.textContent ?? "", NOTE);
      // The next save clears the old note at once; it comes back only if that attempt fails too.
      gate = new Promise<void>((resolve) => { release = resolve; });
      await edit("Another backstory.");
      assert.ok(!NOTE.test(app.container.textContent ?? ""), "the old note is cleared by the next save");
      release();
      await app.wait(() => NOTE.test(app.container.textContent ?? ""));
      assert.equal(lookups, 2, "one model-side lookup per save, no retries");
    } finally {
      browserApiConfigStorage.getApiConfig = original;
      setRoutineIssue("p", null);
    }
  });
});

test("a failure recorded for a Character is visible when its page mounts, whatever page the save came from", async () => {
  await mounted(async (app) => {
    const pages = await import("../components/profile-pages");
    setRoutineIssue("p", "truncated");
    try {
      await app.render(createElement(pages.CharacterPage, { characterId: "p" }));
      await app.wait(() => !!button(app.container, "Edit"));
      assert.match(app.container.textContent ?? "", /the model's reply was cut off/);
      await app.render(createElement(pages.CharacterPage, { characterId: "unrelated" }));
      assert.doesNotMatch(app.container.textContent ?? "", /Life rhythm not generated/);
    } finally { setRoutineIssue("p", null); }
  });
});
