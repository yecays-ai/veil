import assert from "node:assert/strict";
import test from "node:test";
import { BackupCoordinator, BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { cleanupCharacterData, deleteCharacterWithData, type CleanupDeps } from "../lib/character-deletion";
import { acquireGenerationLock } from "../lib/chat/generation-lock";
import { lockOrigin } from "./generation-lock-fixture";
import { A, B, buildWorld } from "./character-deletion-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const origin = lockOrigin(), counts = { shared: 0 };
  const manager = { request: ((...args: Parameters<LockManager["request"]>) => {
    if (args[0] === BACKUP_LOCK_NAME && (args[1] as LockOptions).mode === "shared") counts.shared++;
    return origin.client().request(...args);
  }) as BackupLockManager["request"] };
  const gate = createPersistenceWriteGate(() => manager);
  const world = await buildWorld({ gate });
  counts.shared = 0;
  return { world, gate, manager, counts };
}

// A snapshot taken at any moment must see the Character either wholly present or wholly gone.
const mentions = async (world: Awaited<ReturnType<typeof fixture>>["world"]) =>
  JSON.stringify(await world.snapshot()).includes(A);

test("Character deletion holds one shared lease from the Foundation delete through the last cleanup step", async () => {
  const { world, gate, manager, counts } = await fixture();
  const entered = deferred(), finish = deferred();
  const paused: CleanupDeps = { ...world.deps, bindings: { ...world.deps.bindings, async update(update, scope) {
    entered.resolve(); await finish.promise; return world.deps.bindings.update(update, scope);
  } } };
  const deleting = deleteCharacterWithData({ characterId: A, commitFoundation: world.commitFoundation, deps: paused, writeGate: gate });
  await entered.promise;
  let seen: boolean | undefined;
  const capture = new BackupCoordinator(manager).withSnapshot(async () => { seen = await mentions(world); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen, undefined, "a queued snapshot waits while the Foundation delete is done but cleanup is not");
  assert.equal(counts.shared, 1, "Foundation delete and all six cleanup steps share one outer lease");
  finish.resolve();
  const report = await deleting; await capture;
  assert.deepEqual(report.failed, []);
  assert.equal(seen, false, "the snapshot sees no trace of the Character");
  assert.equal(counts.shared, 1);
});

test("a failing cleanup step releases the lease, is reported, and leaves the other steps done", async () => {
  const { world, gate, manager, counts } = await fixture();
  const failing: CleanupDeps = { ...world.deps, presence: { ...world.deps.presence, update: () => Promise.reject(new Error("presence down")) } };
  const report = await deleteCharacterWithData({ characterId: A, commitFoundation: world.commitFoundation, deps: failing, writeGate: gate });
  assert.deepEqual(report.failed, [{ step: "presence", message: "presence down" }]);
  assert.equal(report.completed.length, 5);
  assert.equal(counts.shared, 1);
  // The lease is gone: an exclusive snapshot can run. The known leftover (presence data) is recorded, not hidden.
  let ran = false;
  await new BackupCoordinator(manager).withSnapshot(async () => { ran = true; });
  assert.equal(ran, true);
  assert.equal((await world.presenceStore.load()).characters.some((c) => c.characterId === A), true);
  // Retrying the cleanup also holds a single lease and clears the leftover.
  counts.shared = 0;
  assert.deepEqual((await cleanupCharacterData(A, world.deps, gate)).failed, []);
  assert.equal(counts.shared, 1);
  assert.equal(await mentions(world), false);
});

test("a failed Foundation delete changes nothing, passes the original error on and releases the lease", async () => {
  const { world, gate, manager } = await fixture();
  const before = JSON.stringify(await world.snapshot());
  const failure = new Error("Simulated Foundation failure");
  await assert.rejects(deleteCharacterWithData({ characterId: A, commitFoundation: () => Promise.reject(failure), deps: world.deps, writeGate: gate }),
    (error) => error === failure);
  let ran = false;
  await new BackupCoordinator(manager).withSnapshot(async () => { ran = true; });
  assert.equal(ran, true);
  assert.equal(JSON.stringify(await world.snapshot()), before);
  assert.equal(before.includes(B), true);
});

test("a live reply's session lock never blocks the deletion or a queued snapshot (the session lock is try-only)", async () => {
  const { world, gate, manager } = await fixture();
  // Lock order is backup lease -> session lock; the session lock is never waited for, so no cycle can form
  // with a reply that holds it and is itself waiting for the lease behind a queued snapshot.
  const reply = await acquireGenerationLock(world.factory, world.ids.sessionA.id, undefined);
  assert.ok(reply);
  const entered = deferred(), finish = deferred();
  const paused: CleanupDeps = { ...world.deps, bindings: { ...world.deps.bindings, async update(update, scope) {
    entered.resolve(); await finish.promise; return world.deps.bindings.update(update, scope);
  } } };
  const deleting = deleteCharacterWithData({ characterId: A, commitFoundation: world.commitFoundation, deps: paused, writeGate: gate });
  await entered.promise;
  let ran = false;
  const capture = new BackupCoordinator(manager).withSnapshot(async () => { ran = true; });
  finish.resolve();
  const report = await deleting; await capture;
  assert.equal(ran, true);
  assert.deepEqual(report.failed.map((item) => item.step), ["conversation"]);
  assert.match(report.failed[0].message, /reply is in progress/);
  await reply!();
  assert.deepEqual((await cleanupCharacterData(A, world.deps, gate)).failed, [], "retry completes once the reply has ended");
});
