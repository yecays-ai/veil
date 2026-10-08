import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import { IDBFactory } from "fake-indexeddb";
import { ApiConfigStorage, browserApiConfigStorage } from "../lib/api-config-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createIndexedDBFoundationStorage, browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import { deleteCharacter, updateCharacter } from "../lib/foundation";

const config = { id: "api", name: "Original API", provider: "Custom" as const,
  baseUrl: "https://example.test/v1", apiKey: "test-only", model: "test" };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function mounted() {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("use-bindings")) return { useBindings: () => ({
      bindings: { global: {}, characters: {} }, ready: true, error: "", commit: async () => { throw new Error("outside test scope"); },
    }) };
    return originalLoad.call(this, request, ...args);
  };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { FoundationProvider, useFoundation } = await import("../components/foundation-provider");
  const { TextApiSettings } = await import("../components/settings/text-api-settings");
  const { CharacterPage } = await import("../components/profile-pages");
  const factory = new IDBFactory(), api = new ApiConfigStorage(() => factory);
  const foundation = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => factory));
  const initial = normalizeFoundation({ characters: [{ characterId: "p", name: "Peter" }] });
  await foundation.transact(() => initial);
  await api.saveApiConfig(config);
  const originalApi = { list: browserApiConfigStorage.listApiConfigs, save: browserApiConfigStorage.saveApiConfig };
  const originalFoundation = { load: browserFoundationStorage.load, transact: browserFoundationStorage.transact };
  browserApiConfigStorage.listApiConfigs = api.listApiConfigs.bind(api);
  browserApiConfigStorage.saveApiConfig = api.saveApiConfig.bind(api);
  browserFoundationStorage.load = foundation.load.bind(foundation);
  browserFoundationStorage.transact = foundation.transact.bind(foundation);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const container = dom.window.document.getElementById("root")!;
  const pushes: string[] = [];
  const router = { bfcacheId: "stale-editor-test", push: (href: string) => { pushes.push(href); }, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = (child: ReactNode) => act(async () => { root.render(createElement(AppRouterContext.Provider,
    { value: router }, createElement(PathnameContext.Provider, { value: "/characters/p" },
      createElement(FoundationProvider, null, child)))); });
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) {
      assert.ok(Date.now() < deadline, "mounted editor did not settle within 2.5s");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  };
  const click = (element: HTMLElement) => act(async () => { element.click(); });
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name)!;
  const input = () => container.querySelector<HTMLInputElement>('input:not([type="file"])')!;
  const type = (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const submit = () => act(async () => {
    container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    browserApiConfigStorage.listApiConfigs = originalApi.list;
    browserApiConfigStorage.saveApiConfig = originalApi.save;
    browserFoundationStorage.load = originalFoundation.load;
    browserFoundationStorage.transact = originalFoundation.transact;
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { api, foundation, initial, container, pushes, render, wait, click, button, input, type, submit, cleanup,
    TextApiSettings, CharacterPage, useFoundation };
}

test("Text API old editor reports conflict, keeps its draft and can reopen the latest version", async () => {
  const app = await mounted();
  try {
    await app.render(createElement(app.TextApiSettings));
    await app.wait(() => !!app.container.querySelector(".settings-config-card"));
    await app.click(app.container.querySelector<HTMLButtonElement>(".settings-config-card")!);
    await app.type("Local draft");
    await app.api.saveApiConfig({ ...config, name: "Peer version" }, config);
    await app.submit();
    await app.wait(() => app.container.textContent?.includes("changed or was deleted elsewhere") === true);
    assert.equal(app.input().value, "Local draft");
    assert.equal((await app.api.getApiConfig(config.id))?.name, "Peer version");
    await app.click(app.button("Close Edit Text API"));
    await app.click(app.button("Discard changes"));
    await app.click(app.container.querySelector<HTMLButtonElement>(".settings-config-card")!);
    assert.equal(app.input().value, "Peer version");
    await app.type("Reviewed draft"); await app.submit();
    await app.wait(() => !app.container.querySelector("#text-api-editor"));
    assert.equal((await app.api.getApiConfig(config.id))?.name, "Reviewed draft");
  } finally { await app.cleanup(); }
});

test("Text API failed save keeps the draft, retries explicitly, and needs no post-write list read", async () => {
  const app = await mounted();
  try {
    await app.render(createElement(app.TextApiSettings));
    await app.wait(() => !!app.container.querySelector(".settings-config-card"));
    await app.click(app.container.querySelector<HTMLButtonElement>(".settings-config-card")!);
    await app.type("Retry draft");
    let fail = true;
    browserApiConfigStorage.saveApiConfig = (...args) => {
      if (fail) { fail = false; return Promise.reject(new Error("disk full")); }
      return app.api.saveApiConfig(...args);
    };
    browserApiConfigStorage.listApiConfigs = async () => { throw new Error("unexpected post-write read"); };
    await app.submit(); await app.wait(() => app.container.textContent?.includes("disk full") === true);
    assert.equal(app.input().value, "Retry draft");
    assert.equal((await app.api.getApiConfig(config.id))?.name, config.name);
    await app.submit(); await app.wait(() => !app.container.querySelector("#text-api-editor"));
    assert.equal((await app.api.getApiConfig(config.id))?.name, "Retry draft");
    assert.equal(app.container.textContent?.includes("unexpected post-write read"), false);
  } finally { await app.cleanup(); }
});

test("Text API late retry read cannot replace a newer read or a successful write", async () => {
  const app = await mounted(), late = deferred<Awaited<ReturnType<ApiConfigStorage["listApiConfigs"]>>>();
  try {
    let calls = 0;
    browserApiConfigStorage.listApiConfigs = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("load failed"));
      if (calls === 2) return late.promise;
      return app.api.listApiConfigs();
    };
    await app.render(createElement(app.TextApiSettings));
    await app.wait(() => !!app.button("Retry loading Text APIs"));
    await app.click(app.button("Retry loading Text APIs"));
    await app.api.saveApiConfig({ ...config, name: "Newer read" }, config);
    await app.click(app.button("Retry loading Text APIs"));
    await app.wait(() => app.container.textContent?.includes("Newer read") === true);
    await app.click(app.container.querySelector<HTMLButtonElement>(".settings-config-card")!);
    await app.type("Saved version"); await app.submit();
    await app.wait(() => !app.container.querySelector("#text-api-editor"));
    await act(async () => { late.resolve([config]); await late.promise; });
    assert.equal(app.container.textContent?.includes("Saved version"), true);
    assert.equal(app.container.textContent?.includes(config.name), false);
  } finally { late.resolve([config]); await app.cleanup(); }
});

test("Character conflict and deletion both preserve the mounted form draft", async () => {
  for (const deleted of [false, true]) {
    const app = await mounted();
    try {
      await app.render(createElement(app.CharacterPage, { characterId: "p" }));
      await app.wait(() => !!app.button("Edit")); await app.click(app.button("Edit"));
      // ProfileForm's first non-file input is the Avatar URL; select the required name field explicitly.
      const name = app.container.querySelector<HTMLInputElement>('input[required]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Local character draft");
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await app.foundation.transact((current) => deleted ? deleteCharacter(current, "p")
        : updateCharacter(current, "p", { ...current.characters[0], name: "Peer character" }));
      await app.submit();
      await app.wait(() => app.container.textContent?.includes("draft was not saved") === true);
      assert.equal(app.container.querySelector<HTMLInputElement>('input[required]')?.value, "Local character draft");
      const stored = await app.foundation.load();
      assert.equal(stored.characters[0]?.name, deleted ? undefined : "Peer character");
      assert.deepEqual(app.pushes, []);
    } finally { await app.cleanup(); }
  }
});

test("Character route reuse never carries another identity's editing baseline or draft", async () => {
  const app = await mounted();
  try {
    await app.foundation.transact((current) => ({ ...current,
      characters: [...current.characters, { ...current.characters[0], characterId: "q", name: "Pep" }] }));
    await app.render(createElement(app.CharacterPage, { characterId: "p" }));
    await app.wait(() => !!app.button("Edit")); await app.click(app.button("Edit"));
    const name = app.container.querySelector<HTMLInputElement>('input[required]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Peter draft");
      name.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await app.render(createElement(app.CharacterPage, { characterId: "q" }));
    assert.equal(app.container.querySelector("form"), null);
    assert.equal(app.container.textContent?.includes("Peter draft"), false);
    await app.click(app.button("Edit"));
    assert.equal(app.container.querySelector<HTMLInputElement>('input[required]')?.value, "Pep");
    assert.equal((await app.foundation.load()).characters[0].name, "Peter");
  } finally { await app.cleanup(); }
});

test("Character persistence failure keeps its draft and the provider queue accepts a retry", async () => {
  const app = await mounted();
  try {
    await app.render(createElement(app.CharacterPage, { characterId: "p" }));
    await app.wait(() => !!app.button("Edit")); await app.click(app.button("Edit"));
    const name = app.container.querySelector<HTMLInputElement>('input[required]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Retry character");
      name.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    let fail = true;
    browserFoundationStorage.transact = (update) => { if (fail) { fail = false; return Promise.reject(new Error("write failed")); }
      return app.foundation.transact(update); };
    await app.submit(); await app.wait(() => app.container.textContent?.includes("write failed") === true);
    assert.equal(app.container.querySelector<HTMLInputElement>('input[required]')?.value, "Retry character");
    await app.submit(); await app.wait(() => !app.container.querySelector("form"));
    assert.equal((await app.foundation.load()).characters[0].name, "Retry character");
  } finally { await app.cleanup(); }
});

test("Foundation publishes serial durable results, including a delayed earlier result", async () => {
  const app = await mounted(), release = deferred<void>();
  try {
    let current!: ReturnType<typeof app.useFoundation>;
    function Probe() { current = app.useFoundation(); return createElement("p", null, current.document.characters[0]?.name); }
    await app.render(createElement(Probe)); await app.wait(() => current.ready);
    let writes = 0;
    browserFoundationStorage.transact = async (update) => {
      writes++; const result = await app.foundation.transact(update);
      if (writes === 1) await release.promise;
      return result;
    };
    let first!: Promise<unknown>, second!: Promise<unknown>;
    await act(async () => {
      first = current.commit((d) => updateCharacter(d, "p", { ...d.characters[0], name: "First" }));
      second = current.commit((d) => updateCharacter(d, "p", { ...d.characters[0], name: "Second" }));
    });
    await app.wait(() => writes === 1);
    assert.equal(writes, 1, "the second write cannot publish while the first result is pending");
    await act(async () => { release.resolve(); await Promise.all([first, second]); });
    assert.equal(app.container.textContent, "Second");
    assert.equal((await app.foundation.load()).characters[0].name, "Second");
  } finally { release.resolve(); await app.cleanup(); }
});
