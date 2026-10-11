import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BackupLockManager } from "../lib/backup/coordination";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, digestUnits, recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY,
  RESTORE_UNITS, type RestoreDevice, type RestoreUnit, type UnitWriters } from "../lib/backup/restore";
import { createSafetyCopyStore, type SafetyCopyStore } from "../lib/backup/safety-copy";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";
import { backupData, packageFixture } from "./backup-fixture";

function newDevice() {
  const raw = new Map<string, string>();
  const device: RestoreDevice & { raw: Map<string, string> } = { indexedDB: new IDBFactory(), raw,
    localStorage: { getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); } } };
  return device;
}
const pack = async (data = backupData()) => { const f = await packageFixture(data); return { manifestJson: JSON.stringify(f.manifest), files: f.files }; };
/** Package B differs from A in four units: chat, apiConfigs, worldbooks, and contacts (absent in B). */
async function packageB() {
  const data = backupData();
  data.apiConfigs = [{ ...data.apiConfigs[0], name: "Other API" }];
  data.worldbooks = { version: 1, books: [{ ...data.worldbooks!.books[0], name: "Other world" }] };
  data.contacts = null;
  data.chat.messages = data.chat.messages.map((m, i) => i ? m : { ...m, content: "模拟数据：changed" });
  return pack(data);
}
async function setup() {
  const locks = lockOrigin().client() as unknown as BackupLockManager, device = newDevice();
  const a = await pack(), b = await packageB();
  await restoreIntoEmpty(a.manifestJson, a.files, device, locks);
  // A credential that exists only on this device: a replace must neither read nor lose it.
  const writers = createUnitWriters(device), snapshot = await readStaticBackupSource(device);
  await writers.apiConfigs.write({ ...snapshot, apiConfigs: snapshot.apiConfigs.map((row) => ({ ...(row as object), apiKey: "secret-key" })) });
  const confirmed = await previewRestore(b.manifestJson, b.files, device, locks);
  const safety = createSafetyCopyStore(device.indexedDB);
  return { locks, device, a, b, confirmed, safety };
}
const digests = async (device: RestoreDevice) => digestUnits(await readStaticBackupSource(device));
const keys = async (device: RestoreDevice) => ((await readStaticBackupSource(device)).apiConfigs as { apiKey?: string }[]).map((row) => row.apiKey);
const differing = (async () => {
  const { device, b } = await setup();
  const clean = newDevice(), locks = lockOrigin().client() as unknown as BackupLockManager;
  await restoreIntoEmpty(b.manifestJson, b.files, clean, locks);
  const now = await digests(device), target = await digests(clean);
  return RESTORE_UNITS.filter((unit) => now[unit] !== target[unit]);
})();
function faulty(device: RestoreDevice, unit: RestoreUnit, lands: boolean): UnitWriters {
  const real = createUnitWriters(device), writers = { ...real };
  let armed = true;
  writers[unit] = { ...real[unit], write: async (snapshot) => {
    if (!armed) return real[unit].write(snapshot);
    armed = false; // the first write is the restore; later writes are the rollback putting the copy back
    if (lands) await real[unit].write(snapshot);
    throw new Error("injected");
  } };
  return writers;
}

test("a replace turns the device into exactly what a clean restore of the backup gives, and cleans up", async () => {
  const { locks, device, b, confirmed, safety } = await setup();
  const { restoreId } = await replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed });
  const clean = newDevice();
  await restoreIntoEmpty(b.manifestJson, b.files, clean, locks);
  assert.deepEqual(await digests(device), await digests(clean));
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
  assert.equal(await safety.load(restoreId), null, "the temporary copy is removed");
  assert.equal(device.raw.has("veil.contacts.v1"), false, "a domain absent from the backup is emptied, not kept");
});

test("the differing set is what the fixtures promise", async () => {
  assert.deepEqual([...await differing].sort(), ["apiConfigs", "chat", "contacts", "worldbooks"]);
});

for (const unit of ["chat", "apiConfigs", "worldbooks", "contacts"] as const) {
  for (const lands of [false, true]) {
    test(`a failure at ${unit}${lands ? " that lands before reporting failure" : ""} puts the device back exactly, including the API key`, async () => {
      const { locks, device, b, confirmed } = await setup();
      const original = await digests(device), originalRaw = new Map(device.raw);
      const originalKeys = await keys(device);
      assert.deepEqual(originalKeys, ["secret-key"]);
      await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: faulty(device, unit, lands) }),
        (e) => e instanceof RestoreError && e.code === "restore-failed-rolled-back" && e.unit === unit && e.journal === "none");
      assert.deepEqual(await digests(device), original);
      assert.deepEqual(await keys(device), originalKeys);
      assert.deepEqual([...device.raw].sort(), [...originalRaw].sort());
      assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
    });
  }
}

test("an interrupted replace can be rolled back from the safety copy, or resumed with the same package", async () => {
  for (const action of ["rollback", "resume"] as const) {
    const { locks, device, a, b, confirmed } = await setup();
    const original = await digests(device), real = createUnitWriters(device);
    // The writer fails, and the first rollback attempt fails too: the page "dies" with the journal in place.
    const hurt = { ...real, worldbooks: { ...real.worldbooks, write: async () => { throw new Error("x"); } },
      chat: { ...real.chat, write: async (s: never) => { if (++chatCalls > 1 && hurtOn) throw new Error("x"); return real.chat.write(s); } } };
    let chatCalls = 0, hurtOn = true;
    await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: hurt }));
    hurtOn = false;
    assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
    if (action === "rollback") {
      await recoverRestore("rollback", device, locks, null);
      assert.deepEqual(await digests(device), original);
      assert.deepEqual(await keys(device), ["secret-key"]);
    } else {
      await recoverRestore("resume", device, locks, b);
      const clean = newDevice();
      await restoreIntoEmpty(b.manifestJson, b.files, clean, locks);
      assert.deepEqual(await digests(device), await digests(clean));
    }
    assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
    void a;
  }
});

test("without its safety copy a rollback refuses and keeps the journal, but resume still works", async () => {
  const { locks, device, b, confirmed } = await setup();
  const real = createUnitWriters(device), broken = { ...real, worldbooks: { ...real.worldbooks, write: async () => { throw new Error("x"); } },
    contacts: { ...real.contacts, clear: async () => { throw new Error("x"); }, write: async () => { throw new Error("x"); } } };
  const lost: SafetyCopyStore = { save: async () => {}, load: async () => null, remove: async () => {} };
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: broken, safety: lost }),
    (e) => e instanceof RestoreError && e.code === "safety-copy-missing");
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
  await assert.rejects(recoverRestore("rollback", device, locks, null, { safety: lost }), (e) => e instanceof RestoreError && e.code === "safety-copy-missing");
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
  await recoverRestore("resume", device, locks, b, { safety: lost });
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
});

test("a replace needs the confirmed preview, a fresh one, and a device that actually has data", async () => {
  const { locks, device, b, confirmed } = await setup();
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, {} as never), (e) => e instanceof RestoreError && e.code === "replace-not-confirmed");
  device.raw.set("veil.regex.v1", JSON.stringify({ version: 1, groups: [] }));
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed }), (e) => e instanceof RestoreError && e.code === "preview-changed");
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
  const empty = newDevice();
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, empty, locks, { confirmed }), (e) => e instanceof RestoreError && e.code === "not-empty-restore");
  const filled = await setup();
  await assert.rejects(restoreIntoEmpty(filled.b.manifestJson, filled.b.files, filled.device, filled.locks), (e) => e instanceof RestoreError && e.code === "not-empty-restore");
});

test("if the safety copy cannot be saved nothing is touched", async () => {
  const { locks, device, b, confirmed } = await setup();
  const before = await digests(device), beforeRaw = new Map(device.raw);
  const broken: SafetyCopyStore = { save: async () => { throw new Error("full"); }, load: async () => null, remove: async () => {} };
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, safety: broken }),
    (e) => e instanceof RestoreError && e.code === "safety-copy-failed" && e.journal === "none");
  assert.deepEqual(await digests(device), before);
  assert.deepEqual([...device.raw], [...beforeRaw]);
});

test("a unit changed by someone else during recovery is never overwritten", async () => {
  const { locks, device, b, confirmed } = await setup();
  const real = createUnitWriters(device), hurt = { ...real, worldbooks: { ...real.worldbooks, write: async () => { throw new Error("x"); } },
    chat: { ...real.chat, write: async (s: never) => { if (++chatCalls > 1) throw new Error("x"); return real.chat.write(s); } } };
  let chatCalls = 0;
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: hurt }));
  device.raw.set("veil.regex.v1", JSON.stringify({ version: 1, groups: [], mine: true }));
  await assert.rejects(recoverRestore("rollback", device, locks, null), (e) => e instanceof RestoreError && e.code === "target-changed" && e.unit === "regex");
  assert.equal(JSON.parse(device.raw.get("veil.regex.v1")!).mine, true);
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
});
