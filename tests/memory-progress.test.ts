import assert from "node:assert/strict";
import test from "node:test";
import { IDBObjectStore, IDBDatabase } from "fake-indexeddb";
import { MemoryProgressProtocol, type MemoryBatchTicket } from "../lib/memory/progress";
import { MemoryStorage, request } from "../lib/memory/storage";
import { completeClear, deleteCharacterMemory, recordClearIntent } from "../lib/memory/lifecycle";
import { withMemoryClear } from "../lib/memory/browser";
import { RESTORE_JOURNAL_KEY } from "../lib/backup/restore-journal";
import { runPersistenceWrite, withExclusivePersistenceWriteScope, type PersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import type { MemoryCursor, MemoryDraft } from "../lib/memory/types";
import { deferred, progressFixture } from "./memory-progress-fixture";

const draft = (id: string, sessionId: string, messageId: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({
  id, characterId: "c", text: `fact ${id}`, kind: "fact", subject: "user", status: "active", origin: "auto",
  sources: [{ sessionId, messageId }], lineage: {}, ...extra });
async function dispatched(f: Awaited<ReturnType<typeof progressFixture>>, ticket: MemoryBatchTicket) {
  await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
}

test("automatic superseding requires a permitted successor and rejection preserves Memory and progress", async () => {
  const f = await progressFixture(), message = await f.send();
  const old = draft("old", f.session.id, message.id);
  await f.memory.applyChange("c", "seed", { put: [old] });
  const original = await f.memory.getMemory("old");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1, ["old"]);
    await dispatched(f, ticket);
    const progress = await f.progress();
    for (const lineage of [{}, { supersededBy: "" }, { supersededBy: "old" }, { supersededBy: "missing" }]) {
      await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [{ ...old, status: "superseded", lineage }] }));
      assert.deepEqual(await f.memory.getMemory("old"), original);
      assert.deepEqual(await f.progress(), progress);
    }
    await f.protocol.commitAutomatic(ticket, { put: [
      { ...old, status: "superseded", lineage: { supersededBy: "successor" } },
      draft("successor", f.session.id, message.id),
    ] });
    assert.equal((await f.memory.getMemory("old"))?.lineage.supersededBy, "successor");
    assert.equal((await f.progress())?.throughSeq, 1);
  });
});

test("automatic commit changes Memory and progress together, preserves five user undo slots and suppression", async () => {
  const f = await progressFixture(), message = await f.send();
  for (let i = 0; i < 5; i++) await f.memory.applyChange("c", `manual ${i}`, { put: [draft(`manual${i}`, f.session.id, message.id, { origin: "manual" })] });
  await f.memory.applyChange("c", "delete", { suppress: [{ id: "s", fingerprint: "never revive", reason: "deleted", sources: [] }] });
  const operations = await f.memory.listOperations("c"), suppressions = await f.memory.listSuppressions("c");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1); await dispatched(f, ticket);
    assert.equal(await f.protocol.commitAutomatic(ticket, { put: [draft("new", f.session.id, message.id)] }), "committed");
    assert.equal(await f.protocol.commitAutomatic(ticket, { put: [] }), "already-committed");
  });
  assert.equal((await f.memory.getMemory("new"))?.origin, "auto");
  assert.equal((await f.progress())?.throughSeq, 1);
  assert.deepEqual(await f.memory.listOperations("c"), operations);
  assert.deepEqual(await f.memory.listSuppressions("c"), suppressions);
});

test("restricted automatic route rejects manual edits, suppression, cross Character IDs and invented sources", async () => {
  const f = await progressFixture(), message = await f.send();
  await f.memory.applyChange("c", "manual", { put: [draft("manual", f.session.id, message.id, { origin: "manual" })] });
  await f.memory.applyChange("c", "suppression", { suppress: [{ id: "s", fingerprint: "blocked", reason: "deleted", sources: [] }] });
  const original = await f.memory.getMemory("manual"), ops = await f.memory.listOperations("c"), suppressions = await f.memory.listSuppressions("c");
  await f.protocol.withOwner("c", async (owner) => {
    await assert.rejects(f.protocol.prepare(owner, f.session.id, 1, 1, ["manual"]));
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1); await dispatched(f, ticket);
    const invalid = [draft("manual", f.session.id, message.id), draft("conflict", f.session.id, message.id, { text: "fact manual" }),
      draft("blocked", f.session.id, message.id, { text: "blocked" }), draft("cross", f.session.id, message.id, { characterId: "other" }),
      draft("fake", f.session.id, "invented"), draft("wrong-session", "other-session", message.id)];
    for (const row of invalid) await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [row] }));
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [], suppress: [] } as never));
    await assert.rejects(f.protocol.commitAutomatic({} as MemoryBatchTicket, { put: [] }));
  });
  assert.deepEqual(await f.memory.getMemory("manual"), original);
  assert.deepEqual(await f.memory.listOperations("c"), ops); assert.deepEqual(await f.memory.listSuppressions("c"), suppressions);
  assert.equal((await f.progress())?.throughSeq, 0);
});

test("cursor write failure after Memory puts rolls back both; lease lasts through transaction abort", async () => {
  const f = await progressFixture(), message = await f.send(), events: string[] = [];
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1); await dispatched(f, ticket);
    const put = IDBObjectStore.prototype.put, transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (this.name === "veil-memory-v1" && tx.mode === "readwrite") tx.addEventListener("abort", () => events.push("abort"));
      return tx;
    };
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "cursors" && (value as MemoryCursor).extraction?.throughSeq === 1) throw new DOMException("injected", "QuotaExceededError");
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    try { await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [draft("new", f.session.id, message.id)] })); events.push("rejected"); }
    finally { IDBObjectStore.prototype.put = put; IDBDatabase.prototype.transaction = transaction; }
    assert.deepEqual(events, ["abort", "rejected"]);
    assert.equal(await f.memory.getMemory("new"), undefined); assert.equal((await f.progress())?.throughSeq, 0);
    assert.equal((await f.progress())?.batches[0].state, "commit-pending");
    await f.protocol.commitAutomatic(ticket, { put: [draft("new", f.session.id, message.id)] });
  });
});

test("failed holes do not prevent later ranges; completion cannot skip the hole", async () => {
  const f = await progressFixture(); await f.send("first"); await f.send("second");
  await f.protocol.withOwner("c", async (owner) => {
    const hole = await f.protocol.prepare(owner, f.session.id, 1, 1); await f.protocol.claim(hole, 2); await f.protocol.transition(hole, "failed");
    const later = await f.protocol.prepare(owner, f.session.id, 2, 2); await dispatched(f, later); await f.protocol.commitAutomatic(later, { put: [] });
    assert.equal((await f.progress())?.throughSeq, 0); assert.deepEqual((await f.progress())?.completed, [[2, 2]]);
    await assert.rejects(f.protocol.prepare(owner, f.session.id, 2, 2));
    await assert.rejects(f.protocol.claim(hole, 2));
    const [retry] = await f.protocol.recover(owner, f.session.id);
    await dispatched(f, retry);
    await assert.rejects(f.protocol.commitAutomatic(hole, { put: [] }));
    await f.protocol.commitAutomatic(retry, { put: [] });
    assert.equal((await f.progress())?.throughSeq, 2); assert.deepEqual((await f.progress())?.completed, []);
  });
});

test("edited or deleted undispatched sources can be refreshed without losing retry counts or resurrecting old tickets", async () => {
  const f = await progressFixture(), first = await f.send("first"), second = await f.send("second");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 2);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "failed");
    await f.chat.editMessage(second.id, "edited"); await f.chat.deleteMessages(f.session.id, [first.id]);
    const fresh = await f.protocol.refresh(ticket);
    assert.equal((await f.progress())?.batches[0].attempts, 1);
    assert.equal((await f.progress())?.batches[0].sources.length, 1);
    await assert.rejects(f.protocol.claim(fresh, 1)); await f.protocol.claim(fresh, 2);
    await f.protocol.transition(fresh, "in-flight"); await assert.rejects(f.protocol.refresh(fresh));
    await f.protocol.transition(fresh, "commit-pending"); await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [] }));
    await f.protocol.commitAutomatic(fresh, { put: [draft("edited", f.session.id, second.id)] });
    assert.equal((await f.progress())?.throughSeq, 2);
  });
});

for (const action of ["update", "merge", "reinforce"] as const) test(`restricted ${action} preserves provenance and cleanup restores valid predecessors`, async () => {
  const f = await progressFixture(), first = await f.send("old evidence"), second = await f.send("new evidence");
  const old = draft("old", f.session.id, first.id), other = draft("other", f.session.id, first.id);
  await f.memory.applyChange("c", "seed", { put: action === "merge" ? [old, other] : [old] });
  const ops = await f.memory.listOperations("c");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 2, 2, action === "merge" ? ["old", "other"] : ["old"]);
    await dispatched(f, ticket);
    const fresh = draft("fresh", f.session.id, second.id);
    const put = action === "reinforce" ? [{ ...old, sources: [...old.sources, ...fresh.sources] }]
      : [{ ...old, status: "superseded" as const, lineage: { supersededBy: "fresh" } },
        ...(action === "merge" ? [{ ...other, status: "superseded" as const, lineage: { supersededBy: "fresh" } }] : []),
        { ...fresh, ...(action === "merge" ? { sources: [...old.sources, ...fresh.sources], lineage: { mergedFrom: ["old", "other"] } } : {}) }];
    if (action === "merge") await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [...put.slice(0, 2), { ...fresh, lineage: { mergedFrom: ["old", "other"] } }] }));
    await f.protocol.commitAutomatic(ticket, { put });
  });
  assert.deepEqual(await f.memory.listOperations("c"), ops);
  if (action !== "reinforce") assert.equal((await f.memory.getMemory("old"))?.lineage.previousStatus, "active");
  await completeClear(f.memory, "c", f.session.id, new Set([second.id]));
  assert.equal((await f.memory.getMemory("old"))?.status, "active");
  assert.deepEqual((await f.memory.getMemory("old"))?.sources, old.sources);
  assert.equal(await f.memory.getMemory("fresh"), undefined);
});

test("Character lease cannot be released while a detached admitted commit still owns a Memory transaction", async () => {
  const f = await progressFixture(); await f.send(); const entered = deferred(), release = deferred(), callbackReturned = deferred();
  const original = f.source.readChat; let pause = false;
  const p = new MemoryProgressProtocol(f.memory, { ...f.source, readChat: async (...args) => {
    const chat = await original(...args); if (pause) { entered.resolve(); await release.promise; } return chat;
  } }, f.locks);
  let commit!: Promise<unknown>;
  const ownership = p.withOwner("c", async (owner) => {
    const ticket = await p.prepare(owner, f.session.id, 1, 1); await p.claim(ticket, 1);
    await p.transition(ticket, "in-flight"); await p.transition(ticket, "commit-pending");
    pause = true; commit = p.commitAutomatic(ticket, { put: [] }); await entered.promise; callbackReturned.resolve();
  });
  await callbackReturned.promise;
  const second = new MemoryProgressProtocol(f.memory, f.source, f.origin.client());
  assert.equal(await second.withOwner("c", async () => "unexpected"), undefined);
  release.resolve(); await commit; await ownership;
  assert.equal((await f.progress())?.throughSeq, 1);
});

for (const state of ["claimed", "in-flight", "commit-pending"] as const) test(`owner loss in ${state} never silently resends dispatched work`, async () => {
  const f = await progressFixture(); await f.send();
  let stale!: MemoryBatchTicket;
  await f.protocol.withOwner("c", async (owner) => {
    stale = await f.protocol.prepare(owner, f.session.id, 1, 1); await f.protocol.claim(stale, 2);
    if (state !== "claimed") await f.protocol.transition(stale, "in-flight");
    if (state === "commit-pending") await f.protocol.transition(stale, "commit-pending");
  });
  await assert.rejects(f.protocol.commitAutomatic(stale, { put: [] }));
  const other = new MemoryProgressProtocol(f.memory, f.source, f.origin.client());
  await other.withOwner("c", async (owner) => {
    const tickets = await other.recover(owner, f.session.id);
    assert.equal((await f.progress())?.batches[0].state, state === "claimed" ? "ready" : "uncertain");
    assert.equal(tickets.length, state === "claimed" ? 1 : 0);
    if (tickets.length) { await assert.rejects(other.claim(tickets[0], 1)); await other.claim(tickets[0], 2); }
  });
});

test("too-large ranges stay pending, and two owners cannot process the same Character", async () => {
  const f = await progressFixture(); await f.send();
  const other = new MemoryProgressProtocol(f.memory, f.source, f.origin.client());
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1, [], true);
    await assert.rejects(f.protocol.claim(ticket, 1));
    assert.equal(await other.withOwner("c", async () => { throw new Error("duplicate owner"); }), undefined);
    assert.equal((await f.progress())?.throughSeq, 0);
  });
});

for (const deletion of ["clear", "session", "character", "intent", "edit", "candidate"] as const) test(`${deletion} before late commit cannot resurrect an old source`, async () => {
  const f = await progressFixture(), message = await f.send();
  await f.memory.applyChange("c", "seed", { put: [draft("existing", f.session.id, message.id)] });
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1, ["existing"]); await dispatched(f, ticket);
    if (deletion === "clear") await withMemoryClear(f.session, (scope) => f.chat.clearSession(f.session.id, scope), f.memory);
    if (deletion === "session") await withMemoryClear(f.session, (scope) => f.chat.deleteSession(f.session.id, scope), f.memory);
    if (deletion === "character") await f.memory.withShared(async (scope) => {
      const before = await f.core.read(FOUNDATION_STORAGE_KEY, scope);
      await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, before, JSON.stringify({ version: 1, characters: [] }), scope);
      await deleteCharacterMemory(f.memory, "c", scope);
    });
    if (deletion === "intent") await recordClearIntent(f.memory, "c", f.session.id);
    if (deletion === "edit") await f.chat.editMessage(message.id, "changed");
    if (deletion === "candidate") await f.memory.applyChange("c", "edit", { put: [draft("existing", f.session.id, message.id, { text: "changed" })] });
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [draft("late", f.session.id, message.id)] }));
    assert.equal(await f.memory.getMemory("late"), undefined);
  });
});

test("delete queued between source verification and Memory commit waits, then removes the committed source", async () => {
  const f = await progressFixture(), message = await f.send(), reached = deferred(), proceed = deferred();
  let pause = false;
  const source = { ...f.source, readChat: async (sessionId: string, scope: PersistenceWriteScope) => {
    const snapshot = await f.source.readChat(sessionId, scope);
    if (pause) { reached.resolve(); await proceed.promise; }
    return snapshot;
  } };
  const protocol = new MemoryProgressProtocol(f.memory, source, f.locks);
  await protocol.withOwner("c", async (owner) => {
    const ticket = await protocol.prepare(owner, f.session.id, 1, 1); await protocol.claim(ticket, 1);
    await protocol.transition(ticket, "in-flight"); await protocol.transition(ticket, "commit-pending");
    pause = true;
    const committing = protocol.commitAutomatic(ticket, { put: [draft("new", f.session.id, message.id)] }); await reached.promise;
    let cleared = false;
    const clearing = withMemoryClear(f.session, async (scope) => { await f.chat.clearSession(f.session.id, scope); cleared = true; }, f.memory);
    await new Promise((done) => setImmediate(done)); assert.equal(cleared, false);
    proceed.resolve(); await committing; await clearing;
    assert.equal(await f.memory.getMemory("new"), undefined); assert.deepEqual(await f.memory.listCursors("c"), []);
  });
});

test("expired, shared and foreign scopes cannot authorize an exclusive operation; restore journal blocks admission", async () => {
  const f = await progressFixture(); let stale!: PersistenceWriteScope;
  await f.memory.withExclusive(async (scope) => { stale = scope; f.memory.assertExclusive(scope); });
  assert.throws(() => f.memory.assertExclusive(stale));
  await f.memory.withShared(async (scope) => { assert.throws(() => f.memory.assertExclusive(scope)); });
  await assert.rejects(runPersistenceWrite(f.gate, async () => {}, {} as PersistenceWriteScope));
  const foreign = new MemoryStorage(() => f.factory, Date.now, { withWrite: (op) => op(), withExclusiveWrite: (op) => op() });
  await foreign.withExclusive(async (scope) => { assert.throws(() => f.memory.assertExclusive(scope)); });
  f.raw.set(RESTORE_JOURNAL_KEY, "malformed-present");
  await assert.rejects(f.memory.withExclusive(async () => { throw new Error("must not run"); }), /restore-in-progress/);
});

test("cold opens inside the exclusive scope do not queue a shared request against themselves", async () => {
  const f = await progressFixture(), cold = new MemoryStorage(() => f.factory, Date.now, f.gate);
  await withExclusivePersistenceWriteScope(f.gate, async (scope) => {
    await cold.listMemories("c", scope);
    const { ChatStorage } = await import("../lib/chat/storage");
    const { IndexedDBDocumentStorage } = await import("../lib/core-document-storage");
    await new ChatStorage(() => f.factory, () => f.locks, f.gate).readMemorySources(f.session.id, scope);
    await new IndexedDBDocumentStorage(() => f.factory, f.gate).read(FOUNDATION_STORAGE_KEY, scope);
  }, { waitMs: 50 });
});

test("restore nonce rotation rejects a pre-restore ticket even when all logical rows match (ABA)", async () => {
  const f = await progressFixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1);
    const rows = await f.memory.transaction("readonly", async (tx) => ({ memories: await request(tx.store("memories").getAll()),
      cursors: await request(tx.store("cursors").getAll()), suppressions: [], operations: [] }));
    await f.memory.replaceAllRows(rows);
    await assert.rejects(f.protocol.claim(ticket, 1));
    const [fresh] = await f.protocol.recover(owner, f.session.id); await f.protocol.claim(fresh, 1);
  });
});

test("cancellation aborts the final Memory transaction and retains the pending result", async () => {
  const f = await progressFixture(), message = await f.send(), abort = new AbortController();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1); await dispatched(f, ticket);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const result = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.name === "memories") abort.abort();
      return result;
    };
    try { await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [draft("new", f.session.id, message.id)] }, abort.signal)); }
    finally { IDBObjectStore.prototype.put = put; }
    assert.equal(await f.memory.getMemory("new"), undefined); assert.equal((await f.progress())?.throughSeq, 0);
  });
});
