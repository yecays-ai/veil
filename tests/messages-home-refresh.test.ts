import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ChatSession } from "../lib/chat/types";
import { chatStorage, type ChatStorageChange } from "../lib/chat/storage";
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

async function checkStaleCompletion(staleResult: "success" | "error") {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
    url: "http://localhost/messages",
    pretendToBeVisual: true,
  });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage"] as const)
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
  const previousList = chatStorage.listSessions;
  const previousSubscribe = chatStorage.subscribe;
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    browserFoundationStorage.load = async () => document;
    const oldRows = deferred<ChatSession[]>();
    let reads = 0;
    let listener: ((change: ChatStorageChange) => void) | undefined;
    chatStorage.listSessions = () => {
      reads++;
      return reads === 1 ? oldRows.promise : Promise.resolve([row("Newest preview", 20)]);
    };
    chatStorage.subscribe = (callback) => {
      listener = callback;
      return () => { listener = undefined; };
    };

    const [{ FoundationProvider }, { MessagesHome }, { AppRouterContext }] = await Promise.all([
      import("../components/foundation-provider"),
      import("../components/chat/messages-home"),
      import("next/dist/shared/lib/app-router-context.shared-runtime"),
    ]);
    const router = { prefetch() {}, push() {}, replace() {}, back() {}, forward() {}, refresh() {} };
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root!.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(FoundationProvider, null, createElement(MessagesHome)))));
    await waitFor(() => reads === 1 && !!listener);

    await act(async () => listener!({ domain: "messages", sessionId: "session-a" }));
    await waitFor(() => reads === 2 && dom.window.document.querySelector(".conversation-preview")?.textContent === "Newest preview");

    await act(async () => {
      if (staleResult === "success") oldRows.resolve([row("Stale preview", 10)]);
      else oldRows.reject(new Error("obsolete list failure"));
      await settle();
    });
    await settle();

    assert.equal(reads, 2, "the existing subscription starts exactly one newer refresh");
    assert.equal(dom.window.document.querySelector(".conversation-preview")?.textContent, "Newest preview");
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Could not load conversations/);
  } finally {
    await act(async () => root?.unmount());
    browserFoundationStorage.load = previousLoad;
    chatStorage.listSessions = previousList;
    chatStorage.subscribe = previousSubscribe;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

test("mounted MessagesHome ignores an older list success after a newer refresh renders", async () => {
  await checkStaleCompletion("success");
});

test("mounted MessagesHome ignores an older list error after a newer refresh succeeds", async () => {
  await checkStaleCompletion("error");
});
