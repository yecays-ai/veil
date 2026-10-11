import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { AppearanceImageStorage } from "../lib/appearance-image-storage";
import { ChatStorage } from "../lib/chat/storage";
import { createPersistenceWriteGate, type PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { BACKUP_LOCK_NAME, BackupCoordinator, type BackupLockManager } from "../lib/backup/coordination";
import { BackupValidationError } from "../lib/backup/format";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const domains = ["core", "api", "appearance", "chat"] as const;
function fixture(domain: typeof domains[number], writeGate: PersistenceWriteGate) {
  const factory = new IDBFactory();
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const config = { id: "simulated", name: "Test", baseUrl: "https://example.invalid", apiKey: "SIMULATED_KEY", model: "test" };
  if (domain === "core") {
    const store = new IndexedDBDocumentStorage(() => factory, writeGate);
    return { factory, write: () => store.putIfAbsent("test", "saved"), read: async () => (await store.read("test")) !== null };
  }
  if (domain === "api") {
    const store = new ApiConfigStorage(() => factory, writeGate);
    return { factory, write: () => store.saveApiConfig(config), read: async () => (await store.listApiConfigs()).length > 0 };
  }
  if (domain === "appearance") {
    const store = new AppearanceImageStorage(() => factory, Date.now, writeGate);
    const id = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
    return { factory, write: () => store.saveBlobs([image]), read: async () => !!(await store.readBlob(id)) };
  }
  const store = new ChatStorage(() => factory, () => undefined, writeGate);
  return { factory, write: () => store.openSession("simulated-character"), read: async () => (await store.listSessions()).length > 0 };
}

for (const domain of domains) {
  test(`${domain} waits before creating a write transaction and holds the gate through commit`, async () => {
    const entered = deferred(), permit = deferred();
    let writes = 0, completed = 0, released = false, initializing = true;
    const gate: PersistenceWriteGate = { async withWrite<T>(operation: () => Promise<T>) {
      if (initializing) return operation();
      entered.resolve(); await permit.promise;
      try { return await operation(); }
      finally { assert.equal(completed, 1); released = true; }
    } };
    const env = fixture(domain, gate), original = IDBDatabase.prototype.transaction;
    assert.equal(await env.read(), false); // First open now coordinates schema initialization.
    initializing = false;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === "readwrite") { writes++; tx.addEventListener("complete", () => { completed++; }); }
      return tx;
    };
    try {
      const writing = env.write(); await entered.promise;
      assert.equal(writes, 0); assert.equal(released, false);
      assert.equal(await env.read(), false); // Cached readonly calls do not wait for the write gate.
      permit.resolve(); await writing;
      assert.equal(writes, 1); assert.equal(completed, 1); assert.equal(released, true);
      assert.equal(await env.read(), true);
    } finally { IDBDatabase.prototype.transaction = original; }
  });

  test(`${domain} denied coordination does not open or modify a database`, async () => {
    const locks = { request: (() => Promise.reject(new Error("SIMULATED_NATIVE_SECRET"))) as BackupLockManager["request"] };
    const env = fixture(domain, createPersistenceWriteGate(() => locks));
    await assert.rejects(env.write(), (error: unknown) => error instanceof BackupValidationError
      && error.code === "coordination-unavailable" && !error.message.includes("SIMULATED_NATIVE_SECRET"));
    assert.deepEqual(await env.factory.databases(), []);
  });
}

test("browser write adapter forwards the shared lock and waits until the storage operation settles", async () => {
  const permit = deferred(), ready = deferred(); let released = false;
  const locks = { request: (async (name: string, options: LockOptions, callback: (lock: Lock) => Promise<unknown>) => {
    assert.equal(name, BACKUP_LOCK_NAME); assert.equal(options.mode, "shared"); assert(options.signal);
    try { return await callback({ name, mode: "shared" } as Lock); } finally { released = true; }
  }) as BackupLockManager["request"] };
  const writing = createPersistenceWriteGate(() => locks).withWrite(async () => { ready.resolve(); await permit.promise; return "committed"; });
  await ready.promise; assert.equal(released, false);
  permit.resolve(); assert.equal(await writing, "committed"); assert.equal(released, true);
});

test("one exclusive snapshot blocks writes to all four databases from other lock clients", async () => {
  const origin = lockOrigin(), coordinator = new BackupCoordinator(origin.client());
  const envs = domains.map((domain) => fixture(domain, createPersistenceWriteGate(() => origin.client())));
  for (const env of envs) assert.equal(await env.read(), false);
  const ready = deferred(), finish = deferred();
  const capture = coordinator.withSnapshot(async () => { ready.resolve(); await finish.promise; });
  await ready.promise;
  const writes = envs.map((env) => env.write());
  for (const env of envs) assert.equal(await env.read(), false);
  finish.resolve(); await capture; await Promise.all(writes);
  for (const env of envs) assert.equal(await env.read(), true);
});

test("missing Web Locks preserves ordinary writes while snapshot acquisition fails closed", async () => {
  const gate = createPersistenceWriteGate(() => undefined);
  for (const domain of domains) { const env = fixture(domain, gate); await env.write(); assert.equal(await env.read(), true); }
  let captured = false;
  await assert.rejects(new BackupCoordinator(undefined).withSnapshot(async () => { captured = true; }),
    (error: unknown) => error instanceof BackupValidationError && error.code === "coordination-unavailable");
  assert.equal(captured, false);
});

test("API conflict abort settles before releasing the gate and preserves the committed record", async () => {
  const factory = new IDBFactory(); let aborted = false, releases = 0;
  const gate: PersistenceWriteGate = { async withWrite<T>(operation: () => Promise<T>) {
    try { return await operation(); } finally { releases++; if (releases === 2) assert.equal(aborted, true); }
  } };
  const store = new ApiConfigStorage(() => factory, gate);
  const original = await store.saveApiConfig({ id: "test", name: "Original", baseUrl: "https://example.invalid", apiKey: "SIMULATED", model: "test" });
  const transaction = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
    const tx = transaction.apply(this, args); if (args[1] === "readwrite") tx.addEventListener("abort", () => { aborted = true; }); return tx;
  };
  try {
    await assert.rejects(store.saveApiConfig({ ...original, name: "New" }, { ...original, name: "Stale" }));
    assert.deepEqual(await store.getApiConfig("test"), original);
    assert.equal(releases, 2);
  } finally { IDBDatabase.prototype.transaction = transaction; }
});
