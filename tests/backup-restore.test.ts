import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate, withPersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, digestUnits, snapshotFromBackup, recoverRestore, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY, RESTORE_UNITS,
  type RestoreDevice, type RestoreUnit, type UnitWriters } from "../lib/backup/restore";
import { validateBackupPackage } from "../lib/backup/validation";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";
import { packageFixture, packageFixtureWithImages } from "./backup-fixture";

function newDevice() {
  const raw = new Map<string, string>();
  const device: RestoreDevice & { raw: Map<string, string>; failSet?: (key: string) => boolean } = {
    indexedDB: new IDBFactory(), raw,
    localStorage: {
      getItem: (key) => raw.get(key) ?? null,
      setItem: (key, value) => { if (device.failSet?.(key)) throw new Error("quota"); raw.set(key, value); },
      removeItem: (key) => { raw.delete(key); },
    },
  };
  return device;
}
async function setup(images = true) {
  const origin = lockOrigin(), locks = origin.client() as unknown as BackupLockManager;
  const f = await (images ? packageFixtureWithImages() : packageFixture());
  return { locks, device: newDevice(), manifest: JSON.stringify(f.manifest), files: f.files, f };
}
const digests = async (device: RestoreDevice) => digestUnits(await readStaticBackupSource(device));
async function emptyState(device: RestoreDevice) {
  const state = await digests(device);
  return RESTORE_UNITS.every((unit) => state[unit] === "empty");
}
/** Wraps a writer so a unit fails; `lands` writes first and then reports failure (a lying error). */
function faulty(device: RestoreDevice, fail: { unit: RestoreUnit; lands?: boolean; clearFails?: { times: number } }): UnitWriters {
  const real = createUnitWriters(device);
  const writers = { ...real };
  writers[fail.unit] = {
    write: async (snapshot) => { if (fail.lands) await real[fail.unit].write(snapshot); throw new Error("injected"); },
    clear: async () => { if (fail.clearFails && fail.clearFails.times-- > 0) throw new Error("clear injected"); return real[fail.unit].clear(); },
  };
  return writers;
}

test("a clean restore writes every domain, matches the backup and leaves no journal", async () => {
  const { locks, device, manifest, files } = await setup();
  const result = await restoreIntoEmpty(manifest, files, device, locks);
  assert.equal(result.backupId, "simulated-backup");
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
  const preview = await previewRestore(manifest, files, device, locks);
  assert.equal(preview.mode, "replace-required");
  assert.equal(preview.domains.chat?.current, preview.domains.chat?.backup);
  assert.equal(preview.assets?.chat.current, preview.assets?.chat.backup);
  assert.equal(preview.assets?.appearance.current, preview.assets?.appearance.backup);
  const state = await digests(device);
  assert.ok(RESTORE_UNITS.some((unit) => state[unit] !== "empty"));
});

test("restored API configs carry no credential", async () => {
  const { locks, device, manifest, files } = await setup();
  await restoreIntoEmpty(manifest, files, device, locks);
  const snapshot = await readStaticBackupSource(device);
  assert.ok(snapshot.apiConfigs.every((row) => !("apiKey" in (row as object))));
});

const present = (async () => {
  const f = await packageFixtureWithImages(), v = await validateBackupPackage(JSON.stringify(f.manifest), f.files);
  const state = await digestUnits(snapshotFromBackup(v, f.files));
  return RESTORE_UNITS.filter((unit) => state[unit] !== "empty");
})();
test("units the backup has nothing for are never written", async () => {
  const { locks, device, manifest, files } = await setup(false);
  const state = await digestUnits(snapshotFromBackup(await validateBackupPackage(manifest, files), files));
  const writers = createUnitWriters(device), called: string[] = [];
  const spy = Object.fromEntries(RESTORE_UNITS.map((unit) => [unit, { ...writers[unit], write: async (s: never) => { called.push(unit); return writers[unit].write(s); } }])) as UnitWriters;
  await restoreIntoEmpty(manifest, files, device, locks, { writers: spy });
  assert.deepEqual(called.sort(), RESTORE_UNITS.filter((unit) => state[unit] !== "empty").sort());
  assert.equal(called.includes("appearanceAssets"), false);
});

for (const unit of RESTORE_UNITS) {
  for (const lands of [false, true]) {
    test(`a failure at ${unit}${lands ? " that reports failure after landing" : ""} rolls everything back to empty`, async () => {
      assert.ok((await present).includes(unit), "every fault target must contain fixture data");
      const { locks, device, manifest, files } = await setup();
      await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: faulty(device, { unit, lands }) }),
        (error) => error instanceof RestoreError && error.code === "restore-failed-rolled-back" && error.unit === unit && error.journal === "none");
      assert.equal(await emptyState(device), true);
      assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
    });
  }
}

test("when rollback itself fails the journal stays, and rollback can be retried to empty", async () => {
  const { locks, device, manifest, files } = await setup();
  const writers = faulty(device, { unit: "regex", clearFails: { times: 1 } });
  const failing = { ...writers, presence: { ...writers.presence, write: async () => { throw new Error("injected"); } } };
  // bindings is written before presence and its clear fails once: rollback cannot finish.
  failing.bindings = { ...writers.bindings, clear: async () => { throw new Error("clear injected"); } };
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: failing }), (error) => error instanceof Error);
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
  await recoverRestore("rollback", device, locks, null);
  assert.equal(await emptyState(device), true);
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
});

test("an interrupted restore resumes with the same package and ends identical to a clean restore", async () => {
  const { locks, device, manifest, files } = await setup();
  const writers = createUnitWriters(device);
  const crash = { ...writers, contacts: { ...writers.contacts, write: async () => { throw new Error("injected"); } },
    // rollback is also interrupted: simulate the page being killed by failing every clear
    bindings: { ...writers.bindings, clear: async () => { throw new Error("killed"); } } };
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: crash }));
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
  await recoverRestore("resume", device, locks, { manifestJson: manifest, files });
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
  const clean = newDevice();
  await restoreIntoEmpty(manifest, files, clean, locks);
  assert.deepEqual(await digests(device), await digests(clean));
});

test("resume refuses a different package, and recovery with no journal says so", async () => {
  const { locks, device, manifest, files } = await setup();
  await assert.rejects(recoverRestore("rollback", device, locks, null), (e) => e instanceof RestoreError && e.code === "no-journal");
  const writers = createUnitWriters(device);
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: { ...writers,
    presence: { ...writers.presence, write: async () => { throw new Error("x"); } }, chat: { ...writers.chat, clear: async () => { throw new Error("x"); } } } }));
  const other = await packageFixture();
  other.manifest.backupId = "someone-else";
  await assert.rejects(recoverRestore("resume", device, locks, { manifestJson: JSON.stringify(other.manifest), files: other.files }), (e) => e instanceof Error);
  await assert.rejects(recoverRestore("resume", device, locks, null), (e) => e instanceof RestoreError && e.code === "package-mismatch");
});

test("data that appeared on the device is never cleared or overwritten", async () => {
  const { locks, device, manifest, files } = await setup();
  const writers = createUnitWriters(device);
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: { ...writers,
    regex: { ...writers.regex, write: async () => { throw new Error("x"); } },
    appearance: { ...writers.appearance, clear: async () => { throw new Error("x"); } } } }));
  device.raw.set("veil.contacts.v1", JSON.stringify({ contacts: [], version: 99, mine: true }));
  await assert.rejects(recoverRestore("rollback", device, locks, null), (e) => e instanceof RestoreError && e.code === "target-changed" && e.unit === "contacts");
  assert.equal(JSON.parse(device.raw.get("veil.contacts.v1")!).mine, true);
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
});

test("a non-empty device, a changed device and a leftover journal are refused before any write", async () => {
  const { locks, device, manifest, files } = await setup();
  device.raw.set("veil.bindings.v1", JSON.stringify({ global: {}, characters: {} }));
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks), (e) => e instanceof RestoreError && e.code === "not-empty-restore");
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);

  const fresh = await setup();
  const confirmed = await previewRestore(fresh.manifest, fresh.files, fresh.device, fresh.locks);
  fresh.device.raw.set("veil.bindings.v1", JSON.stringify({ global: {}, characters: {} }));
  await assert.rejects(restoreIntoEmpty(fresh.manifest, fresh.files, fresh.device, fresh.locks, { confirmed }),
    (e) => e instanceof RestoreError && (e.code === "not-empty-restore" || e.code === "preview-changed"));

  const third = await setup();
  third.device.raw.set(RESTORE_JOURNAL_KEY, "garbage");
  await assert.rejects(restoreIntoEmpty(third.manifest, third.files, third.device, third.locks), (e) => e instanceof RestoreError && e.code === "journal-invalid");
  assert.equal(third.device.raw.get(RESTORE_JOURNAL_KEY), "garbage");
});

test("a journal that cannot be written stops the restore before anything is written", async () => {
  const { locks, device, manifest, files } = await setup();
  device.failSet = (key) => key === RESTORE_JOURNAL_KEY;
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks), (e) => e instanceof RestoreError && e.code === "journal-write-failed");
  assert.equal(await emptyState(device), true);
});

test("a write that silently stores the wrong thing is caught by verification and rolled back", async () => {
  const { locks, device, manifest, files } = await setup();
  const writers = createUnitWriters(device);
  const lying = { ...writers, presets: { ...writers.presets, write: async () => { device.raw.set("veil.preset.v1", JSON.stringify({ wrong: true })); } } };
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: lying }),
    (e) => e instanceof RestoreError && e.code === "verify-failed-rolled-back" && e.journal === "none");
  assert.equal(await emptyState(device), true);
  assert.equal(device.raw.has("veil.restore-journal.v1"), false);
});

test("a rollback whose clear throws is reported as rollback-failed with the journal kept", async () => {
  const { locks, device, manifest, files } = await setup();
  const writers = createUnitWriters(device);
  const broken = { ...writers,
    presets: { ...writers.presets, write: async () => { throw new Error("write"); } },
    chat: { ...writers.chat, clear: async () => { throw new Error("clear"); } } };
  await assert.rejects(restoreIntoEmpty(manifest, files, device, locks, { writers: broken }),
    (e) => e instanceof RestoreError && e.code === "rollback-failed" && e.journal === "kept" && e.unit === "chat");
});

test("the restore waits for in-flight logical writes (exclusive snapshot lock)", async () => {
  const { locks, device, manifest, files } = await setup();
  const gate = createPersistenceWriteGate(() => locks);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const writing = withPersistenceWriteScope(gate, async () => { started(); await hold; });
  await entered;
  let done = false;
  const restoring = restoreIntoEmpty(manifest, files, device, locks).then(() => { done = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  release(); await writing; await restoring;
  assert.equal(done, true);
  await assert.rejects(restoreIntoEmpty(manifest, files, device, undefined), (e) => e instanceof Error && /coordination/.test(e.message));
});
