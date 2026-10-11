import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { encodeBackupArchive } from "../lib/backup/archive";
import { applyBackup, backupFileName, createBackupFile, describeBackupError, hasRestoreJournal, inspectBackupFile,
  recoverBackup, type BackupBrowser } from "../lib/backup/backup-flow";
import { BackupValidationError } from "../lib/backup/format";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { createUnitWriters, digestUnits, RestoreError, RESTORE_JOURNAL_KEY } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import type { BackupLockManager } from "../lib/backup/coordination";
import { buildWorld } from "./character-deletion-fixture";
import { lockOrigin } from "./generation-lock-fixture";
import { TEST_NOW } from "./backup-fixture";

function wrap(factory: IDBFactory, raw: Map<string, string>, locks: BackupLockManager): BackupBrowser {
  return { locks, device: { indexedDB: factory, localStorage: { getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); } } } };
}
async function setup() {
  const locks = lockOrigin().client() as unknown as BackupLockManager;
  const world = await buildWorld({ gate: createPersistenceWriteGate(() => locks) });
  await world.bindingStore.transact(() => ({ global: {}, characters: {} }));
  return { locks, source: wrap(world.factory, world.raw, locks), world,
    fresh: () => wrap(new IDBFactory(), new Map(), locks) };
}
const digests = async (env: BackupBrowser) => digestUnits(await readStaticBackupSource(env.device));

test("export → file → import into an empty device reproduces the data without API keys", async () => {
  const { source, fresh } = await setup();
  const file = await createBackupFile(source, { now: () => TEST_NOW, newId: () => "flow-backup" });
  assert.equal(file.fileName, backupFileName(TEST_NOW));
  assert.match(file.fileName, /^veil-backup-2023-11-14-22-13-20\.zip$/);
  const target = fresh();
  const inspected = await inspectBackupFile(file.bytes, target);
  assert.equal(inspected.preview.mode, "empty-restore");
  await applyBackup(inspected, target);
  assert.deepEqual(await digests(target), await digests(source));
  assert.equal(hasRestoreJournal(target.device.localStorage), false);
});

test("a device that already has data takes the explicit replace path and ends identical", async () => {
  const { source, fresh } = await setup();
  const file = await createBackupFile(source);
  const target = fresh();
  await applyBackup(await inspectBackupFile(file.bytes, target), target);
  const again = await inspectBackupFile(file.bytes, target);
  assert.equal(again.preview.mode, "replace-required");
  await applyBackup(again, target);
  assert.deepEqual(await digests(target), await digests(source));
});

test("a blocked preview cannot be applied", async () => {
  const { source, fresh } = await setup();
  const file = await createBackupFile(source);
  const target = fresh();
  const inspected = await inspectBackupFile(file.bytes, target);
  await assert.rejects(applyBackup({ ...inspected, preview: { ...inspected.preview, mode: "blocked" } }, target),
    (e) => e instanceof RestoreError && e.code === "not-empty-restore");
});

test("files that are not backups are rejected with a plain message and nothing is read from the device", async () => {
  const { fresh } = await setup();
  const target = fresh();
  for (const bytes of [new Uint8Array([1, 2, 3]), new TextEncoder().encode("{}"), new Uint8Array()]) {
    await assert.rejects(inspectBackupFile(bytes, target), (e) => e instanceof BackupValidationError && describeBackupError(e) === "This file is not a valid VEIL backup.");
  }
  assert.deepEqual(await target.device.indexedDB.databases(), []);
});

test("an interrupted restore leaves a journal the flow can roll back or finish", async () => {
  const { source, fresh } = await setup();
  const file = await createBackupFile(source);
  for (const action of ["rollback", "resume"] as const) {
    const target = fresh();
    const inspected = await inspectBackupFile(file.bytes, target);
    const real = createUnitWriters(target.device);
    const { restoreIntoEmpty } = await import("../lib/backup/restore");
    await assert.rejects(restoreIntoEmpty(inspected.pack.manifestJson, inspected.pack.files, target.device, target.locks, {
      writers: { ...real, presence: { ...real.presence, write: async () => { throw new Error("x"); } },
        chat: { ...real.chat, clear: async () => { throw new Error("x"); } } } }));
    assert.equal(hasRestoreJournal(target.device.localStorage), true);
    await recoverBackup(action, target, action === "resume" ? inspected.pack : null);
    assert.equal(hasRestoreJournal(target.device.localStorage), false);
    if (action === "resume") assert.deepEqual(await digests(target), await digests(source));
  }
});

test("a different archive cannot finish someone else's restore", async () => {
  const { source, fresh } = await setup();
  const file = await createBackupFile(source, { newId: () => "one" }), other = await createBackupFile(source, { newId: () => "two" });
  const target = fresh();
  const inspected = await inspectBackupFile(file.bytes, target);
  const real = createUnitWriters(target.device);
  const { restoreIntoEmpty } = await import("../lib/backup/restore");
  await assert.rejects(restoreIntoEmpty(inspected.pack.manifestJson, inspected.pack.files, target.device, target.locks, {
    writers: { ...real, presence: { ...real.presence, write: async () => { throw new Error("x"); } },
      chat: { ...real.chat, clear: async () => { throw new Error("x"); } } } }));
  const { decodeBackupArchive } = await import("../lib/backup/archive");
  await assert.rejects(recoverBackup("resume", target, decodeBackupArchive(other.bytes)), (e) => e instanceof RestoreError && e.code === "package-mismatch");
  assert.equal(hasRestoreJournal(target.device.localStorage), true);
});

test("user-facing messages are plain sentences and never echo codes for the common cases", () => {
  const cases: [unknown, RegExp][] = [
    [new BackupValidationError("coordination-timeout", "coordination"), /Another VEIL tab/],
    [new BackupValidationError("generation-active", "chat"), /reply is being generated/],
    [new BackupValidationError("invalid-data", "chat.sessions[0]", "unexpected-field:generation"), /Open that conversation/],
    [new BackupValidationError("invalid-data", "chat.sessions[1]", "direct-has-title"), /Stored conversation 2 .*chat\.sessions\[1\]: direct-has-title/],
    [new BackupValidationError("invalid-data", "chat.messages[0]"), /Some stored data cannot be backed up \(chat\.messages\[0\]\)/],
    [new RestoreError("restore-failed-rolled-back", "none", "chat"), /put back as it was/],
    [new RestoreError("rollback-failed", "kept"), /reopen this page/],
    [new Error("boom"), /Nothing was reported as completed/],
  ];
  for (const [error, pattern] of cases) assert.match(describeBackupError(error), pattern);
  assert.equal(RESTORE_JOURNAL_KEY, "veil.restore-journal.v1");
  void encodeBackupArchive;
});
