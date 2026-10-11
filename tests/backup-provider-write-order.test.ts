import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_LOCK_NAME, BackupCoordinator, type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate, withPersistenceWriteScope, type PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { runQueuedWrite } from "../lib/backup/write-queue";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const within = <T,>(work: Promise<T>, ms = 300) => Promise.race([work, new Promise<"stuck">((r) => setTimeout(() => r("stuck"), ms))]);

function fixture() {
  const origin = lockOrigin(), counts = { shared: 0 };
  const manager: BackupLockManager = { request: ((...args: Parameters<LockManager["request"]>) => {
    if (args[0] === BACKUP_LOCK_NAME && (args[1] as LockOptions).mode === "shared") counts.shared++;
    return origin.client().request(...args);
  }) as BackupLockManager["request"] };
  const gate: PersistenceWriteGate = createPersistenceWriteGate(() => manager);
  const queue = { current: Promise.resolve() as Promise<unknown> };
  return { gate, manager, counts, queue, snapshot: () => new BackupCoordinator(manager).withSnapshot(async () => "snapshot") };
}

// The scenario that used to deadlock: an earlier unscoped commit is still waiting in the Provider queue
// when a Character deletion (scoped) joins it and an exclusive snapshot is requested.
async function scenario(commit: (f: ReturnType<typeof fixture>, job: () => Promise<string>, scope?: Parameters<typeof runQueuedWrite>[2]) => Promise<string>) {
  const f = fixture(), slow = deferred(), order: string[] = [];
  const c0 = commit(f, async () => { order.push("c0"); await slow.promise; return "c0"; });
  await settle();
  const c1 = commit(f, async () => { order.push("c1"); return "c1"; });
  let scopedStarted = false;
  const release = deferred();
  const deletion = withPersistenceWriteScope(f.gate, async (scope) => {
    scopedStarted = true; await release.promise;
    return commit(f, async () => { order.push("delete"); return "delete"; }, scope);
  });
  await settle();
  assert.ok(scopedStarted);
  let snapshotDone = false;
  const snapshot = f.snapshot().then(() => { snapshotDone = true; });
  await settle();
  release.resolve(); slow.resolve();
  return { f, order, finished: within(Promise.all([c0, c1, deletion, snapshot])), snapshotDone: () => snapshotDone };
}

test("lease before queue: an unscoped commit, a scoped deletion and a queued snapshot all finish, in call order", async () => {
  const run = await scenario((f, job, scope) => runQueuedWrite(f.queue, job, scope, f.gate));
  assert.notEqual(await run.finished, "stuck", "no wait cycle");
  assert.deepEqual(run.order, ["c0", "c1", "delete"]);
  assert.equal(run.snapshotDone(), true);
});

test("control: the old order (queue first, lease inside) is the cycle this unit removes", async () => {
  const cancel = new AbortController();
  const run = await scenario((f, job, scope) => {
    const operation = f.queue.current.then(() => scope ? job() : withPersistenceWriteScope(f.gate, job, { signal: cancel.signal }));
    f.queue.current = operation.then(() => {}, () => {});
    return operation;
  });
  assert.equal(await run.finished, "stuck", "the legacy order does not finish within the window: the cycle is visible");
  // Cancel the stuck lease request so nothing outlives the test (it would otherwise wait for the 30 s lock timeout).
  cancel.abort(); await settle(); await settle();
});

test("a scoped caller adds no second shared lease; an unscoped caller takes exactly one", async () => {
  const f = fixture();
  await runQueuedWrite(f.queue, async () => "x", undefined, f.gate);
  assert.equal(f.counts.shared, 1);
  f.counts.shared = 0;
  await withPersistenceWriteScope(f.gate, (scope) => runQueuedWrite(f.queue, async () => "y", scope, f.gate));
  assert.equal(f.counts.shared, 1, "only the caller's own lease");
});

test("commits stay serialized in request order, and a failure neither blocks the next commit nor keeps the lease", async () => {
  const f = fixture(), order: string[] = [], gate = deferred();
  const first = runQueuedWrite(f.queue, async () => { await gate.promise; order.push("first"); throw new Error("first failed"); }, undefined, f.gate);
  const second = runQueuedWrite(f.queue, async () => { order.push("second"); return "second"; }, undefined, f.gate);
  const third = runQueuedWrite(f.queue, async () => { order.push("third"); return "third"; }, undefined, f.gate);
  const failure = first.then(() => "ok", (error: Error) => error.message);
  await settle(); assert.deepEqual(order, [], "later commits wait for the first");
  gate.resolve();
  assert.equal(await failure, "first failed");
  assert.deepEqual([await second, await third], ["second", "third"]);
  assert.deepEqual(order, ["first", "second", "third"]);
  assert.equal(await within(f.snapshot()), "snapshot", "every lease was released");
});
