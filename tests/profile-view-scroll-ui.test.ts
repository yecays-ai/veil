import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createIndexedDBFoundationStorage, browserFoundationStorage } from "../lib/foundation-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { normalizeFoundation } from "../lib/foundation-types";

async function mounted(run: (app: {
  dom: JSDOM; container: HTMLElement; render: (child: ReactNode) => Promise<void>;
  click: (button: HTMLButtonElement) => Promise<void>; wait: (check: () => boolean) => Promise<void>;
  cleanup: () => Promise<void>;
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
  const router = { bfcacheId: "profile-view-scroll-test", push() {}, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
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
  try { await run({ dom, container, render, click, wait, cleanup }); }
  finally { await cleanup(); }
}

for (const kind of ["user", "character"] as const) {
  test(`${kind} profile returns from Edit to the top of its own page body`, async () => {
    await mounted(async (app) => {
      const pages = await import("../components/profile-pages");
      await app.render(kind === "user" ? createElement(pages.UserProfilePage) : createElement(pages.CharacterPage, { characterId: "p" }));
      await app.wait(() => [...app.container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Edit"));
      const phoneContent = app.dom.window.document.querySelector<HTMLElement>(".phone-content")!;
      const body = app.container.querySelector<HTMLElement>('[data-ui="body"]')!;
      const unrelated = app.dom.window.document.getElementById("unrelated-scroll")!;
      phoneContent.scrollTop = 41;
      unrelated.scrollTop = 73;
      await app.click([...app.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!);
      assert.ok(app.container.querySelector("form"), "the existing edit form opens");
      body.scrollTop = 219;
      phoneContent.scrollTop = 41;
      await app.click([...app.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Cancel")!);
      await app.wait(() => !app.container.querySelector("form"));
      assert.equal(body.scrollTop, 0, "the actual .app-page-body scroll position returns to the top");
      assert.equal(phoneContent.scrollTop, 41, "the overflow-hidden phone shell is not used as the scroll target");
      assert.equal(unrelated.scrollTop, 73, "an unrelated scroll container is untouched");
      await app.click([...app.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Edit")!);
      assert.ok(app.container.querySelector("form"), "re-entering Edit still opens the original form");
      await app.click([...app.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Cancel")!);
      assert.equal(body.scrollTop, 0, "repeated display entry stays at the top under StrictMode");
    });
  });
}
