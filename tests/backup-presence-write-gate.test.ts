import assert from "node:assert/strict";
import test from "node:test";
import { BackupCoordinator } from "../lib/backup/coordination";
import { createPersistenceWriteGate, withPersistenceWriteScope, type PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { advanceLastSeen, createPresenceStorage, PRESENCE_STORAGE_KEY, type PresenceStorage } from "../lib/presence/storage";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function memory() {
  const values = new Map<string, string>(); let writes = 0;
  return { values, get writes() { return writes; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { writes++; values.set(key, value); },
    removeItem(key: string) { writes++; values.delete(key); } };
}
const NOW = 1_800_000_000_000;
const touch = (store: PresenceStorage) => store.transact((document) => advanceLastSeen(document, "a", { lastMessageAt: NOW }, NOW));

test("a Presence write waits for the backup lease before it modifies storage and releases after it", async () => {
  const entered = deferred(), permit = deferred(), raw = memory(); let released = false;
  const gate: PersistenceWriteGate = { async withWrite<T>(operation: () => Promise<T>) {
    entered.resolve(); await permit.promise;
    try { return await operation(); } finally { assert.equal(raw.writes, 1); released = true; }
  } };
  const pending = touch(createPresenceStorage(() => raw, () => undefined, gate)); await entered.promise;
  assert.equal(raw.writes, 0); assert.equal(raw.values.size, 0); assert.equal(released, false);
  permit.resolve(); await pending;
  assert.equal(released, true); assert.equal(raw.writes, 1);
});

test("denied coordination leaves Presence storage unchanged", async () => {
  const denied = new Error("Simulated coordination denied"), raw = memory();
  await assert.rejects(touch(createPresenceStorage(() => raw, () => undefined, { withWrite: () => Promise.reject(denied) })),
    (error) => error === denied);
  assert.equal(raw.writes, 0); assert.equal(raw.values.size, 0);
});

test("an exclusive snapshot blocks a Presence write from another lock client until it finishes", async () => {
  const origin = lockOrigin(), gate = createPersistenceWriteGate(() => origin.client());
  const raw = memory(), ready = deferred(), finish = deferred();
  const capture = new BackupCoordinator(origin.client()).withSnapshot(async () => { ready.resolve(); await finish.promise; });
  await ready.promise;
  const writing = touch(createPresenceStorage(() => raw, () => origin.client(), gate));
  await new Promise((resolve) => setImmediate(resolve)); // long enough for an ungated write to have landed
  assert.equal(raw.writes, 0); assert.equal(raw.values.has(PRESENCE_STORAGE_KEY), false);
  finish.resolve(); await capture; await writing;
  assert.equal(raw.writes, 1);
});

test("a rejected Presence commit releases its shared lease and keeps the original bytes", async () => {
  const origin = lockOrigin(), gate = createPersistenceWriteGate(() => origin.client());
  const raw = memory(), store = createPresenceStorage(() => raw, () => origin.client(), gate);
  await touch(store); const before = new Map(raw.values);
  const original = raw.setItem; raw.setItem = () => { throw new Error("Simulated quota"); };
  await assert.rejects(store.transact((document) => advanceLastSeen(document, "a", { lastMessageAt: NOW + 1000 }, NOW + 1000)), /quota/);
  assert.deepEqual(raw.values, before);
  assert.equal(await new BackupCoordinator(origin.client()).withSnapshot(async () => "released"), "released");
  raw.setItem = original;
});

test("a caller's write scope lets Presence writes join one lease instead of requesting another", async () => {
  const origin = lockOrigin(), requests = { shared: 0 };
  const manager = { request: ((...args: Parameters<LockManager["request"]>) => {
    if ((args[1] as LockOptions).mode === "shared") requests.shared++;
    return origin.client().request(...args);
  }) as LockManager["request"] };
  const gate = createPersistenceWriteGate(() => manager as never);
  const raw = memory(), store = createPresenceStorage(() => raw, () => undefined, gate);
  await withPersistenceWriteScope(gate, async (scope) => {
    await store.transact((document) => advanceLastSeen(document, "a", { lastMessageAt: NOW }, NOW), scope);
    await store.transact((document) => advanceLastSeen(document, "a", { lastOnlineAt: NOW }, NOW), scope);
  });
  assert.equal(requests.shared, 1);
  assert.equal(raw.writes, 2);
});
