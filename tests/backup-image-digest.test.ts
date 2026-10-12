import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { backupData, packageFixture, sha256 } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";
import { createUnitWriters, digestUnits, recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY,
  type RestoreDevice } from "../lib/backup/restore";
import { snapshotFromBackup } from "../lib/backup/restore";
import { createSafetyCopyStore } from "../lib/backup/safety-copy";
import { validateBackupPackage } from "../lib/backup/validation";
import { digestImageRows } from "../lib/backup/image-digest";
import { BackupValidationError } from "../lib/backup/format";
import { previewRestore, restorePreviewChanged } from "../lib/backup/restore-preview";
import { readStaticBackupSource } from "../lib/backup/static-source";

const firstBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=", "base64"));
const nextBytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
async function archive(bytes: Uint8Array, changed = false) {
  const data = backupData(); data.chat.sessions[0].backgroundImage = "same-chat-image";
  if (changed) {
    data.worldbooks!.books[0].name = "Changed world";
    data.presence!.characters[0].lastMessageAt!++;
  }
  const f = await packageFixture(data), path = "assets/chat/0.bin";
  f.manifest.assets.push({ domain: "chat", id: "same-chat-image", path, bytes: bytes.length, sha256: await sha256(bytes), mime: "image/png", createdAt: 1 });
  f.files.set(path, bytes);
  return { manifestJson: JSON.stringify(f.manifest), files: f.files };
}
async function setup() {
  assert.equal(firstBytes.length, nextBytes.length, "regression must use equal-sized images");
  const raw = new Map<string, string>();
  const device: RestoreDevice = { indexedDB: new IDBFactory(), localStorage: {
    getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); },
  } };
  const locks = lockOrigin().client(), a = await archive(firstBytes), b = await archive(nextBytes, true);
  await restoreIntoEmpty(a.manifestJson, a.files, device, locks);
  return { device, raw, locks, b, confirmed: await previewRestore(b.manifestJson, b.files, device, locks) };
}
async function imageBytes(device: RestoreDevice) {
  const row = (await readStaticBackupSource(device)).chat.assets[0] as { blob: Blob };
  return new Uint8Array(await row.blob.arrayBuffer());
}

test("both image unit digests distinguish equal metadata with different bytes", async () => {
  const { device } = await setup(), snapshot = await readStaticBackupSource(device);
  const row = snapshot.chat.assets[0] as { id: string; blob: Blob; createdAt: number };
  const first = { ...snapshot, appearanceAssets: [row] };
  const other = { ...row, blob: new Blob([nextBytes], { type: row.blob.type }) };
  const next = { ...snapshot, chat: { ...snapshot.chat, assets: [other] }, appearanceAssets: [other] };
  const x = await digestUnits(first), y = await digestUnits(next);
  assert.notEqual(x.chat, y.chat); assert.notEqual(x.appearanceAssets, y.appearanceAssets);
});

test("a byte-only device change invalidates the confirmed restore preview", async () => {
  const { device, locks, b, confirmed } = await setup(), snapshot = await readStaticBackupSource(device);
  await createUnitWriters(device).chat.write({ ...snapshot, chat: { ...snapshot.chat, assets: snapshot.chat.assets.map((row) => ({
    ...(row as object), blob: new Blob([nextBytes], { type: "image/png" }),
  })) } });
  assert.equal(restorePreviewChanged(confirmed, await previewRestore(b.manifestJson, b.files, device, locks)), true);
});

for (const action of ["resume", "rollback"] as const) {
  test(`same-metadata image replace can ${action} after interrupted rollback`, async () => {
    const { device, raw, locks, b, confirmed } = await setup(), writers = createUnitWriters(device);
    let writes = 0;
    await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: { ...writers,
      presence: { ...writers.presence, write: async () => { throw new Error("injected"); } },
      worldbooks: { ...writers.worldbooks, write: async (snapshot) => {
        if (++writes > 1) throw new Error("interrupted rollback");
        await writers.worldbooks.write(snapshot);
      } },
    } }), (error) => error instanceof RestoreError && error.code === "rollback-failed");
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), true);
    await recoverRestore(action, device, lockOrigin().client(), action === "resume" ? b : null);
    assert.deepEqual(await imageBytes(device), action === "resume" ? nextBytes : firstBytes);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  });
}

test("a writer silently keeping the old equal-sized image is verified and rolled back", async () => {
  const { device, raw, locks, b, confirmed } = await setup(), writers = createUnitWriters(device);
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: { ...writers,
    chat: { ...writers.chat, write: async (snapshot) => writers.chat.write({ ...snapshot, chat: { ...snapshot.chat,
      assets: snapshot.chat.assets.map((row) => ({ ...(row as object), blob: new Blob([firstBytes], { type: "image/png" }) })),
    } }) },
  } }), (error) => error instanceof RestoreError && error.code === "verify-failed-rolled-back" && error.journal === "none");
  assert.deepEqual(await imageBytes(device), firstBytes);
  assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
});

for (const action of ["resume", "rollback"] as const) {
  test(`an already-persisted journal without the byte-hash marker can still ${action}`, async () => {
    const { device, raw, locks, b } = await setup(), previous = await readStaticBackupSource(device);
    const manifest = JSON.parse(b.manifestJson); manifest.assets[0].createdAt = 2;
    const pendingPack = { ...b, manifestJson: JSON.stringify(manifest) };
    const target = snapshotFromBackup(await validateBackupPackage(pendingPack.manifestJson, pendingPack.files), pendingPack.files);
    await createSafetyCopyStore(device.indexedDB).save("older-journal", previous, 1);
    raw.set(RESTORE_JOURNAL_KEY, JSON.stringify({ version: 1, kind: "replace", restoreId: "older-journal",
      backupId: manifest.backupId, startedAt: 1, previous: await digestUnits(previous, false), expected: await digestUnits(target, false) }));
    await createUnitWriters(device).chat.write(target);
    await recoverRestore(action, device, locks, action === "resume" ? pendingPack : null);
    assert.deepEqual(await imageBytes(device), action === "resume" ? nextBytes : firstBytes);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  });
}

test("image read failures fail closed without exposing the underlying error", async () => {
  class UnreadableImage extends Blob { override arrayBuffer(): Promise<ArrayBuffer> { return Promise.reject(new Error("SIMULATED_PRIVATE_VALUE")); } }
  await assert.rejects(digestImageRows([{ id: "simulated", blob: new UnreadableImage([firstBytes]) }]),
    (error) => error instanceof BackupValidationError && error.code === "asset-read-failed" && !error.message.includes("SIMULATED_PRIVATE_VALUE"));
});

test("image hashing retains at most one image read at a time", async () => {
  let active = 0, peak = 0;
  class ObservedImage extends Blob { override async arrayBuffer(): Promise<ArrayBuffer> {
    active++; peak = Math.max(peak, active);
    try { await new Promise<void>((resolve) => setImmediate(resolve)); return await super.arrayBuffer(); }
    finally { active--; }
  } }
  const rows = Array.from({ length: 4 }, (_, id) => ({ id: String(id), blob: new ObservedImage([firstBytes], { type: "image/png" }) }));
  const results = await digestImageRows(rows);
  assert.equal(results.length, 4); assert.equal(peak, 1); assert.equal(active, 0);
});

test("pre-journal image hash failure leaves no safety copy, journal or changed data", async () => {
  const { device, raw, locks, b, confirmed } = await setup(), original = new Map(raw), safety = createSafetyCopyStore(device.indexedDB);
  const subtle = globalThis.crypto.subtle, native = subtle.digest;
  let matchingReads = 0;
  subtle.digest = async (algorithm, data) => {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    if (Buffer.from(bytes).equals(Buffer.from(nextBytes)) && ++matchingReads === 2) throw new Error("SIMULATED_PRIVATE_HASH_FAILURE");
    return native.call(subtle, algorithm, data);
  };
  try {
    await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, safety, newId: () => "pre-journal-test" }),
      (error) => error instanceof BackupValidationError && error.code === "hash-unavailable");
  } finally { subtle.digest = native; }
  assert.equal(matchingReads, 2); assert.deepEqual(raw, original);
  assert.equal(await safety.load("pre-journal-test"), null);
  assert.deepEqual(await imageBytes(device), firstBytes);
});
