import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { BackupValidationError } from "../lib/backup/format";
import { previewRestore } from "../lib/backup/restore-preview";
import { exportStaticBackup } from "../lib/backup/static-export";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { createUnitWriters, recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY,
  type RestoreDevice } from "../lib/backup/restore";
import { createSafetyCopyStore } from "../lib/backup/safety-copy";
import { lockOrigin } from "./generation-lock-fixture";
import { packageFixture, TEST_NOW, TEST_COMMIT } from "./backup-fixture";

async function setup() {
  const raw = new Map<string, string>();
  const device: RestoreDevice = { indexedDB: new IDBFactory(), localStorage: {
    getItem: (key) => raw.get(key) ?? null, setItem: (key, value) => { raw.set(key, value); }, removeItem: (key) => { raw.delete(key); },
  } };
  const fixture = await packageFixture();
  return { device, raw, locks: lockOrigin().client(), pack: { manifestJson: JSON.stringify(fixture.manifest), files: fixture.files } };
}
const emptyDocuments = {
  "veil.contacts.v1": { version: 1, contacts: [] },
  "veil.preset.v1": { version: 1, presets: [] },
  "veil.regex.v1": { version: 1, groups: [] },
  "veil.worldbooks.v1": { version: 1, books: [] },
  "veil.presence.v1": { version: 1, characters: [] },
};

for (const [key, value] of Object.entries(emptyDocuments)) {
  test(`present zero-record document ${key} requires replace; empty restore leaves no journal`, async () => {
    const { device, raw, locks, pack } = await setup();
    raw.set(key, JSON.stringify(value));
    const original = new Map(raw);
    const preview = await previewRestore(pack.manifestJson, pack.files, device, locks);
    assert.equal(preview.mode, "replace-required");
    await assert.rejects(restoreIntoEmpty(pack.manifestJson, pack.files, device, locks),
      (error) => error instanceof RestoreError && error.code === "not-empty-restore" && error.journal === "none");
    assert.deepEqual(raw, original);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  });
}

for (const action of ["resume", "rollback"] as const) {
  test(`interrupted replace of zero-record documents can ${action} after restarting the recovery objects`, async () => {
    const { device, raw, locks, pack } = await setup();
    for (const [key, value] of Object.entries(emptyDocuments)) raw.set(key, JSON.stringify(value));
    const original = new Map(raw);
    const confirmed = await previewRestore(pack.manifestJson, pack.files, device, locks);
    const writers = createUnitWriters(device);
    // Land several units, fail later, then interrupt automatic rollback. No timers or phone interaction.
    const broken = { ...writers,
      presence: { ...writers.presence, write: async () => { throw new Error("injected write failure"); } },
      contacts: { ...writers.contacts, write: async (snapshot: Parameters<typeof writers.contacts.write>[0]) => {
        if (snapshot.documents.contacts && (snapshot.documents.contacts as { contacts: unknown[] }).contacts.length === 0)
          throw new Error("injected rollback interruption");
        return writers.contacts.write(snapshot);
      } },
    };
    await assert.rejects(replaceWithBackup(pack.manifestJson, pack.files, device, locks, { confirmed, writers: broken }),
      (error) => error instanceof RestoreError && error.code === "rollback-failed" && error.journal === "kept");
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), true);
    assert.notEqual(raw.get("veil.contacts.v1"), original.get("veil.contacts.v1"));
    // Fresh writers, lock manager and safety store imitate a new page; only persisted device state survives.
    await recoverRestore(action, device, lockOrigin().client(), action === "resume" ? pack : null);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
    if (action === "rollback") assert.deepEqual(raw, original);
    else {
      const clean = await setup();
      await restoreIntoEmpty(pack.manifestJson, pack.files, clean.device, clean.locks);
      assert.deepEqual(await readStaticBackupSource(device), await readStaticBackupSource(clean.device));
    }
  });
}

async function createUnknownDatabase(device: RestoreDevice, name: string, hasRows: boolean) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = device.indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("simulated", { keyPath: "id" });
    request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
  });
  if (hasRows) await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("simulated", "readwrite");
    tx.objectStore("simulated").put({ id: "test", characterId: "simulated-character" });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
  });
  db.close();
}

for (const name of ["veil-future-domain-test", "future-domain-test"]) for (const hasRows of [false, true]) {
  test(`an unregistered database ${name} (${hasRows ? "populated" : "empty"}) blocks export and restore before writes`, async () => {
    const { device, raw, locks, pack } = await setup();
    const confirmed = await previewRestore(pack.manifestJson, pack.files, device, locks);
    await createUnknownDatabase(device, name, hasRows);
    const before = await device.indexedDB.databases();
    await assert.rejects(exportStaticBackup(device, { backupId: "test", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT }),
      (error) => error instanceof BackupValidationError && error.code === "unsupported-source-database" && error.path === "databases");
    const preview = await previewRestore(pack.manifestJson, pack.files, device, locks);
    assert.equal(preview.mode, "blocked");
    assert.ok(preview.blockers.some((blocker) => blocker.code === "target-unreadable" && blocker.error === "unsupported-source-database"));
    await assert.rejects(restoreIntoEmpty(pack.manifestJson, pack.files, device, locks, { confirmed }));
    await assert.rejects(replaceWithBackup(pack.manifestJson, pack.files, device, locks, { confirmed }));
    assert.deepEqual(await device.indexedDB.databases(), before);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  });
}

test("the internal safety-copy database is explicitly excluded from business export", async () => {
  const { device } = await setup();
  const snapshot = await readStaticBackupSource(device);
  await createSafetyCopyStore(device.indexedDB).save("simulated-copy", snapshot, TEST_NOW);
  const result = await exportStaticBackup(device, { backupId: "test", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT });
  assert.equal(result.files.size, 11);
  assert.deepEqual(await readStaticBackupSource(device), snapshot);
});

test("unknown databases appearing during interrupted recovery keep the journal and all known data", async () => {
  const { device, raw, locks, pack } = await setup();
  const writers = createUnitWriters(device);
  await assert.rejects(restoreIntoEmpty(pack.manifestJson, pack.files, device, locks, { writers: { ...writers,
    presets: { ...writers.presets, write: async () => { throw new Error("injected"); } },
    chat: { ...writers.chat, clear: async () => { throw new Error("interrupted rollback"); } },
  } }));
  assert.equal(raw.has(RESTORE_JOURNAL_KEY), true);
  const snapshot = await readStaticBackupSource(device), original = new Map(raw);
  await createUnknownDatabase(device, "future-domain-test", true);
  for (const action of ["resume", "rollback"] as const) {
    await assert.rejects(recoverRestore(action, device, locks, action === "resume" ? pack : null));
    assert.deepEqual(raw, original);
  }
  // Remove only the simulated unknown DB so we can verify the guarded units were untouched.
  await new Promise<void>((resolve, reject) => {
    const request = device.indexedDB.deleteDatabase("future-domain-test");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  assert.deepEqual(await readStaticBackupSource(device), snapshot);
});
