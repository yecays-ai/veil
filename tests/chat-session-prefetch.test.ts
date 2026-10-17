import { FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { browserDocumentStorage } from "../lib/core-document-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { ChatStorage } from "../lib/chat/storage";
import { prefetchChatSession, prefetchedChatSession, takePrefetchedChatSession } from "../lib/chat/session-prefetch";
import type { ChatMessage, ChatSession } from "../lib/chat/types";

type Snapshot = { session: ChatSession; messages: ChatMessage[] };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const snapshotOf = (characterId: string): Snapshot => ({
  session: { id: `session-${characterId}`, characterId } as ChatSession,
  messages: [],
});

test("a pressed chat seeds history once and any chat write invalidates the seed", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await storage.send(session.id, "one");
  await storage.send(session.id, "two");

  await prefetchChatSession("peter", storage);
  assert.deepEqual(prefetchedChatSession("peter", storage)?.messages.map((message) => message.content), ["one", "two"]);
  assert.deepEqual(takePrefetchedChatSession("peter", storage)?.snapshot.messages.map((message) => message.content), ["one", "two"]);
  assert.equal(takePrefetchedChatSession("peter", storage), null, "a seed is consumed once");

  await prefetchChatSession("peter", storage);
  await storage.send(session.id, "changed after prefetch");
  assert.equal(prefetchedChatSession("peter", storage), null, "the revision makes an old seed unusable");
});

test("a chat write during prefetch discards the pending snapshot", async () => {
  const pending = deferred<Snapshot | null>();
  let revision = 0, reads = 0;
  const storage = {
    peekExistingSession: () => { reads++; return pending.promise; },
    changeRevision: () => revision,
  };
  const first = prefetchChatSession("peter", storage);
  const duplicate = prefetchChatSession("peter", storage);
  await Promise.resolve();
  assert.equal(reads, 1, "same-character reads are deduplicated");
  revision++;
  pending.resolve(snapshotOf("peter"));
  await Promise.all([first, duplicate]);
  assert.equal(prefetchedChatSession("peter", storage), null, "a changed revision rejects the late read");
});

test("prefetch seeds have a fixed per-storage capacity", async () => {
  let reads = 0;
  const storage = {
    peekExistingSession: async (characterId: string) => { reads++; return snapshotOf(characterId); },
    changeRevision: () => 0,
  };
  for (const id of ["a", "b", "c", "d", "e", "f"]) await prefetchChatSession(id, storage);
  assert.equal(reads, 6);
  assert.equal(prefetchedChatSession("a", storage), null);
  assert.equal(prefetchedChatSession("b", storage), null);
  for (const id of ["c", "d", "e", "f"]) assert.ok(prefetchedChatSession(id, storage));
});

test("peeking a generating chat never recovers or writes its state", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await storage.send(session.id, "existing history");
  let recoveryCalls = 0;
  const recover = storage.recoverGeneration.bind(storage);
  storage.recoverGeneration = async (sessionId) => { recoveryCalls++; return recover(sessionId); };

  await storage.claimGeneration(session.id);
  assert.equal(await storage.peekExistingSession("peter"), null);
  await prefetchChatSession("peter", storage);
  assert.equal(prefetchedChatSession("peter", storage), null);
  assert.equal(recoveryCalls, 0, "the prefetch path does not call the recovery API");
  assert.ok((await storage.listSessions()).find((row) => row.id === session.id)?.generation,
    "the active generation remains untouched");
});

test("Chat uses a seed on its first frame, preserves it while reading, and isolates the next character", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("self", dom.window);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("BroadcastChannel", undefined);
  const indexedDB = new IDBFactory();
  install("indexedDB", indexedDB);
  Object.defineProperty(dom.window, "indexedDB", { configurable: true, value: indexedDB });

  const { createRoot } = await import("react-dom/client");
  const { useChatSession } = await import("../components/chat/use-chat-session");
  const { chatStorage } = await import("../lib/chat/storage");
  const { chatEngine } = await import("../lib/chat/engine");
  const root: Root = createRoot(dom.window.document.getElementById("root")!);
  const observed: Array<{ characterId: string; messages: string }> = [];
  function Probe({ characterId, enabled = true }: { characterId: string; enabled?: boolean }) {
    const chat = useChatSession(characterId, enabled);
    observed.push({ characterId, messages: chat.messages.map((message) => message.content).join("|") });
    return createElement("div", { id: "probe", "data-character": chat.session?.characterId ?? "",
      "data-count": String(chat.messages.length),
      "data-messages": chat.messages.map((message) => message.content).join("|") });
  }
  const read = () => {
    const probe = dom.window.document.getElementById("probe");
    return { character: probe?.getAttribute("data-character") ?? "", count: probe?.getAttribute("data-count") ?? "",
      messages: probe?.getAttribute("data-messages") ?? "" };
  };
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!done()) {
      assert.ok(Date.now() < deadline, `condition timed out: ${JSON.stringify(read())}, routeReadStarted=${routeReadStarted}`);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  };
  await browserDocumentStorage.putIfAbsent(FOUNDATION_STORAGE_KEY, JSON.stringify(normalizeFoundation({ characters: ["pressed", "switched", "plain"].map((characterId) => ({ characterId, name: characterId })) })));
  const pressed = await chatStorage.openSession("pressed");
  await chatStorage.send(pressed.id, "first");
  await chatStorage.send(pressed.id, "second");
  const switched = await chatStorage.openSession("switched");
  await chatStorage.send(switched.id, "switched history");
  const plain = await chatStorage.openSession("plain");
  await chatStorage.send(plain.id, "plain history");
  await prefetchChatSession("pressed", chatStorage);
  await prefetchChatSession("switched", chatStorage);
  const switchedSnapshot = await chatStorage.peekExistingSession("switched");
  assert.ok(switchedSnapshot);

  const pendingRead = deferred<Snapshot | null>();
  const originalRead = chatStorage.readExistingSession;
  const originalStop = chatEngine.stop;
  const stopped: string[] = [];
  let routeReadStarted = false;
  chatStorage.readExistingSession = () => { routeReadStarted = true; return pendingRead.promise; };
  chatEngine.stop = (async (sessionId: string) => { stopped.push(sessionId); }) as typeof chatEngine.stop;
  try {
    await act(() => { root.render(createElement(Probe, { characterId: "pressed", enabled: false })); });
    await until(() => routeReadStarted);
    await act(() => { root.render(createElement(Probe, { characterId: "pressed", enabled: true })); });
    assert.equal(read().count, "2", "enabling the route does not clear its seed");
    await until(() => read().count === "2");
    assert.deepEqual(read(), { character: "pressed", count: "2", messages: "first|second" },
      "seeded messages remain published while the route's own storage read is pending");

    const beforeSwitch = observed.length;
    await act(() => { root.render(createElement(Probe, { characterId: "switched" })); });
    assert.equal(observed.slice(beforeSwitch).find((entry) => entry.characterId === "switched")?.messages,
      "switched history", "a same-component character switch renders only that character's seed immediately");
    assert.deepEqual(stopped, [], "leaving while the read is pending does not stop a reply the engine owns");
    pendingRead.resolve(switchedSnapshot);
    chatStorage.readExistingSession = originalRead;
    await until(() => read().messages === "switched history");

    const beforeUnseeded = observed.length;
    await act(() => { root.render(createElement(Probe, { characterId: "plain" })); });
    assert.equal(observed.slice(beforeUnseeded).find((entry) => entry.characterId === "plain")?.messages, "",
      "an unseeded character starts without the previous character's messages");
    assert.deepEqual(read(), { character: "", count: "0", messages: "" },
      "without a seed, the existing route-loading path starts empty and never shows the previous character");
    await until(() => read().count === "1");
    assert.deepEqual(read(), { character: "plain", count: "1", messages: "plain history" });
  } finally {
    pendingRead.resolve(null);
    chatStorage.readExistingSession = originalRead;
    chatEngine.stop = originalStop;
    await act(() => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
