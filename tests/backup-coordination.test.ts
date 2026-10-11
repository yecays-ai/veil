import assert from "node:assert/strict";
import test from "node:test";
import { BackupCoordinator, BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { BackupValidationError } from "../lib/backup/format";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

/** Simulated shared browser lock manager; never touches navigator or real VEIL storage. */
function manager(): BackupLockManager {
  type Entry = { mode: LockMode; start: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort: () => void };
  const queue: Entry[] = [];
  let active = 0, exclusive = false;
  function drain() {
    while (queue.length && !exclusive) {
      const entry = queue[0];
      if (entry.mode === "exclusive" && active) return;
      queue.shift(); entry.signal?.removeEventListener("abort", entry.abort);
      active++; exclusive = entry.mode === "exclusive"; entry.start();
    }
  }
  return { request: ((name: string, options: LockOptions, callback: (lock: Lock) => Promise<unknown>) => {
    assert.equal(name, BACKUP_LOCK_NAME);
    assert(options.signal);
    return new Promise<unknown>((resolve, reject) => {
      const entry: Entry = { mode: options.mode ?? "exclusive", signal: options.signal, reject,
        abort() { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(new Error("Simulated abort")); drain(); },
        start() {
          Promise.resolve().then(() => callback({ name, mode: entry.mode } as Lock)).then(resolve, reject).finally(() => {
            active--; exclusive = false; drain();
          });
        } };
      if (options.signal!.aborted) { reject(new Error("Simulated abort")); return; }
      options.signal!.addEventListener("abort", entry.abort, { once: true });
      queue.push(entry); drain();
    });
  }) as BackupLockManager["request"] };
}

test("a snapshot waits for the entire cross-domain write and blocks later writes in another coordinator", async () => {
  const locks = manager(), first = new BackupCoordinator(locks), second = new BackupCoordinator(locks);
  const writeReady = deferred(), finishWrite = deferred(), snapshotReady = deferred(), finishSnapshot = deferred();
  const events: string[] = [];
  const writing = first.withWrite(async () => {
    events.push("domain-a"); writeReady.resolve(); await finishWrite.promise; events.push("domain-b");
  });
  await writeReady.promise;
  const capture = second.withSnapshot(async () => {
    assert.deepEqual(events, ["domain-a", "domain-b"]);
    events.push("snapshot"); snapshotReady.resolve(); await finishSnapshot.promise; return "package";
  });
  const later = first.withWrite(async () => { events.push("later-write"); });
  assert.deepEqual(events, ["domain-a"]);
  finishWrite.resolve(); await writing; await snapshotReady.promise;
  assert.deepEqual(events, ["domain-a", "domain-b", "snapshot"]);
  finishSnapshot.resolve(); assert.equal(await capture, "package"); await later;
  assert.deepEqual(events, ["domain-a", "domain-b", "snapshot", "later-write"]);
});

test("snapshot waits for all concurrent shared writers and serializes other snapshots", async () => {
  const coordinator = new BackupCoordinator(manager()), gate = deferred(), both = deferred();
  let count = 0;
  const write = () => coordinator.withWrite(async () => { if (++count === 2) both.resolve(); await gate.promise; count--; });
  const writers = [write(), write()]; await both.promise;
  const capture = coordinator.withSnapshot(async () => { assert.equal(count, 0); return "first"; });
  const next = coordinator.withSnapshot(async () => "second");
  gate.resolve(); await Promise.all(writers); assert.deepEqual(await Promise.all([capture, next]), ["first", "second"]);
});

test("callback failure releases the lock, preserves failure, and permits another snapshot", async () => {
  const coordinator = new BackupCoordinator(manager()), failure = new Error("simulated write failure");
  await assert.rejects(coordinator.withWrite(async () => { throw failure; }), (error) => error === failure);
  await assert.rejects(coordinator.withSnapshot(async () => { throw failure; }), (error) => error === failure);
  assert.equal(await coordinator.withSnapshot(async () => "ok"), "ok");
});

test("cancelled and timed-out queued captures never execute later or release an active write", async () => {
  const coordinator = new BackupCoordinator(manager()), ready = deferred(), finish = deferred();
  const writing = coordinator.withWrite(async () => { ready.resolve(); await finish.promise; });
  await ready.promise;
  let calls = 0;
  const operation = async () => { calls++; };
  const abort = new AbortController();
  const cancelled = assert.rejects(coordinator.withSnapshot(operation, { signal: abort.signal }),
    (error: unknown) => error instanceof BackupValidationError && error.code === "coordination-cancelled");
  abort.abort(); await cancelled;
  await assert.rejects(coordinator.withSnapshot(operation, { waitMs: 5 }),
    (error: unknown) => error instanceof BackupValidationError && error.code === "coordination-timeout");
  assert.equal(calls, 0); finish.resolve(); await writing;
  await coordinator.withSnapshot(operation); assert.equal(calls, 1);
});

test("cancellation after acquisition cannot prematurely release an unfinished capture", async () => {
  const coordinator = new BackupCoordinator(manager()), ready = deferred(), finish = deferred(), abort = new AbortController();
  let written = false;
  const capture = coordinator.withSnapshot(async () => { ready.resolve(); await finish.promise; }, { signal: abort.signal, waitMs: 5 });
  await ready.promise; abort.abort();
  const writing = coordinator.withWrite(async () => { written = true; });
  await new Promise((resolve) => setTimeout(resolve, 10)); assert.equal(written, false);
  finish.resolve(); await capture; await writing; assert.equal(written, true);
});

test("unsupported or denied locks and invalid options fail closed without calling the operation", async () => {
  let calls = 0;
  const operation = async () => { calls++; };
  const denied = { request: (() => Promise.reject(new Error("SIMULATED_SECRET"))) as BackupLockManager["request"] };
  for (const locks of [undefined, denied]) await assert.rejects(new BackupCoordinator(locks).withSnapshot(operation),
    (error: unknown) => error instanceof BackupValidationError && error.code === "coordination-unavailable" && !error.message.includes("SIMULATED_SECRET"));
  const coordinator = new BackupCoordinator(manager()), abort = new AbortController(); abort.abort();
  await assert.rejects(coordinator.withWrite(operation, { signal: abort.signal }),
    (error: unknown) => error instanceof BackupValidationError && error.code === "coordination-cancelled");
  for (const waitMs of [0, -1, NaN, Infinity, 1.5, 300_001]) await assert.rejects(coordinator.withSnapshot(operation, { waitMs }),
    (error: unknown) => error instanceof BackupValidationError && error.code === "invalid-lock-options");
  assert.equal(calls, 0);
});
