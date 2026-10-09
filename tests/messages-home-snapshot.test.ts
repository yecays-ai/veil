import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ChatSession } from "../lib/chat/types";
import { chatStorage } from "../lib/chat/storage";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "timed out waiting for the mounted conversation list");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

const row = (lastMessagePreview: string, updatedAt: number): ChatSession => ({
  id: "session-a",
  characterId: "a",
  updatedAt,
  lastMessagePreview,
  autoReplyOnKeyboardDismiss: false,
  nextOrder: 1,
});

async function checkRemount() {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/messages", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage"] as const) install(name, dom.window[name]);
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
  const previousLoad = browserFoundationStorage.load, previousList = chatStorage.listSessions, previousSubscribe = chatStorage.subscribe;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    browserFoundationStorage.load = async () => document;
    const second = deferred<ChatSession[]>();
    let reads = 0;
    chatStorage.listSessions = () => { reads++; return reads === 1 ? Promise.resolve([row("First visit", 10)]) : second.promise; };
    chatStorage.subscribe = () => () => {};
    const [{ FoundationProvider }, { MessagesHome }, { AppRouterContext }] = await Promise.all([
      import("../components/foundation-provider"), import("../components/chat/messages-home"),
      import("next/dist/shared/lib/app-router-context.shared-runtime"),
    ]);
    const router = { prefetch() {}, push() {}, replace() {}, back() {}, forward() {}, refresh() {} };
    root = createRoot(dom.window.document.getElementById("root")!);
    const view = () => root!.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(FoundationProvider, null, createElement(MessagesHome))));
    await act(async () => view());
    await waitFor(() => dom.window.document.querySelector(".conversation-preview")?.textContent === "First visit");

    await act(async () => root!.render(createElement("div", { id: "elsewhere" })));
    await act(async () => view()); // returning to Chats: the second read is still pending
    const text = dom.window.document.body.textContent ?? "";
    assert.doesNotMatch(text, /Loading conversations/, "the last list fills the first frame instead of a loading notice");
    assert.equal(dom.window.document.querySelector(".conversation-preview")?.textContent, "First visit");
    assert.equal(reads, 2, "the list is still read again on every visit");

    await act(async () => { second.resolve([row("Second visit", 20)]); await settle(); });
    await waitFor(() => dom.window.document.querySelector(".conversation-preview")?.textContent === "Second visit");
  } finally {
    await act(async () => root?.unmount());
    browserFoundationStorage.load = previousLoad; chatStorage.listSessions = previousList; chatStorage.subscribe = previousSubscribe;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

test("returning to Chats paints the last list at once and replaces it when the read finishes", async () => {
  await checkRemount();
});
