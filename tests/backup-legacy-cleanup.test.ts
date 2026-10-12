import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { BackupValidationError } from "../lib/backup/format";
import { describeBackupError } from "../lib/backup/backup-flow";
import { previewRestore } from "../lib/backup/restore-preview";
import { restoreIntoEmpty, replaceWithBackup } from "../lib/backup/restore";
import { exportStaticBackup } from "../lib/backup/static-export";
import { packageFixture, TEST_NOW, TEST_COMMIT } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";

async function legacy(factory: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open("veil-chat-v1", 5);
    opening.onupgradeneeded = () => opening.result.createObjectStore("messages", { keyPath: "id" });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    tx.objectStore("messages").put({ id: "disposable-test-message", content: "simulated" });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  return db;
}
async function setup() {
  const factory = new IDBFactory(), raw = new Map<string, string>();
  const device = { indexedDB: factory, localStorage: { getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => { raw.set(key, value); }, removeItem: (key: string) => { raw.delete(key); } } };
  const fixture = await packageFixture();
  return { factory, device, locks: lockOrigin().client(), manifest: JSON.stringify(fixture.manifest), files: fixture.files };
}

test("precise legacy cleanup runs once and preserves all current authorities through export, preview and replace", async () => {
  const { factory, device, locks, manifest, files } = await setup();
  await restoreIntoEmpty(manifest, files, device, locks);
  const before = await readStaticBackupSource(device);
  (await legacy(factory)).close();
  const original = factory.deleteDatabase.bind(factory), deleted: string[] = [];
  factory.deleteDatabase = (name) => { deleted.push(name); return original(name); };
  const exported = await exportStaticBackup(device, { backupId: "test", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT });
  assert.ok(exported.files.size > 0);
  assert.deepEqual(await readStaticBackupSource(device), before);
  const preview = await previewRestore(manifest, files, device, locks);
  assert.equal(preview.mode, "replace-required");
  await replaceWithBackup(manifest, files, device, locks, { confirmed: preview });
  assert.deepEqual(await readStaticBackupSource(device), before);
  assert.deepEqual(deleted, ["veil-chat-v1"]);
  assert.ok((await factory.databases()).some((db) => db.name === "veil-chat-v2"));
  assert.ok(!(await factory.databases()).some((db) => db.name === "veil-chat-v1"));
});

test("legacy-only device can preview and restore into empty after deletion", async () => {
  const { factory, device, locks, manifest, files } = await setup();
  (await legacy(factory)).close();
  const preview = await previewRestore(manifest, files, device, locks);
  assert.equal(preview.mode, "empty-restore");
  await restoreIntoEmpty(manifest, files, device, locks, { confirmed: preview });
  assert.ok(!(await factory.databases()).some((db) => db.name === "veil-chat-v1"));
});

test("an occupied legacy database stops promptly and retry succeeds after its connection closes", async () => {
  const { factory, device, locks, manifest, files } = await setup();
  const held = await legacy(factory);
  try {
    await assert.rejects(exportStaticBackup(device, { backupId: "test", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT }), (error) => error instanceof BackupValidationError
      && error.code === "legacy-cleanup-failed" && /Close other VEIL tabs/.test(describeBackupError(error)));
    const preview = await previewRestore(manifest, files, device, locks);
    assert.equal(preview.mode, "blocked");
    assert.ok(preview.blockers.some((blocker) => blocker.code === "target-unreadable" && blocker.error === "legacy-cleanup-failed"));
  } finally { held.close(); }
  await readStaticBackupSource(device);
  assert.ok(!(await factory.databases()).some((db) => db.name === "veil-chat-v1"));
});

for (const mode of ["throw", "error", "hang"] as const) test(`delete ${mode} fails closed without waiting forever`, async (t) => {
  const { factory, device } = await setup();
  (await legacy(factory)).close();
  const request = {} as IDBOpenDBRequest;
  factory.deleteDatabase = () => {
    if (mode === "throw") throw new Error("sensitive native message");
    if (mode === "error") queueMicrotask(() => request.onerror?.call(request, new Event("error")));
    return request;
  };
  if (mode === "hang") t.mock.timers.enable({ apis: ["setTimeout"] });
  const failed = assert.rejects(readStaticBackupSource(device), (error) => error instanceof BackupValidationError
    && error.code === "legacy-cleanup-failed" && !describeBackupError(error).includes("sensitive"));
  if (mode === "hang") { await new Promise<void>((resolve) => setImmediate(resolve)); t.mock.timers.tick(5000); }
  await failed;
  assert.ok((await factory.databases()).some((db) => db.name === "veil-chat-v1"));
});

test("device errors and damaged archives have different safe messages", () => {
  for (const code of ["unsupported-source-database", "source-catalog-unavailable", "source-unavailable", "source-read-failed",
    "unsupported-source-schema", "invalid-source-json", "invalid-source-data", "legacy-cleanup-failed"])
    assert.notEqual(describeBackupError(new BackupValidationError(code, "private-path")), "This file is not a valid VEIL backup.");
  assert.equal(describeBackupError(new BackupValidationError("archive-invalid", "archive")), "This file is not a valid VEIL backup.");
});

test("a delete success event is not enough if the catalog still contains the old database", async () => {
  const { factory, device } = await setup();
  (await legacy(factory)).close();
  factory.deleteDatabase = () => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => request.onsuccess?.call(request, new Event("success")));
    return request;
  };
  await assert.rejects(readStaticBackupSource(device), (error) => error instanceof BackupValidationError && error.code === "legacy-cleanup-failed");
});

test("unknown databases appearing after cleanup are still rejected and never deleted", async () => {
  const { factory, device, locks, manifest, files } = await setup();
  (await legacy(factory)).close();
  const original = factory.databases.bind(factory);
  let calls = 0;
  factory.databases = async () => {
    const catalog = await original();
    return ++calls === 1 ? catalog : [...catalog, { name: "veil-chat-v1-extra", version: 1 }];
  };
  await assert.rejects(readStaticBackupSource(device), (error) => error instanceof BackupValidationError && error.code === "unsupported-source-database");
  const preview = await previewRestore(manifest, files, device, locks);
  assert.equal(preview.mode, "blocked");
  assert.ok(preview.blockers.some((blocker) => blocker.code === "target-unreadable" && blocker.error === "unsupported-source-database"));
});
