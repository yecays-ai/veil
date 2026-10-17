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

async function checkUniverseList() {
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
    const document = normalizeFoundation({ universe: { id: "veil-universe", name: "Spider-Man" },
      universes: [{ id: "cod", name: "Call of Duty" }], characters: [
        { characterId: "a", name: "Peter", universeId: "veil-universe" }, { characterId: "b", name: "Ghost", universeId: "cod" }] });
    browserFoundationStorage.load = async () => document;
    let rows: ChatSession[] = [ { ...row("Peter preview", 20), universeId: "veil-universe" },
      { ...row("Ghost preview", 10), id: "session-b", characterId: "b", universeId: "cod" },
      { ...row("Group preview", 5), id: "group", characterId: "b", participantIds: ["b"], type: "group", title: "COD group", universeId: "cod" } ];
    let listener: ((change: ChatStorageChange) => void) | undefined;
    chatStorage.listSessions = async () => rows;
    chatStorage.subscribe = (callback) => { listener = callback; return () => { listener = undefined; }; };

    const [{ FoundationProvider }, { MessagesHome }, { AppRouterContext }] = await Promise.all([
      import("../components/foundation-provider"),
      import("../components/chat/messages-home"),
      import("next/dist/shared/lib/app-router-context.shared-runtime"),
    ]);
    const router = { prefetch() {}, push() {}, replace() {}, back() {}, forward() {}, refresh() {} };
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root!.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(FoundationProvider, null, createElement(MessagesHome)))));
    const links = () => [...dom.window.document.querySelectorAll(".conversation-row")].map((el) => el.getAttribute("href"));
    await waitFor(() => links().length === 3 && dom.window.document.body.textContent!.includes("Ghost"));
    const click = async (group: string, label: string) => {
      const button = [...dom.window.document.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)].find((b) => b.textContent === label)!;
      assert.ok(button, `missing ${group} / ${label}`);
      await act(async () => button.click());
    };
    await click("Universe", "Spider-Man"); assert.deepEqual(links(), ["/messages/a"]);
    // A hidden world's new message still refreshes storage and sorting.
    rows = rows.map((r) => r.id === "session-b" ? { ...r, updatedAt: 50, lastMessagePreview: "Ghost new message", unreadCount: 1 } : r);
    await act(async () => { listener!({ domain: "messages", sessionId: "session-b" }); await settle(); });
    assert.deepEqual(links(), ["/messages/a"]);
    await click("Universe", "All"); assert.equal(links()[0], "/messages/b"); assert.equal(links().length, 3);
    assert.match(dom.window.document.body.textContent!, /Ghost new message/);
    await click("Universe", "Call of Duty"); assert.equal(links().length, 2);
    await click("Conversation type", "Private"); assert.deepEqual(links(), ["/messages/b"]);
    await click("Conversation type", "Groups"); assert.deepEqual(links(), ["/messages/group/group"]);
    await click("Universe", "Spider-Man"); assert.equal(links().length, 0);
    await click("Universe", "All"); assert.deepEqual(links(), ["/messages/group/group"]);
    await click("Conversation type", "All"); assert.equal(links().length, 3);
    // A new page starts at All and reloads the same globally stored sessions.
    await act(async () => root!.unmount());
    root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => root!.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(FoundationProvider, null, createElement(MessagesHome)))));
    await waitFor(() => links().length === 3);
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

test("mounted global Chats filters Universe and type independently, updates hidden worlds, and reopens at All", checkUniverseList);
