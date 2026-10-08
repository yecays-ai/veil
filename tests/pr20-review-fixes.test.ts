import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import { lockOrigin } from "./generation-lock-fixture";

async function setup() {
  const factory = new IDBFactory(), origin = lockOrigin();
  const storage = new ChatStorage(() => factory, () => origin.client());
  const peer = new ChatStorage(() => factory, () => origin.client());
  const session = await storage.openSession("a");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { factory, origin, storage, peer, session, document };
}

test("prerequisite failure happens before any claim: no attempt, pending messages untouched, no failed assistant", async () => {
  const { storage, session, document } = await setup();
  await storage.send(session.id, "Pending question");
  let provided = 0;
  const missing = { ...document, characters: [] };
  const engine = createChatEngine(storage, async () => missing, async function* () { provided++; yield "x"; });
  await assert.rejects(engine.requestReply(session.id), /no longer available/);
  const { session: after, messages } = await storage.readSession(session.id);
  assert.equal(provided, 0);
  assert.equal(after.generation, undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].requestedBy, undefined, "pending user message was not claimed");
  assert.equal(engine.isGenerating(session.id), false);
  // A later healthy reply still works and consumes the same pending message.
  const healthy = createChatEngine(storage, async () => document, async function* () { yield "Fine"; });
  assert.equal((await healthy.requestReply(session.id))?.status, "complete");
});

test("lifecycle stop never persists a Stop; only the explicit persist opt-in does", async () => {
  const { storage, peer, session, document } = await setup();
  await storage.send(session.id, "Question");
  const owner = await peer.claimGeneration(session.id);
  assert.ok(await peer.beginReply(session.id, undefined, owner));
  const engine = createChatEngine(storage, async () => document, async function* () { yield "unused"; });
  engine.stop(session.id); // no local attempt: lifecycle-style cleanup
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await peer.generationIsCurrent(session.id, owner), true, "cleanup must not stop another owner");
  engine.stop(session.id, { persist: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await peer.generationIsCurrent(session.id, owner), false, "explicit Stop persists");
  await peer.releaseGeneration(session.id, owner);
});

test("session lifecycle cleanup calls stop without persistence and the Stop button opts in", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(room, /chatEngine\.stop\(session\.id, \{ persist: true \}\)/);
  const hook = readFileSync("components/chat/use-chat-session.ts", "utf8");
  assert.match(hook, /\(id\) => chatEngine\.stop\(id\)\)/);
  assert.doesNotMatch(hook, /persist/);
  const stops: unknown[][] = [];
  const route = createChatSessionLifecycle("a", {
    readExistingSession: async () => null, openSession: async () => { throw new Error("n/a"); },
    readSession: async () => { throw new Error("n/a"); }, subscribe: () => () => {},
  }, () => {}, (...args) => { stops.push(args); });
  route.mount(false); route.unmount();
  assert.deepEqual(stops, []);
});

async function seedOrphan(factory: IDBFactory, storage: ChatStorage, sessionId: string) {
  const database = await new Promise<IDBDatabase>((resolve) => {
    const opened = factory.open(CHAT_DATABASE_NAME); opened.onsuccess = () => resolve(opened.result);
  });
  const { session } = await storage.readSession(sessionId);
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(["sessions", "messages"], "readwrite");
    tx.objectStore("messages").put({ id: "orphan", sessionId, role: "assistant", content: "Half",
      status: "streaming", createdAt: 2, order: 1 });
    tx.objectStore("sessions").put({ ...session, nextOrder: 2, lastMessageId: "orphan" });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  database.close();
}

test("recoverGeneration fails soft when the lock cannot be acquired and still recovers when it can", async () => {
  const { factory, storage, session, origin } = await setup();
  await seedOrphan(factory, storage, session.id);
  const broken = new ChatStorage(() => factory, () => ({ request: async () => { throw new Error("locks unavailable"); } }) as unknown as LockManager);
  assert.equal(await broken.recoverGeneration(session.id), false);
  await assert.doesNotReject(broken.readSession(session.id));
  assert.equal((await broken.readSession(session.id)).messages[0].status, "streaming", "no state mutated");
  // Another live owner holds the lock: recovery declines and mutates nothing.
  let releaseOther!: () => void;
  const holding = new Promise<void>((resolve) => { releaseOther = resolve; });
  void origin.client().request(`veil-chat-v2:generation:${session.id}`, { mode: "exclusive", ifAvailable: true },
    async () => { await holding; });
  const other = new ChatStorage(() => factory, () => origin.client());
  assert.equal(await other.recoverGeneration(session.id), false);
  assert.equal((await other.readSession(session.id)).messages[0].status, "streaming");
  releaseOther(); await new Promise((resolve) => setTimeout(resolve, 0));
  const live = new ChatStorage(() => factory, () => origin.client());
  assert.equal(await live.recoverGeneration(session.id), true);
  assert.equal((await live.readSession(session.id)).messages[0].outcome, "interrupted");
});

// Mounted ChatRoom whose session generation is held by another tab (a distinct ChatStorage client
// sharing the same IndexedDB and Web Locks origin).
async function withPeerOwnedGeneration(run: (ctx: {
  peer: ChatStorage; owner: string; sessionId: string; unmount: () => Promise<void>;
  wait: (condition: () => boolean | Promise<boolean>) => Promise<void>;
  button: (label: string) => HTMLButtonElement | undefined; click: (element: HTMLElement) => Promise<void>;
  read: () => Promise<{ session: { generation?: unknown }; messages: { status?: string; outcome?: string }[] }>;
}) => Promise<void>) {
  const [{ JSDOM }, { act, createElement }, { TEST_API_CONFIG }] = await Promise.all([
    import("jsdom"), import("react"), import("./chat-engine-fixture")]);
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
    url: "http://localhost/messages/a", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
    install(name, dom.window[name]);
  const factory = new IDBFactory(), origin = lockOrigin();
  Object.defineProperty(dom.window.navigator, "locks", { value: origin.client() });
  Object.defineProperty(dom.window, "indexedDB", { value: factory });
  install("indexedDB", factory); install("self", dom.window); install("BroadcastChannel", undefined);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const { createRoot } = await import("react-dom/client");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { ChatRoom } = await import("../components/chat/chat-room");
  const { chatStorage } = await import("../lib/chat/storage");
  const { browserFoundationStorage } = await import("../lib/foundation-storage");
  const { browserApiConfigStorage } = await import("../lib/api-config-storage");
  const { normalizeFoundation } = await import("../lib/foundation-types");
  const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
  document.runtime.timeAware = false;
  const load = browserFoundationStorage.load, api = browserApiConfigStorage.getApiConfig;
  // The app singleton caches its database connection; each run uses a fresh in-memory origin.
  const resetSingleton = () => { Object.assign(chatStorage as unknown as Record<string, unknown>, { database: undefined, lockFactory: undefined }); };
  resetSingleton();
  const root = createRoot(dom.window.document.getElementById("root")!);
  let mounted = false;
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => { root.unmount(); }); } };
  const wait = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 5000;
    while (true) {
      assert.ok(Date.now() < deadline, "mounted UI condition timed out");
      let ready = false;
      await act(async () => { ready = await condition(); if (!ready) await new Promise((resolve) => setTimeout(resolve, 10)); });
      if (ready) return;
    }
  };
  const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.getAttribute("aria-label") === label);
  let owner: string | undefined, peer: ChatStorage | undefined, sessionId = "";
  try {
    browserFoundationStorage.load = async () => document;
    browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
    const session = await chatStorage.openSession("a");
    sessionId = session.id;
    await chatStorage.send(session.id, "Question");
    peer = new ChatStorage(() => factory, () => origin.client());
    owner = await peer.claimGeneration(session.id);
    assert.ok(await peer.beginReply(session.id, undefined, owner));
    await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "a" }))); });
    mounted = true;
    await wait(() => !!button("Stop reply"));
    await run({ peer, owner, sessionId, unmount, wait, button,
      click: async (element) => { await act(async () => { element.click(); }); },
      read: () => chatStorage.readSession(session.id) as never });
  } finally {
    await unmount();
    if (peer && owner) await peer.releaseGeneration(sessionId, owner).catch(() => {});
    browserFoundationStorage.load = load; browserApiConfigStorage.getApiConfig = api;
    resetSingleton();
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("mounted ChatRoom: the real Stop control persists a Stop for a generation held by another tab", async () => {
  await withPeerOwnedGeneration(async ({ peer, owner, sessionId, wait, button, click }) => {
    assert.equal(await peer.generationIsCurrent(sessionId, owner), true);
    await click(button("Stop reply")!);
    await wait(async () => !(await peer.generationIsCurrent(sessionId, owner)));
    const { messages } = await peer.readSession(sessionId);
    assert.equal(messages.at(-1)?.outcome, "stopped");
  });
});

test("mounted ChatRoom: unmounting while another tab owns the generation does not stop it", async () => {
  await withPeerOwnedGeneration(async ({ peer, owner, sessionId, unmount }) => {
    await unmount(); // lifecycle cleanup runs engine.stop without the persist opt-in
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await peer.generationIsCurrent(sessionId, owner), true, "peer-owned generation is still live");
    const { messages } = await peer.readSession(sessionId);
    assert.equal(messages.at(-1)?.status, "streaming");
    assert.notEqual(messages.at(-1)?.outcome, "stopped");
  });
});
