import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import type { ChatSession } from "../lib/chat/types";
import { chatStorage } from "../lib/chat/storage";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";

// Part 5 F10: route states must not imply loading, absence or failure that is not true.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function waitFor(check: () => boolean, message: string) {
  const { act } = await import("react");
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}
const privateSession = (id: string): ChatSession => ({
  id, characterId: "a", updatedAt: 10, lastMessagePreview: "hi", autoReplyOnKeyboardDismiss: false, nextOrder: 1,
});
const groupSession = (): ChatSession => ({
  id: "g1", type: "group", title: "Weekend", participantIds: ["a"], updatedAt: 10, lastMessagePreview: "",
  autoReplyOnKeyboardDismiss: false, nextOrder: 1,
} as unknown as ChatSession);

type Stubs = {
  foundation?: () => Promise<ReturnType<typeof normalizeFoundation>>;
  listSessions?: () => Promise<ChatSession[]>;
  readSession?: (id: string) => Promise<{ session: ChatSession; messages: [] }>;
};
async function mount(stubs: Stubs, load: () => Promise<React.ComponentType>) {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/", pretendToBeVisual: true });
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
  const previous = { load: browserFoundationStorage.load, list: chatStorage.listSessions,
    read: chatStorage.readSession, subscribe: chatStorage.subscribe };
  browserFoundationStorage.load = stubs.foundation ?? (async () => normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] }));
  if (stubs.listSessions) chatStorage.listSessions = stubs.listSessions;
  if (stubs.readSession) chatStorage.readSession = stubs.readSession as typeof chatStorage.readSession;
  chatStorage.subscribe = () => () => {};
  // React reads the DOM at import time, so it must load after the jsdom globals exist.
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const [{ FoundationProvider }, Component, { AppRouterContext }] = await Promise.all([
    import("../components/foundation-provider"), load(), import("next/dist/shared/lib/app-router-context.shared-runtime"),
  ]);
  const router = { prefetch() {}, push() {}, replace() {}, back() {}, forward() {}, refresh() {} };
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(FoundationProvider, null, createElement(Component)))));
  return {
    act,
    text: () => dom.window.document.body.textContent ?? "",
    $: (selector: string) => dom.window.document.querySelector(selector),
    cleanup: async () => {
      await act(async () => root.unmount());
      browserFoundationStorage.load = previous.load; chatStorage.listSessions = previous.list;
      chatStorage.readSession = previous.read; chatStorage.subscribe = previous.subscribe;
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}
const messagesHome = async () => (await import("../components/chat/messages-home")).MessagesHome;
const groupRoom = (sessionId: string) => async () => {
  const { createElement } = await import("react");
  const { GroupRoom } = await import("../components/chat/group-room");
  return function Group() { return createElement(GroupRoom, { sessionId }); };
};
const bindingEditor = (characterId: string) => async () => {
  const { createElement } = await import("react");
  const { BindingEditor } = await import("../components/settings/bindings/binding-manager");
  return function Editor() { return createElement(BindingEditor, { characterId }); };
};

test("① a failed first conversation read shows the error and stops saying it is loading", async () => {
  const h = await mount({ listSessions: () => Promise.reject(new Error("boom")) }, messagesHome);
  try {
    await waitFor(() => /Could not load conversations/.test(h.text()), "the error is shown");
    assert.doesNotMatch(h.text(), /Loading conversations/);
  } finally { await h.cleanup(); }
});

test("② (kept) an empty list is a finished state: no Loading and no error (no empty-state text by design, bce4305)", async () => {
  const h = await mount({ listSessions: async () => [] }, messagesHome);
  try {
    await waitFor(() => !/Loading conversations/.test(h.text()), "the read finished");
    assert.doesNotMatch(h.text(), /Could not load conversations/);
    assert.equal(h.$(".conversation-row"), null);
  } finally { await h.cleanup(); }
});

test("③ a non-group session on the group route shows an invalid target, not Loading", async () => {
  const h = await mount({ readSession: async (id) => ({ session: privateSession(id), messages: [] }) }, groupRoom("s1"));
  try {
    await waitFor(() => !/Loading group/.test(h.text()), "Loading group… must end");
    assert.match(h.text(), /not a group/i);
  } finally { await h.cleanup(); }
});

test("a real group conversation still renders its members", async () => {
  const h = await mount({ readSession: async () => ({ session: groupSession(), messages: [] }) }, groupRoom("g1"));
  try {
    await waitFor(() => /Members/.test(h.text()), "the group renders");
    assert.match(h.text(), /Weekend/);
    assert.doesNotMatch(h.text(), /not a group|Loading group/i);
  } finally { await h.cleanup(); }
});

test("④ the Binding editor does not say not found while Foundation is still loading", async () => {
  const gate = deferred<ReturnType<typeof normalizeFoundation>>();
  const h = await mount({ foundation: () => gate.promise }, bindingEditor("a"));
  try {
    assert.doesNotMatch(h.text(), /Binding target not found/, "Foundation pending: the Character cannot be judged yet");
    await h.act(async () => { gate.resolve(normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] })); });
    await waitFor(() => /Character Defaults/.test(h.text()), "the legitimate Character target opens");
    assert.doesNotMatch(h.text(), /Binding target not found/);
  } finally { await h.cleanup(); }
});

test("⑤ the Binding editor says not found once Foundation is ready and the target is missing", async () => {
  const h = await mount({}, bindingEditor("ghost"));
  try {
    await waitFor(() => /Binding target not found/.test(h.text()), "a missing Character is reported");
  } finally { await h.cleanup(); }
});
