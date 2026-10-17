import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";

import { chatStorage } from "../lib/chat/storage";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "timed out waiting for the mounted conversation list");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function checkUniverseSetup() {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
    url: "http://localhost/messages",
    pretendToBeVisual: true,
  });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "FormData"] as const)
    install(name, dom.window[name]);
  install("self", dom.window);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("BroadcastChannel", undefined);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const factory = new IDBFactory();
  install("indexedDB", factory);
  Object.defineProperty(dom.window, "indexedDB", { configurable: true, value: factory });

  const previousLoad = browserFoundationStorage.load;
  const previousTransact = browserFoundationStorage.transact;
  const previousList = chatStorage.listSessions;
  const previousSubscribe = chatStorage.subscribe;
  const { createRoot } = await import("react-dom/client");
  let root: Root | undefined;
  try {
    let document = normalizeFoundation({});
    browserFoundationStorage.load = async () => document;
    browserFoundationStorage.transact = async (update) => { document = normalizeFoundation(update(structuredClone(document))); return document; };
    const [{ FoundationProvider }, { UniversePage }, { ProfileForm }, { AppRouterContext }, { normalizeCharacterInput }, { allUniverses }] = await Promise.all([
      import("../components/foundation-provider"), import("../components/universe-page"), import("../components/profile-form"),
      import("next/dist/shared/lib/app-router-context.shared-runtime"), import("../lib/foundation-types"), import("../lib/universe") ]);
    const router = { prefetch() {}, push() {}, replace() {}, back() {}, forward() {}, refresh() {} };
    const render = async (element: ReturnType<typeof createElement>) => {
      await act(async () => root!.render(createElement(AppRouterContext.Provider, { value: router as never }, createElement(FoundationProvider, null, element))));
    };
    root = createRoot(dom.window.document.getElementById("root")!);
    await render(createElement(UniversePage)); await waitFor(() => !!dom.window.document.querySelector('input[name="universe-name"]') || !!dom.window.document.querySelector('input[maxlength="100"]'));
    const type = async (input: HTMLInputElement, value: string) => {
      await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    };
    const button = (text: string) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === text)!;
    await type(dom.window.document.querySelector<HTMLInputElement>('input[maxlength="100"]')!, "Spider-Man");
    await act(async () => button("Create Universe").click()); await waitFor(() => allUniverses(document).length === 2);
    const spiderId = allUniverses(document)[1].id;
    await type(dom.window.document.querySelector<HTMLInputElement>('input[maxlength="100"]')!, "Call of Duty");
    await act(async () => button("Create Universe").click()); await waitFor(() => allUniverses(document).length === 3);
    const codId = allUniverses(document)[2].id;
    await act(async () => button("Edit").click());
    await type(dom.window.document.querySelector<HTMLInputElement>('input[name="universe-name"]')!, "Call of Duty renamed");
    await act(async () => button("Save").click()); await waitFor(() => allUniverses(document)[2].name === "Call of Duty renamed");
    assert.equal(allUniverses(document)[1].name, "Spider-Man");
    let saved = "";
    await render(createElement(ProfileForm, { kind: "character", initial: normalizeCharacterInput({ name: "Peter" }),
      universes: allUniverses(document), onSave: async (input) => { saved = (input as { universeId: string }).universeId; } }));
    const select = dom.window.document.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = spiderId; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await act(async () => button("Save").click()); await waitFor(() => saved === spiderId);
    await render(createElement(ProfileForm, { key: "existing", kind: "character", initial: normalizeCharacterInput({ name: "Ghost", universeId: codId }),
      lockUniverse: true, universes: allUniverses(document), onSave: async () => {} }));
    const locked = dom.window.document.querySelector<HTMLSelectElement>("select")!;
    assert.equal(locked.disabled, true); assert.equal(locked.value, codId);
    assert.match(locked.textContent!, /Spider-Man.*Call of Duty renamed/);
  } finally {
    await act(async () => root?.unmount());
    browserFoundationStorage.load = previousLoad;
    browserFoundationStorage.transact = previousTransact;
    chatStorage.listSessions = previousList;
    chatStorage.subscribe = previousSubscribe;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

test("mounted Universe creation and rename remain independent; Character form chooses and displays fixed ownership", checkUniverseSetup);
