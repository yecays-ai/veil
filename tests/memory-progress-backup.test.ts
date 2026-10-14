import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { backupData, packageFixture } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, digestUnits, replaceWithBackup, restoreIntoEmpty, snapshotFromBackup, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { memoryBatchActive, validMemoryProgress } from "../lib/memory/progress-types";
import type { MemoryBatchState } from "../lib/memory/progress-types";
import { lockOrigin } from "./generation-lock-fixture";

const data = (state: MemoryBatchState = "ready") => {
  const data = backupData();
  data.chat.sessions[0].memorySequence = { epoch: "epoch", nextSeq: 3 };
  data.chat.messages[0].memorySequence = { epoch: "epoch", seq: 1 };
  data.chat.messages[1].memorySequence = { epoch: "epoch", seq: 2 };
  data.memory.cursors[0].extraction = { epoch: "epoch", incarnation: "old-nonce", throughSeq: 0, completed: [], batches: [
    { id: "batch", fromSeq: 1, toSeq: 1, state, attempts: state === "ready" || state === "too-large" ? 0 : 1,
      sources: [{ messageId: "user-test", seq: 1, hash: "a".repeat(64) }], candidates: [],
      ...(memoryBatchActive({ state }) ? { ownerId: "owner", attemptId: "attempt" } : {}) },
  ] };
  return data;
};
function device() {
  const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => { raw.set(key, value); }, removeItem: (key: string) => { raw.delete(key); } } } satisfies RestoreDevice;
}

for (const state of ["ready", "failed", "uncertain", "too-large"] as const) test(`${state} progress roundtrips with fresh restore nonce and unchanged logical digest`, async () => {
  const f = await packageFixture(data(state)), manifest = JSON.stringify(f.manifest), validated = await validateBackupPackage(manifest, f.files);
  const d = device(), locks = lockOrigin().client();
  await restoreIntoEmpty(manifest, f.files, d, locks);
  const snapshot = await readStaticBackupSource(d), cursor = snapshot.memory.cursors[0] as typeof validated.data.memory.cursors[number];
  assert.notEqual(cursor.extraction?.incarnation, "old-nonce"); assert.equal(cursor.extraction?.batches[0].state, state);
  assert.deepEqual(await digestUnits(snapshot), await digestUnits(snapshotFromBackup(validated, f.files)));
  // Identical logical replacement still invalidates capabilities; no digest-skip bypass.
  const nonce = cursor.extraction!.incarnation, preview = await previewRestore(manifest, f.files, d, locks);
  await replaceWithBackup(manifest, f.files, d, locks, { confirmed: preview });
  const second = (await readStaticBackupSource(d)).memory.cursors[0] as typeof cursor;
  assert.notEqual(second.extraction?.incarnation, nonce);
});

for (const state of ["claimed", "in-flight", "commit-pending"] as const) test(`a ${state} package is refused and a local ${state} batch blocks replace`, async () => {
  const active = await packageFixture(data(state));
  await assert.rejects(validateBackupPackage(JSON.stringify(active.manifest), active.files), /memory-batch-active/);
  const base = await packageFixture(), manifest = JSON.stringify(base.manifest), valid = await validateBackupPackage(manifest, base.files);
  const d = device(), locks = lockOrigin().client(); await restoreIntoEmpty(manifest, base.files, d, locks);
  const snapshot = snapshotFromBackup(valid, base.files), activeData = data(state);
  snapshot.chat = { ...snapshot.chat, sessions: activeData.chat.sessions, messages: activeData.chat.messages };
  snapshot.memory = activeData.memory;
  await createUnitWriters(d).chat.write(snapshot); await createUnitWriters(d).memory.write(snapshot);
  const preview = await previewRestore(manifest, base.files, d, locks);
  assert.equal(preview.mode, "blocked"); assert(preview.blockers.some((b) => b.code === "local-memory-batch-active"));
});

test("backup rejects duplicate sequence, wrong epoch, overlap, invented fields and cross Character batch candidates", async () => {
  const mutations = [
    (d: ReturnType<typeof data>) => { d.chat.messages[1].memorySequence!.seq = 1; },
    (d: ReturnType<typeof data>) => { d.memory.cursors[0].extraction!.epoch = "wrong"; },
    (d: ReturnType<typeof data>) => { d.memory.cursors[0].extraction!.batches.push({ ...d.memory.cursors[0].extraction!.batches[0], id: "overlap" }); },
    (d: ReturnType<typeof data>) => { Object.assign(d.memory.cursors[0].extraction!, { rawChatText: "must not persist" }); },
    (d: ReturnType<typeof data>) => { d.memory.cursors[0].extraction!.batches[0].sources[0].seq = 2; },
    (d: ReturnType<typeof data>) => { Object.assign(d.memory.cursors[0].extraction!.batches[0], { sizeAttempts: -1 }); },
    (d: ReturnType<typeof data>) => { Object.assign(d.memory.cursors[0].extraction!.batches[0], { budgetKey: "" }); },
    (d: ReturnType<typeof data>) => {
      d.foundation!.characters.push({ ...d.foundation!.characters[0], characterId: "other" });
      d.memory.memories.push({ ...d.memory.memories[0], id: "other-memory", characterId: "other", sources: [] });
      d.memory.cursors[0].extraction!.batches[0].candidates.push({ id: "other-memory", updatedAt: 1, hash: "a".repeat(64) });
    },
  ];
  for (const mutate of mutations) { const d = data(); mutate(d); const f = await packageFixture(d); await assert.rejects(validateBackupPackage(JSON.stringify(f.manifest), f.files)); }
  assert.equal(validMemoryProgress({ ...data().memory.cursors[0].extraction!, throughSeq: -1 }), false);
});

test("too-large size history (sizeAttempts, budgetKey) roundtrips through backup and restore unchanged", async () => {
  const source = data("too-large");
  Object.assign(source.memory.cursors[0].extraction!.batches[0], { sizeAttempts: 2, budgetKey: "32000:abc123" });
  const f = await packageFixture(source), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(), locks = lockOrigin().client();
  await restoreIntoEmpty(manifest, f.files, d, locks);
  const batch = ((await readStaticBackupSource(d)).memory.cursors[0] as { extraction: { batches: { state: string; sizeAttempts?: number; budgetKey?: string }[] } }).extraction.batches[0];
  assert.equal(batch.state, "too-large"); assert.equal(batch.sizeAttempts, 2); assert.equal(batch.budgetKey, "32000:abc123");
  assert.equal(validMemoryProgress(source.memory.cursors[0].extraction), true);
});

test("rollback after a landed Memory write preserves logical progress but invalidates old capabilities", async () => {
  const initial = await packageFixture(data()), manifest = JSON.stringify(initial.manifest), d = device(), locks = lockOrigin().client();
  await restoreIntoEmpty(manifest, initial.files, d, locks);
  const before = await readStaticBackupSource(d), nonce = (before.memory.cursors[0] as { extraction: { incarnation: string } }).extraction.incarnation;
  const next = await packageFixture(data("failed")), nextManifest = JSON.stringify(next.manifest), preview = await previewRestore(nextManifest, next.files, d, locks);
  const real = createUnitWriters(d), writers = { ...real, memory: { ...real.memory, write: async (snapshot: Parameters<typeof real.memory.write>[0]) => {
    await real.memory.write(snapshot); throw new Error("landed-write-failure");
  } } };
  await assert.rejects(replaceWithBackup(nextManifest, next.files, d, locks, { confirmed: preview, writers }));
  // Use the recovery executor after the deliberately failing rollback writer retained its journal.
  const { recoverRestore } = await import("../lib/backup/restore"); await recoverRestore("rollback", d, locks, null);
  const after = await readStaticBackupSource(d);
  assert.deepEqual(await digestUnits(after), await digestUnits(before));
  assert.notEqual((after.memory.cursors[0] as { extraction: { incarnation: string } }).extraction.incarnation, nonce);
});
