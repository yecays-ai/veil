import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { readAliveCharacters } from "../lib/memory/browser";
import { cancelClearIntent, recordClearIntent } from "../lib/memory/lifecycle";
import { MemoryStorage } from "../lib/memory/storage";
import { resumeStartupClears, type StartupClearDeps } from "../lib/memory/startup";

const passthrough: PersistenceWriteGate = { withWrite: (operation) => operation(), withExclusiveWrite: (operation) => operation() };
function setup() {
  const factory = new IDBFactory();
  const storage = new MemoryStorage(() => factory, () => 100, passthrough);
  /** `sessions` maps a session id to the ids of the messages it currently holds. */
  const chat = { alive: new Set(["c1"]) as ReadonlySet<string> | null, sessions: new Map<string, Set<string>>(), reads: 0 };
  const deps: StartupClearDeps = {
    aliveCharacters: async () => chat.alive,
    sessionIds: async () => new Set(chat.sessions.keys()),
    countMessages: async (id) => { chat.reads++; return chat.sessions.get(id)?.size ?? 0; },
    existingMessageIds: async (id, ids) => new Set(ids.filter((item) => chat.sessions.get(id)?.has(item))),
  };
  const add = (id: string, session: string, characterId = "c1", messageId = "m1") => storage.applyChange(characterId, "add", { put: [
    { id, characterId, kind: "fact", text: `fact ${id}`, subject: "user", status: "active" as const, origin: "auto" as const,
      sources: [{ sessionId: session, messageId }], lineage: {} }] });
  const ids = async (characterId = "c1") => (await storage.listMemories(characterId)).map((row) => row.id).sort();
  return { storage, chat, deps, add, ids };
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

test("a failed clear is withdrawn, but a clear followed by new messages cleans old sources and keeps new ones", async () => {
  const { storage, chat, deps, add, ids } = setup();
  // Failed clear: the targeted message is still there.
  await add("kept", "A", "c1", "old-1");
  chat.sessions.set("A", new Set(["old-1", "old-2"]));
  await recordClearIntent(storage, "c1", "A");
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 0, cancelled: 1, deferred: 0, failed: 0 });
  assert.deepEqual(await ids(), ["kept"]);
  assert.deepEqual(await storage.listCursors("c1"), [], "no pending intent is left");

  // Successful clear, then the user kept chatting in the same session (new message ids).
  await add("old", "B", "c1", "b-old");
  await recordClearIntent(storage, "c1", "B");
  chat.sessions.set("B", new Set(["b-new"]));
  await add("fresh", "B", "c1", "b-new");
  assert.deepEqual(await resumeStartupClears(storage, deps), { completed: 1, cancelled: 0, deferred: 0, failed: 0 });
  assert.deepEqual(await ids(), ["fresh", "kept"], "the old source is cleaned, the new one protected");
  assert.deepEqual(await storage.listCursors("c1"), []);
});

test("an older intent without recorded targets is withdrawn when the session has messages (cannot be told apart)", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("m", "A", "c1", "old-1");
  await recordClearIntent(storage, "c1", "A");
  await storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors"); const [row] = await new Promise<Record<string, unknown>[]>((resolve) => { const r = store.getAll(); r.onsuccess = () => resolve(r.result); });
    delete row.clearMessageIds; store.put(row);
  });
  chat.sessions.set("A", new Set(["new-1"]));
  assert.equal((await resumeStartupClears(storage, deps)).cancelled, 1);
  assert.deepEqual(await ids(), ["m"]);
});

test("a session recreated with the same id and a re-created Character with a new id keep their new Memory", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("old", "character:c1", "c1", "m-old"); await add("o2", "A", "c-old"); await add("new", "A2", "c-new");
  await recordClearIntent(storage, "c1", "character:c1");
  await recordClearIntent(storage, "c-old", "A");
  chat.sessions.set("character:c1", new Set(["m-recreated"]));
  await add("recreated", "character:c1", "c1", "m-recreated");
  chat.alive = new Set(["c1", "c-new"]);
  await resumeStartupClears(storage, deps);
  assert.deepEqual(await ids(), ["recreated"]);
  assert.deepEqual([await ids("c-old"), await ids("c-new")], [[], ["new"]]);
});

test("a cleanup failure keeps the intent, counts for diagnostics, and every later startup retries", async () => {
  const { storage, deps, add, ids } = setup();
  await add("m", "A");
  await recordClearIntent(storage, "c1", "A");
  const real = storage.transaction.bind(storage);
  let failing = true;
  storage.transaction = ((mode: IDBTransactionMode, run: never, scope?: never) =>
    failing && mode === "readwrite" ? Promise.reject(new Error("down")) : real(mode, run, scope)) as never;
  assert.equal((await resumeStartupClears(storage, deps)).failed, 1);
  assert.deepEqual(await ids(), ["m"]);
  failing = false;
  await storage.saveCursor("c1", "A", { failureCount: 50, failureReason: "clear-cleanup-failed" }); // many failed startups
  assert.ok((await storage.listCursors("c1"))[0].clearRequestedAt !== undefined, "intent kept");
  assert.equal((await resumeStartupClears(storage, deps)).completed, 1, "no permanent stop");
  assert.deepEqual(await ids(), []);
});

test("a failure is recorded in the cursor; unreadable chat or Foundation data changes nothing", async () => {
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
    if (mode === "readwrite" && armed) { armed = false; return Promise.reject(new Error("down")); }
    return real(mode, run, scope);
  }) as never;
  assert.equal((await resumeStartupClears(storage, deps)).failed, 1);
  const [cursor] = await storage.listCursors("c1");
  assert.equal(cursor.failureCount, 1); assert.equal(cursor.failureReason, "clear-cleanup-failed");
  assert.ok(cursor.clearRequestedAt !== undefined);
});

test("a legitimately empty Foundation cleans pending clears of vanished Characters; a failed or missing read deletes nothing", async () => {
  const { storage, chat, deps, add, ids } = setup();
  await add("m", "A", "gone");
  await recordClearIntent(storage, "gone", "A");
  chat.alive = null; // read failed / never saved
  assert.equal((await resumeStartupClears(storage, deps)).deferred, 1);
  assert.deepEqual(await ids("gone"), ["m"]);
  chat.alive = new Set(); // saved document, no Characters left
  assert.equal((await resumeStartupClears(storage, deps)).completed, 1);
  assert.deepEqual(await ids("gone"), []);
});

test("readAliveCharacters: a saved empty list is an empty set, an unsaved or unreadable document is null", async () => {
  const documents = await import("../lib/core-document-storage");
  const original = documents.browserDocumentStorage.readExisting;
  try {
    documents.browserDocumentStorage.readExisting = async () => JSON.stringify({ version: 1, characters: [], universe: { relations: [], nodePositions: {} }, user: {} });
    assert.deepEqual([...(await readAliveCharacters())!], []);
    documents.browserDocumentStorage.readExisting = async () => null;
    assert.equal(await readAliveCharacters(), null);
    documents.browserDocumentStorage.readExisting = async () => { throw new Error("down"); };
    assert.equal(await readAliveCharacters(), null);
    documents.browserDocumentStorage.readExisting = async () => "{not json";
    assert.equal(await readAliveCharacters(), null);
  } finally { documents.browserDocumentStorage.readExisting = original; }
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

test("a same-millisecond replacement intent cannot receive a stale cleanup failure", async () => {
  const { storage, deps, add } = setup(); await add("old", "A"); await recordClearIntent(storage, "c1", "A");
  const old = (await storage.listCursors("c1"))[0], exclusive = storage.withExclusive.bind(storage); let calls = 0;
  storage.withExclusive = async (work, options) => {
    if (++calls === 2) { await cancelClearIntent(storage, "c1", "A"); await recordClearIntent(storage, "c1", "A"); }
    return exclusive(work, options);
  };
  const broken = { ...deps, sessionIds: async () => new Set(["A"]), countMessages: async () => { throw new Error("injected"); } };
  assert.equal((await resumeStartupClears(storage, broken)).failed, 1);
  const current = (await storage.listCursors("c1"))[0]; assert.equal(current.clearRequestedAt, old.clearRequestedAt);
  assert.notEqual(current.clearToken, old.clearToken); assert.equal(current.failureCount, 0);
});
