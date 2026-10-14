import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage, CHAT_DATABASE_NAME } from "../lib/chat/storage";
import { IndexedDBDocumentStorage, CORE_DATABASE_NAME } from "../lib/core-document-storage";
import { MemoryStorage } from "../lib/memory/storage";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
const gate: PersistenceWriteGate = { withWrite: (work) => work(), withExclusiveWrite: (work) => work() };

test("cold source checks do not create missing Core, Chat or Memory databases", async () => {
  const factory = new IDBFactory(), memory = new MemoryStorage(() => factory, Date.now, gate);
  const core = new IndexedDBDocumentStorage(() => factory, gate), chat = new ChatStorage(() => factory, () => undefined, gate);
  await memory.withExclusive(async (scope) => {
    assert.equal(await core.readExisting("veil.foundation.v1", scope), null);
    assert.deepEqual(await chat.readMemorySources("missing", scope), { messages: [] });
    assert.deepEqual(await chat.listExistingSessions(scope), []);
  });
  assert.deepEqual(await factory.databases(), []);
});

for (const name of [CORE_DATABASE_NAME, CHAT_DATABASE_NAME]) test(`source read never upgrades unknown ${name} schema`, async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve) => { const open = factory.open(name, 2); open.onupgradeneeded = () => open.result.createObjectStore("keep"); open.onsuccess = () => { open.result.close(); resolve(); }; });
  const memory = new MemoryStorage(() => factory, Date.now, gate);
  await memory.withExclusive(async (scope) => {
    const core = new IndexedDBDocumentStorage(() => factory, gate), chat = new ChatStorage(() => factory, () => undefined, gate);
    await assert.rejects(name === CORE_DATABASE_NAME ? core.readExisting("veil.foundation.v1", scope) : chat.readMemorySources("s", scope), /schema unavailable/);
  });
  assert.deepEqual(await factory.databases(), [{ name, version: 2 }]);
});

test("a stale database catalog cannot accidentally bootstrap a source", async () => {
  const factory = new IDBFactory(), catalog = factory.databases.bind(factory);
  factory.databases = async () => [{ name: CORE_DATABASE_NAME, version: 1 }];
  const core = new IndexedDBDocumentStorage(() => factory, gate);
  await assert.rejects(core.readExisting("veil.foundation.v1"), /source unavailable/);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(await catalog(), []);
});
