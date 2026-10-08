import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { ChatStorage } from "../lib/chat/storage";
import { prefetchChatSession, prefetchedChatSession } from "../lib/chat/session-prefetch";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import type { ChatMessage, ChatSession } from "../lib/chat/types";

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));
const snapshotOf = (characterId: string) => ({ session: { id: `s-${characterId}`, characterId } as ChatSession, messages: [] as ChatMessage[] });

function fakeStorage(peek: (characterId: string) => Promise<ReturnType<typeof snapshotOf> | null>) {
  const state = { revision: 0 };
  return { state, peekExistingSession: peek, changeRevision: () => state.revision };
}

test("a pressed chat seeds its history and the seed ends with the next chat change", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "one"); await storage.send(session.id, "two");
  assert.equal(prefetchedChatSession("a", storage), null, "nothing is seeded before the press");
  prefetchChatSession("a", storage);
  await settled();
  assert.deepEqual(prefetchedChatSession("a", storage)?.messages.map((message) => message.content), ["one", "two"]);
  await storage.send(session.id, "three"); // any chat change makes the seed stale
  assert.equal(prefetchedChatSession("a", storage), null, "a stale seed is never served");
});

test("a change while the read is in flight leaves no seed", async () => {
  const pending = deferred<ReturnType<typeof snapshotOf>>();
  const storage = fakeStorage(() => pending.promise);
  prefetchChatSession("a", storage);
  storage.state.revision++; // a write lands before the read resolves
  pending.resolve(snapshotOf("a"));
  await settled();
  assert.equal(prefetchedChatSession("a", storage), null);
});

test("seeds are bounded, per storage instance, and never read twice at once", async () => {
  let reads = 0;
  const storage = fakeStorage(async (characterId) => { reads++; return snapshotOf(characterId); });
  const other = fakeStorage(async (characterId) => snapshotOf(characterId));
  for (const id of ["a", "b", "c", "d", "e", "f"]) { prefetchChatSession(id, storage); await settled(); }
  assert.equal(prefetchedChatSession("a", storage), null, "the oldest seed was dropped");
  assert.equal(prefetchedChatSession("b", storage), null);
  for (const id of ["c", "d", "e", "f"]) assert.ok(prefetchedChatSession(id, storage), `${id} is kept`);
  assert.equal(prefetchedChatSession("f", other), null, "another storage instance never sees these seeds");
  const before = reads;
  prefetchChatSession("f", storage); prefetchChatSession("f", storage);
  assert.equal(reads, before, "a chat that already has a current seed is not read again");
});

test("peeking is read-only: a generating chat is never seeded and nothing is recovered", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  const recovered: string[] = [];
  const recover = storage.recoverGeneration.bind(storage);
  storage.recoverGeneration = async (sessionId: string) => { recovered.push(sessionId); return recover(sessionId); };
  assert.equal((await storage.peekExistingSession("a"))?.messages.length, 1, "an idle chat can be peeked");
  await storage.claimGeneration(session.id);
  assert.equal(await storage.peekExistingSession("a"), null, "a generating chat is left to its owner");
  prefetchChatSession("a", storage);
  await settled();
  assert.equal(prefetchedChatSession("a", storage), null);
  assert.deepEqual(recovered, [], "peeking never recovers or writes a generation");
});

test("a chat pressed in the list paints its history in the first frame; one that was not still loads normally", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("self", dom.window);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("BroadcastChannel", undefined); // an open channel would keep the test process alive
  const indexedDB = new IDBFactory();
  install("indexedDB", indexedDB);
  Object.defineProperty(dom.window, "indexedDB", { value: indexedDB });
  const { createRoot } = await import("react-dom/client");
  const { useChatSession } = await import("../components/chat/use-chat-session");
  const { chatStorage } = await import("../lib/chat/storage");
  const root = createRoot(dom.window.document.getElementById("root")!);
  function Probe({ characterId }: { characterId: string }) {
    const chat = useChatSession(characterId, true);
    return createElement("div", { id: "probe", "data-session": chat.session?.id ?? "", "data-count": String(chat.messages.length) });
  }
  const read = () => {
    const node = dom.window.document.getElementById("probe");
    return { session: node?.getAttribute("data-session") ?? "", count: node?.getAttribute("data-count") ?? "" };
  };
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!done()) { assert.ok(Date.now() < deadline, "condition timed out"); await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); }
  };
  try {
    for (const characterId of ["pressed", "plain"]) {
      const session = await chatStorage.openSession(characterId);
      await chatStorage.send(session.id, "one"); await chatStorage.send(session.id, "two");
    }
    prefetchChatSession("pressed", chatStorage);
    await until(() => prefetchedChatSession("pressed", chatStorage) !== null);
    // Synchronous act: renders and flushes effects but not pending storage promises, i.e. the first frame.
    await act(() => { root.render(createElement(Probe, { characterId: "pressed" })); });
    assert.equal(read().count, "2", "the pressed chat already has its history in the first frame");
    assert.notEqual(read().session, "");
    // Enabling the route runs in the same act: it must not blank the seeded history before its own read lands.
    assert.equal(read().count, "2", "the lifecycle did not blank the seed");
    await until(() => read().session !== "" && read().count === "2"); // the route's own read keeps it consistent
    assert.equal(read().count, "2");
    await act(() => { root.render(createElement("div", { id: "elsewhere" })); });
    await act(() => { root.render(createElement(Probe, { characterId: "plain" })); });
    assert.equal(read().count, "0", "a chat that was not pressed still starts empty and loads from storage");
    await until(() => read().count === "2");
  } finally {
    await act(() => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("leaving a seeded chat before its own read lands still stops what was started from it", async () => {
  const pending = deferred<ReturnType<typeof snapshotOf> | null>();
  const stopped: string[] = [];
  let reads = 0;
  const storage = {
    readExistingSession: () => { reads++; return pending.promise; }, openSession: async () => snapshotOf("a").session,
    readSession: async () => snapshotOf("a"), subscribe: () => () => {},
  };
  const owner = createChatSessionLifecycle("a", storage, () => {}, (id) => stopped.push(id));
  owner.seed(snapshotOf("a")); // the route paints the seed and the user can already send from it
  owner.mount(false);
  await Promise.resolve(); // mount schedules the route's own read in a promise callback
  assert.equal(reads, 1, "the route read has started and is still pending");
  owner.setEnabled(true);
  owner.unmount(); // the user leaves before the storage read resolves
  assert.deepEqual(stopped, ["s-a"], "a reply started from the seed is stopped on exit, like one from a loaded chat");
  pending.resolve(null);
  await settled();
  const other = createChatSessionLifecycle("a", storage, () => {}, (id) => stopped.push(id));
  other.mount(false); other.setEnabled(true); other.unmount();
  assert.deepEqual(stopped, ["s-a"], "an unseeded owner with nothing loaded has nothing to stop");
});
