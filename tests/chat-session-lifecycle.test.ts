import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBIndex, IDBObjectStore } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage, type ChatStorageChange } from "../lib/chat/storage";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import { regressionContract } from "./regression-contract";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Snapshot = NonNullable<Awaited<ReturnType<ChatStorage["readExistingSession"]>>>;
function counted(storage: ChatStorage) {
  const counts = { existing: 0, opens: 0, reads: 0, subscriptions: 0, active: 0, maxActive: 0 };
  const callbacks = new Set<(change: ChatStorageChange) => void>();
  const adapter = {
    readExistingSession: (characterId: string) => { counts.existing++; return storage.readExistingSession(characterId); },
    openSession: (characterId: string) => { counts.opens++; return storage.openSession(characterId); },
    readSession: (id: string) => { counts.reads++; return storage.readSession(id); },
    subscribe: (callback: (change: ChatStorageChange) => void) => {
      counts.subscriptions++; counts.active++;
      counts.maxActive = Math.max(counts.maxActive, counts.active);
      callbacks.add(callback);
      const unsubscribe = storage.subscribe(callback);
      return () => { counts.active--; callbacks.delete(callback); unsubscribe(); };
    },
  };
  const emit = (change: ChatStorageChange) => callbacks.forEach((callback) => callback(change));
  return { adapter, counts, emit };
}

regressionContract("chat.existing-hydration-overlaps-foundation", "render-lifecycle",
  "existing session/messages hydrate before character validation but publish only after it", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await storage.send(session.id, "persisted history");
  const { adapter, counts } = counted(storage);
  const loaded = deferred<Snapshot | null>();
  const original = adapter.readExistingSession;
  adapter.readExistingSession = async (id) => { const data = await original(id); loaded.resolve(data); return data; };
  const visible: Snapshot[] = [];
  const owner = createChatSessionLifecycle("peter", adapter, (data) => { if (data) visible.push(data); }, () => {});
  owner.mount(false);
  const data = await loaded.promise;
  await settle();
  assert.equal(data?.session.id, session.id);
  assert.deepEqual(data?.messages.map((row) => row.content), ["persisted history"]);
  assert.deepEqual(visible, [], "unvalidated data must not reach ChatRoom or its ancillary consumers");
  owner.setEnabled(true);
  assert.equal(visible.length, 1, "Foundation completion reuses the already hydrated critical data immediately");
  owner.setEnabled(true);
  assert.deepEqual([counts.existing, counts.opens, counts.reads, counts.subscriptions], [1, 0, 0, 1]);
  owner.unmount();
});

regressionContract("chat.creation-requires-character", "render-lifecycle",
  "an unresolved or invalid character cannot create a conversation; validation creates once", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const { adapter, counts } = counted(storage);
  const missing = deferred<Snapshot | null>();
  const original = adapter.readExistingSession;
  adapter.readExistingSession = async (id) => { const data = await original(id); missing.resolve(data); return data; };
  const published = deferred<Snapshot>();
  const owner = createChatSessionLifecycle("new-character", adapter, (data) => { if (data) published.resolve(data); }, () => {});
  owner.mount(false);
  assert.equal(await missing.promise, null);
  await settle();
  assert.deepEqual(await storage.listSessions(), []);
  assert.equal(counts.opens, 0);
  owner.setEnabled(true);
  owner.setEnabled(true);
  const data = await published.promise;
  await settle();
  assert.equal(data.session.characterId, "new-character");
  assert.deepEqual([counts.existing, counts.opens, counts.reads, counts.subscriptions], [1, 1, 1, 1]);
  assert.equal((await storage.listSessions()).length, 1);
  owner.unmount();
});

regressionContract("chat.route-hydration-budget", "storage-read-budget",
  "remounts perform one authoritative hydration without recreating the session or duplicating readiness work", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const { adapter, counts } = counted(storage);
  for (let route = 0; route < 5; route++) {
    const ready = deferred<Snapshot>();
    const owner = createChatSessionLifecycle("peter", adapter, (data) => { if (data) ready.resolve(data); }, () => {});
    owner.mount(false);
    owner.setEnabled(true);
    owner.mount(true);
    assert.equal((await ready.promise).session.id, session.id);
    await settle();
    owner.setEnabled(true);
    owner.unmount();
    assert.equal(counts.active, 0);
  }
  assert.deepEqual([counts.existing, counts.opens, counts.reads, counts.subscriptions, counts.maxActive], [0, 5, 5, 5, 1]);
  assert.equal((await storage.listSessions()).length, 1);
});

regressionContract("chat.scoped-subscription-cleanup", "subscription-hygiene",
  "unrelated changes do not reload critical chat data and unmount releases its one subscription", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const { adapter, counts, emit } = counted(storage);
  const ready = deferred<Snapshot>();
  let publications = 0;
  const stopped: string[] = [];
  const owner = createChatSessionLifecycle("peter", adapter, (data) => {
    publications++; if (data) ready.resolve(data);
  }, (id) => stopped.push(id));
  owner.mount(true);
  await ready.promise;
  await settle();
  emit({ domain: "messages", sessionId: "other" });
  emit({ domain: "global-profile" });
  emit({ domain: "asset" });
  emit({ domain: "worldbook-state", sessionId: session.id });
  await settle();
  assert.equal(counts.reads, 1);
  const refreshed = deferred<Snapshot>();
  const original = adapter.readSession;
  adapter.readSession = async (id) => { const data = await original(id); refreshed.resolve(data); return data; };
  await storage.send(session.id, "scoped update");
  await refreshed.promise;
  await settle();
  assert.equal(counts.reads, 2);
  const beforeUnmount = publications;
  owner.unmount();
  emit({ domain: "messages", sessionId: session.id });
  await settle();
  assert.equal(counts.reads, 2);
  assert.equal(publications, beforeUnmount);
  assert.equal(counts.active, 0);
  assert.deepEqual(stopped, [], "leaving the page does not stop a reply the engine owns");
});

regressionContract("chat.obsolete-hydration-suppressed", "async-race-safety",
  "changes during hydration invalidate the snapshot; late success/errors cannot publish after navigation", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const data = await storage.readSession(session.id);
  const { adapter, emit, counts } = counted(storage);
  const initial = deferred<Snapshot | null>();
  adapter.readExistingSession = () => initial.promise;
  const ready = deferred<Snapshot>();
  const owner = createChatSessionLifecycle("peter", adapter, (next) => { if (next) ready.resolve(next); }, () => {});
  owner.mount(false);
  await settle();
  owner.setEnabled(true);
  await storage.send(session.id, "written during hydration");
  emit({ domain: "messages", sessionId: session.id });
  initial.resolve(data);
  const latest = await ready.promise;
  assert.deepEqual(latest.messages.map((row) => row.content), ["written during hydration"]);
  assert.equal(counts.reads, 1, "changes before session resolution coalesce to one scoped follow-up read");
  owner.unmount();
  for (const failure of [false, true]) {
    const late = deferred<Snapshot | null>();
    adapter.readExistingSession = () => late.promise;
    let published = 0;
    const cancelled = createChatSessionLifecycle("peter", adapter, (data, error) => { if (data || error) published++; }, () => {});
    cancelled.mount(false);
    await settle();
    cancelled.setEnabled(true);
    cancelled.unmount();
    if (failure) late.reject(new Error("late error")); else late.resolve(data);
    await settle();
    assert.equal(published, 0);
    assert.equal(counts.active, 0);
  }
});

test("readExistingSession preserves selection/settings and never creates a missing private session", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  await storage.createGroupSession(["peter", "lan"], "Group");
  assert.equal(await storage.readExistingSession("peter"), null);
  assert.equal((await storage.listSessions()).length, 1);
  const direct = await storage.openSession("peter");
  await storage.updateSessionSettings(direct.id, { pinned: true, streamOnline: true, customCSS: ".test {}" });
  await storage.send(direct.id, "one");
  const existing = await storage.readExistingSession("peter");
  assert.equal(existing?.session.id, (await storage.openSession("peter")).id);
  assert.equal(existing?.session.pinned, true);
  assert.equal(existing?.session.streamOnline, true);
  assert.equal(existing?.session.customCSS, ".test {}");
  assert.deepEqual(existing?.messages.map((row) => row.content), ["one"]);
});

test("read-only early hydration reuses legacy session IDs and their stored history/settings", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const template = await storage.openSession("peter");
  await storage.deleteSession(template.id);
  const legacy = { ...template, id: "character:peter", pinned: true, customCSS: ".legacy {}" };
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(CHAT_DATABASE_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put(legacy);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  await storage.send(legacy.id, "legacy history");
  const hydrated = await storage.readExistingSession("peter");
  assert.equal(hydrated?.session.id, legacy.id);
  assert.equal(hydrated?.session.customCSS, legacy.customCSS);
  assert.equal(hydrated?.session.pinned, true);
  assert.deepEqual(hydrated?.messages.map((message) => message.content), ["legacy history"]);
  assert.equal((await storage.openSession("peter")).id, legacy.id);
  assert.equal((await storage.listSessions()).length, 1);
});

regressionContract("chat.obsolete-refresh-error-suppressed", "async-race-safety",
  "a change during a pending refresh discards stale success and failure and reads the current messages once", async () => {
  for (const failure of [false, true]) {
    const storage = new ChatStorage(() => new IDBFactory());
    const session = await storage.openSession("peter");
    const before = await storage.readSession(session.id);
    const { adapter, counts, emit } = counted(storage);
    const initial = deferred<Snapshot>(), latest = deferred<Snapshot>();
    const errors: string[] = [];
    const owner = createChatSessionLifecycle("peter", adapter, (data, error) => {
      errors.push(error);
      if (data) { initial.resolve(data); if (data.messages.length) latest.resolve(data); }
    }, () => {});
    owner.mount(false);
    owner.setEnabled(true);
    await initial.promise;
    await settle();
    const oldRefresh = deferred<Snapshot>();
    const original = adapter.readSession;
    let first = true;
    adapter.readSession = (id) => {
      if (first) { first = false; return oldRefresh.promise; }
      return original(id);
    };
    emit({ domain: "messages", sessionId: session.id });
    await settle();
    await storage.send(session.id, "latest message");
    if (failure) oldRefresh.reject(new Error("obsolete failure")); else oldRefresh.resolve(before);
    assert.deepEqual((await latest.promise).messages.map((message) => message.content), ["latest message"]);
    assert.ok(errors.every((error) => error === ""));
    assert.equal(counts.reads, 2, "one initial read and one authoritative follow-up after the controlled obsolete request");
    assert.equal(counts.subscriptions, 1);
    owner.unmount();
  }
});

test("failed initial hydration cannot create a session and a fresh mount can retry", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const { adapter, counts } = counted(storage);
  const original = adapter.openSession;
  adapter.openSession = async () => { throw new Error("open failure"); };
  const failed = deferred<string>();
  const owner = createChatSessionLifecycle("peter", adapter, (_, error) => { if (error) failed.resolve(error); }, () => {});
  owner.mount(true);
  assert.match(await failed.promise, /Existing messages have not been changed/);
  assert.equal(counts.opens, 0);
  assert.deepEqual(await storage.listSessions(), []);
  owner.unmount();
  adapter.openSession = original;
  const ready = deferred<Snapshot>();
  const retry = createChatSessionLifecycle("peter", adapter, (data) => { if (data) ready.resolve(data); }, () => {});
  retry.mount(true);
  assert.equal((await ready.promise).session.characterId, "peter");
  assert.deepEqual([counts.opens, counts.reads, counts.maxActive], [1, 1, 1]);
  retry.unmount();
});

regressionContract("chat.validation-recovers-pending-lookup-failure", "async-race-safety",
  "validation during a pending speculative lookup recovers automatically after rejection, once and while still active", async () => {
  for (const outcome of ["success", "failure", "unmount", "disabled", "validated-open-failure"] as const) {
    const storage = new ChatStorage(() => new IDBFactory());
    const session = await storage.openSession("peter");
    await storage.send(session.id, "existing history");
    const { adapter, counts } = counted(storage);
    const lookup = deferred<Snapshot | null>();
    adapter.readExistingSession = () => { counts.existing++; return lookup.promise; };
    if (outcome === "failure" || outcome === "validated-open-failure")
      adapter.openSession = async () => { counts.opens++; throw new Error("still unavailable"); };
    const visible: Array<{ data: Snapshot | null; error: string }> = [];
    const recovered = deferred<void>();
    const owner = createChatSessionLifecycle("peter", adapter, (data, error) => {
      visible.push({ data, error });
      if (counts.opens === 1 && (data || error)) recovered.resolve();
    }, () => {});
    owner.mount(false);
    await settle();
    assert.deepEqual([counts.existing, counts.opens, counts.reads], [1, 0, 0]);
    owner.setEnabled(true);
    owner.setEnabled(true);
    if (outcome === "unmount") owner.unmount();
    if (outcome === "disabled") owner.setEnabled(false);
    if (outcome === "validated-open-failure") lookup.resolve(null);
    else lookup.reject(new Error("speculative read failed"));
    if (outcome === "success" || outcome === "failure" || outcome === "validated-open-failure") await recovered.promise;
    await settle();
    if (outcome === "success") {
      const latest = visible.at(-1);
      assert.equal(latest?.data?.session.id, session.id);
      assert.deepEqual(latest?.data?.messages.map((message) => message.content), ["existing history"]);
      assert.equal(latest?.error, "");
      assert.deepEqual([counts.existing, counts.opens, counts.reads], [1, 1, 1]);
    } else if (outcome === "failure" || outcome === "validated-open-failure") {
      assert.match(visible.at(-1)?.error ?? "", /Chat storage is unavailable/);
      assert.deepEqual([counts.existing, counts.opens, counts.reads], [1, 1, 0], "recovery failure must not cause an automatic retry loop");
    } else {
      assert.equal(counts.opens, 0, "obsolete validation must not authorize recovery");
      assert.ok(visible.every(({ data, error }) => data === null && error === ""));
    }
    if (outcome !== "unmount") owner.unmount();
    assert.equal(counts.active, 0);
    assert.equal(counts.subscriptions, 1);
  }
});

test("an already validated new character uses the original creation path without an extra read-only lookup", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const { adapter, counts } = counted(storage);
  const ready = deferred<Snapshot>();
  const owner = createChatSessionLifecycle("new", adapter, (data) => { if (data) ready.resolve(data); }, () => {});
  owner.mount(false);
  owner.setEnabled(true);
  assert.equal((await ready.promise).session.characterId, "new");
  assert.deepEqual([counts.existing, counts.opens, counts.reads, counts.subscriptions], [0, 1, 1, 1]);
  owner.unmount();
});

test("losing character validation stops the owner and revalidation resolves durable session identity again", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const { adapter, counts } = counted(storage);
  const initial = deferred<Snapshot>(), reopened = deferred<Snapshot>();
  const stopped: string[] = [];
  const owner = createChatSessionLifecycle("peter", adapter, (data) => {
    if (data) { initial.resolve(data); if (data.session.id !== session.id) reopened.resolve(data); }
  }, (id) => stopped.push(id));
  owner.mount(true);
  await initial.promise;
  await settle();
  owner.setEnabled(false);
  assert.deepEqual(stopped, [session.id]);
  await storage.deleteSession(session.id);
  owner.setEnabled(true);
  assert.notEqual((await reopened.promise).session.id, session.id);
  assert.deepEqual([counts.existing, counts.opens, counts.reads, counts.subscriptions], [0, 2, 2, 1]);
  owner.unmount();
});

regressionContract("chat.known-session-requests-overlap", "storage-read-budget",
  "known-ID session and message requests issue in one transaction before either request completes", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const get = IDBObjectStore.prototype.get, getAll = IDBIndex.prototype.getAll;
  const order: string[] = [];
  IDBObjectStore.prototype.get = function (key) {
    const req = get.call(this, key);
    if (this.name === "sessions") {
      order.push("session-request");
      req.addEventListener("success", () => order.push("session-success"));
    }
    return req;
  };
  IDBIndex.prototype.getAll = function (query, count) {
    if (this.objectStore.name === "messages") order.push("messages-request");
    return getAll.call(this, query, count);
  };
  try {
    await storage.readSession(session.id);
    assert.deepEqual(order, ["session-request", "messages-request", "session-success"]);
    await assert.rejects(storage.readSession("missing"), /Conversation not found/);
  } finally { IDBObjectStore.prototype.get = get; IDBIndex.prototype.getAll = getAll; }
});
