import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { recordClearIntent } from "../lib/memory/lifecycle";
import { MemoryStorage } from "../lib/memory/storage";
import { MAX_CLEAR_FAILURES, resumeStartupClears, type StartupClearDeps } from "../lib/memory/startup";

const passthrough: PersistenceWriteGate = { withWrite: (operation) => operation() };
function setup() {
  const factory = new IDBFactory();
  const clock = { now: 100 };
  const storage = new MemoryStorage(() => factory, () => clock.now, passthrough);
  const chat = { alive: new Set(["c1"]) as ReadonlySet<string> | null, sessions: new Map<string, number>(), reads: 0 };
  const deps: StartupClearDeps = {
    aliveCharacters: async () => chat.alive,
    sessionIds: async () => new Set(chat.sessions.keys()),
    countMessages: async (id) => { chat.reads++; return chat.sessions.get(id) ?? 0; },
  };
  const add = (id: string, session: string, characterId = "c1", extra = {}) => storage.applyChange(characterId, "add", { put: [
    { id, characterId, kind: "fact", text: `fact ${id}`, subject: "user", status: "active" as const, origin: "auto" as const,
      sources: [{ sessionId: session, messageId: "m1" }], lineage: {}, ...extra }] });
  const ids = async (characterId = "c1") => (await storage.listMemories(characterId)).map((row) => row.id).sort();
  return { storage, clock, chat, deps, add, ids };
}

test("an interrupted delete is finished at startup, and a second startup changes nothing", async () => {
  const { storage, deps, add, ids } = setup();
  await add("old", "A"); await add("keep", "B");
  await recordClearIntent(storage, "c1", "A"); // crashed before cleanup; the session is already gone
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 1, cancelled: 0, deferred: 0, failed: 0 });
  assert.deepEqual(await ids(), ["keep"]);
  assert.deepEqual(await storage.listCursors("c1"), []);
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 0, cancelled: 0, deferred: 0, failed: 0 });
  assert.deepEqual(await ids(), ["keep"]);
});

test("a cleared session that is empty is finished; one that still has messages cancels the intent and keeps Memory", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("m", "A");
  chat.sessions.set("A", 0);
  await recordClearIntent(storage, "c1", "A");
  assert.equal((await resumeStartupClears(storage, deps)).completed, 1);
  assert.deepEqual(await ids(), []);

  await add("m2", "B"); chat.sessions.set("B", 4); // the chat operation had failed
  await recordClearIntent(storage, "c1", "B");
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 0, cancelled: 1, deferred: 0, failed: 0 });
  assert.deepEqual(await ids(), ["m2"]);
  assert.deepEqual(await storage.listCursors("c1"), [], "no pending intent is left");
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 0, cancelled: 0, deferred: 0, failed: 0 });
});

test("memory created after the intent for a recreated session of the same id is never deleted", async () => {
  const { storage, clock, deps, add, ids } = setup();
  await add("before", "character:c1");
  clock.now = 200; await recordClearIntent(storage, "c1", "character:c1");
  clock.now = 300; await add("after", "character:c1"); // new conversation, same deterministic id, then emptied again
  await resumeStartupClears(storage, deps);
  assert.deepEqual(await ids(), ["after"]);
});

test("a re-created Character with a new id keeps its Memory while the old id's Memory goes", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("old", "A", "c-old"); await add("new", "A2", "c-new");
  await recordClearIntent(storage, "c-old", "A");
  chat.alive = new Set(["c-new"]);
  await resumeStartupClears(storage, deps);
  assert.deepEqual([await ids("c-old"), await ids("c-new")], [[], ["new"]]);
});

test("a cleanup failure keeps the intent, counts, retries next startup, and stops after the bound", async () => {
  const { storage, deps, add, ids } = setup();
  await add("m", "A");
  await recordClearIntent(storage, "c1", "A");
  const real = storage.transaction.bind(storage);
  let failing = true;
  storage.transaction = ((mode: IDBTransactionMode, run: never, scope?: never) =>
    failing && mode === "readwrite" ? Promise.reject(new Error("down")) : real(mode, run, scope)) as never;
  const first = await resumeStartupClears(storage, deps);
  assert.equal(first.failed, 1);
  failing = false; // the failure counter itself could not be written while storage was down
  assert.deepEqual(await ids(), ["m"]);
  assert.ok((await storage.listCursors("c1"))[0].clearRequestedAt !== undefined, "intent kept");
  await storage.saveCursor("c1", "A", { failureCount: MAX_CLEAR_FAILURES, failureReason: "clear-cleanup-failed" });
  assert.equal((await resumeStartupClears(storage, deps)).deferred, 1, "bounded: not retried forever");
  await storage.saveCursor("c1", "A", { failureCount: 1 });
  assert.equal((await resumeStartupClears(storage, deps)).completed, 1);
  assert.deepEqual(await ids(), []);
});

test("a failure is recorded in the cursor and unreadable chat data changes nothing", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("m", "A");
  await recordClearIntent(storage, "c1", "A");
  chat.alive = null;
  assert.equal((await resumeStartupClears(storage, deps)).deferred, 1);
  const broken: StartupClearDeps = { ...deps, sessionIds: async () => { throw new Error("chat down"); } };
  chat.alive = new Set(["c1"]);
  assert.equal((await resumeStartupClears(storage, broken)).deferred, 1);
  assert.deepEqual(await ids(), ["m"]);
  const real = storage.transaction.bind(storage);
  let armed = true;
  storage.transaction = ((mode: IDBTransactionMode, run: never, scope?: never) => {
    // Fail only the clear transaction (the first readwrite); the failure bookkeeping write then succeeds.
    if (mode === "readwrite" && armed) { armed = false; return Promise.reject(new Error("down")); }
    return real(mode, run, scope);
  }) as never;
  assert.equal((await resumeStartupClears(storage, deps)).failed, 1);
  const [cursor] = await storage.listCursors("c1");
  assert.equal(cursor.failureCount, 1); assert.equal(cursor.failureReason, "clear-cleanup-failed");
  assert.ok(cursor.clearRequestedAt !== undefined);
});

test("with no pending intent nothing is read beyond the cursor list, and an aborted run does nothing", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("m", "A");
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 0, cancelled: 0, deferred: 0, failed: 0 });
  assert.equal(chat.reads, 0);
  await recordClearIntent(storage, "c1", "A");
  const controller = new AbortController(); controller.abort();
  assert.equal((await resumeStartupClears(storage, deps, controller.signal)).completed, 0);
  assert.deepEqual(await ids(), ["m"]);
});
