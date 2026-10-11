import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { BackupValidationError } from "../lib/backup/format";
import { createPersistenceWriteGate, withPersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { exportStaticBackupSnapshot } from "../lib/backup/snapshot-export";
import { acquireGenerationLock } from "../lib/chat/generation-lock";
import { lockOrigin } from "./generation-lock-fixture";
import { A, buildWorld } from "./character-deletion-fixture";
import { TEST_NOW } from "./backup-fixture";

const metadata = { backupId: "snapshot-test", createdAt: TEST_NOW, sourceCommit: "bb34c276605f257fb127c0e6b6a9513f3a96296d" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const origin = lockOrigin(), manager = origin.client() as unknown as BackupLockManager;
  const gate = createPersistenceWriteGate(() => manager);
  const world = await buildWorld({ gate });
  // The world's Binding overrides point at resources that do not exist in this simulation.
  await world.bindingStore.transact(() => ({ global: {}, characters: {} }));
  const source = { indexedDB: world.factory, localStorage: { getItem: (key: string) => world.raw.get(key) ?? null } };
  const markGeneration = async (sessionId: string) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = world.factory.open("veil-chat-v2"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite"), store = tx.objectStore("sessions");
      store.get(sessionId).onsuccess = (event) => {
        const session = (event.target as IDBRequest).result;
        store.put({ ...session, generation: { id: "attempt-1", stage: "provider" } });
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  };
  return { origin, manager, gate, world, source, markGeneration };
}

test("the capture waits for an in-flight logical write, then produces a valid package", async () => {
  const { manager, gate, source } = await fixture();
  const entered = deferred(), finish = deferred();
  const writing = withPersistenceWriteScope(gate, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  let done = false;
  const exporting = exportStaticBackupSnapshot(source, metadata, manager).then((result) => { done = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false, "the exclusive snapshot lock waits for the shared lease");
  finish.resolve(); await writing;
  const result = await exporting;
  assert.ok(result.files.size > 0 && JSON.parse(result.manifestJson).backupId === "snapshot-test");
});

test("a live reply refuses the backup with generation-active and produces no package", async () => {
  const { origin, manager, source, world, markGeneration } = await fixture();
  const sessionId = world.ids.sessionA.id;
  await markGeneration(sessionId);
  const reply = await acquireGenerationLock(world.factory, sessionId, origin.client() as unknown as LockManager);
  assert.ok(reply);
  await assert.rejects(exportStaticBackupSnapshot(source, metadata, manager),
    (error) => error instanceof BackupValidationError && error.code === "generation-active");
  await reply!();
});

test("a stale marker without a lock is not called live; the unchanged validation still rejects it, and the probe leaves no lock", async () => {
  const { origin, manager, source, world, markGeneration } = await fixture();
  const sessionId = world.ids.sessionA.id;
  await markGeneration(sessionId);
  await assert.rejects(exportStaticBackupSnapshot(source, metadata, manager),
    (error) => error instanceof BackupValidationError && error.code === "invalid-data");
  const later = await acquireGenerationLock(world.factory, sessionId, origin.client() as unknown as LockManager);
  assert.ok(later, "the generation lock is free after the backup");
  await later!();
});

test("coordination errors keep their existing codes", async () => {
  const { manager, gate, source } = await fixture();
  await assert.rejects(exportStaticBackupSnapshot(source, metadata, undefined),
    (error) => error instanceof BackupValidationError && error.code === "coordination-unavailable");
  const entered = deferred(), finish = deferred();
  const writing = withPersistenceWriteScope(gate, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  await assert.rejects(exportStaticBackupSnapshot(source, metadata, manager, { waitMs: 20 }),
    (error) => error instanceof BackupValidationError && error.code === "coordination-timeout");
  finish.resolve(); await writing;
  assert.equal(BACKUP_LOCK_NAME, "veil.persistence.snapshot.v1");
  void A;
});
