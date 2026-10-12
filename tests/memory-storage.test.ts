import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { clearSession, completeClear, deleteCharacterMemory, recordClearIntent, resumePendingClears } from "../lib/memory/lifecycle";
import { MemoryDuplicateError, MemoryProtectedError, MemoryStorage } from "../lib/memory/storage";
import type { MemoryDraft, MemorySource } from "../lib/memory/types";

const src = (sessionId: string, messageId = "m1"): MemorySource => ({ sessionId, messageId });
const draft = (id: string, characterId: string, text: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({
  id, characterId, kind: "fact", text, subject: "user", status: "active", origin: "auto", sources: [src("A")], lineage: {}, ...extra,
});
function setup() {
  const factory = new IDBFactory();
  let writes = 0;
  const gate: PersistenceWriteGate = { withWrite: (operation) => { writes++; return operation(); } };
  const make = () => new MemoryStorage(() => factory, () => 1000, gate);
  return { factory, make, storage: make(), writes: () => writes };
}
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test("writes go through the persistence write gate and derive the fingerprint", async () => {
  const { storage, writes } = setup();
  await storage.applyChange("c1", "add", { put: [draft("a", "c1", "Likes Tea!")] });
  assert.ok(writes() >= 1);
  const [row] = await storage.listMemories("c1");
  assert.equal(row.fingerprint, memoryFingerprint("likes tea"));
  assert.equal(row.createdAt, 1000);
});

test("sources keep only sessionId and messageId", async () => {
  const { storage } = setup();
  const leaky = { sessionId: "A", messageId: "m1", text: "chat text" } as MemorySource;
  await storage.applyChange("c1", "add", { put: [draft("a", "c1", "x1", { sources: [leaky] })] });
  assert.deepEqual((await storage.getMemory("a"))!.sources, [src("A")]);
});

test("Characters are isolated", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "add", { put: [draft("a", "c1", "same text")] });
  await storage.applyChange("c2", "add", { put: [draft("b", "c2", "same text")] });
  assert.deepEqual(ids(await storage.listMemories("c1")), ["a"]);
  assert.deepEqual(ids(await storage.listMemories("c2")), ["b"]);
  await assert.rejects(storage.applyChange("c2", "steal", { put: [draft("a", "c2", "x")] }), /different Character/);
  await assert.rejects(storage.applyChange("c2", "steal", { remove: ["a"] }), /different Character/);
  await storage.applyChange("c2", "ok", {});
  assert.equal((await storage.listOperations("c1")).length, 1);
});

test("manual memories are protected from automatic edits", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "add", { put: [draft("m", "c1", "manual fact", { origin: "manual" })] });
  await assert.rejects(storage.applyChange("c1", "auto", { put: [draft("m", "c1", "changed")] }, { auto: true }), MemoryProtectedError);
  await assert.rejects(storage.applyChange("c1", "auto", { remove: ["m"] }, { auto: true }), MemoryProtectedError);
  assert.equal((await storage.getMemory("m"))!.text, "manual fact");
  await storage.applyChange("c1", "user edit", { put: [draft("m", "c1", "edited", { origin: "manual" })] });
  assert.equal((await storage.getMemory("m"))!.text, "edited");
});

test("only the last five operations per Character are kept, trimmed in the same transaction", async () => {
  const { storage } = setup();
  for (let i = 0; i < 7; i++) await storage.applyChange("c1", `op${i}`, { put: [draft(`a${i}`, "c1", `fact number ${i}x`)] });
  await storage.applyChange("c2", "other", { put: [draft("z", "c2", "zzz")] });
  assert.deepEqual((await storage.listOperations("c1")).map((op) => op.label), ["op2", "op3", "op4", "op5", "op6"]);
  assert.equal((await storage.listOperations("c2")).length, 1);
  const undone = await storage.undoLastOperation("c1");
  assert.equal(undone!.label, "op6");
  assert.equal(await storage.getMemory("a6"), undefined);
  assert.equal((await storage.listOperations("c1")).length, 4);
});

test("undo restores edited and removed memories", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "add", { put: [draft("a", "c1", "first")] });
  await storage.applyChange("c1", "edit+remove", { put: [draft("a", "c1", "second")], remove: [] });
  await storage.undoLastOperation("c1");
  assert.equal((await storage.getMemory("a"))!.text, "first");
  await storage.applyChange("c1", "remove", { remove: ["a"] });
  await storage.undoLastOperation("c1");
  assert.equal((await storage.getMemory("a"))!.text, "first");
});

test("fingerprint dedupes per Character and is indexed by characterId + fingerprint", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "add", { put: [draft("a", "c1", "Loves  Cats.")] });
  await assert.rejects(storage.applyChange("c1", "dup", { put: [draft("b", "c1", "loves cats")] }), MemoryDuplicateError);
  await storage.applyChange("c2", "other character", { put: [draft("c", "c2", "loves cats")] });
  assert.deepEqual(ids(await storage.findByFingerprint("c1", "LOVES CATS!!")), ["a"]);
  await storage.applyChange("c1", "supersede", { put: [draft("a", "c1", "Loves  Cats.", { status: "superseded" }), draft("b", "c1", "loves cats")] });
  assert.deepEqual(ids(await storage.findByFingerprint("c1", "loves cats")), ["a", "b"]);
});

test("a failing batch rolls back every write and records no operation", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "add", { put: [draft("m", "c1", "manual fact", { origin: "manual" })] });
  await assert.rejects(storage.applyChange("c1", "batch", {
    put: [draft("n1", "c1", "new one"), draft("m", "c1", "tamper")], suppress: [{ id: "s", fingerprint: "f", reason: "deleted", sources: [src("A")] }],
  }, { auto: true }), MemoryProtectedError);
  assert.deepEqual(ids(await storage.listMemories("c1")), ["m"]);
  assert.equal((await storage.listSuppressions("c1")).length, 0);
  assert.equal((await storage.listOperations("c1")).length, 1);
  await assert.rejects(storage.applyChange("c1", "dup", { put: [draft("n2", "c1", "fresh"), draft("n3", "c1", "fresh")] }), MemoryDuplicateError);
  assert.equal(await storage.getMemory("n2"), undefined);
});

async function seedClear(storage: MemoryStorage) {
  const c = "c1";
  await storage.applyChange(c, "seed", {
    put: [
      draft("onlyA", c, "only from A"),
      draft("multi", c, "from A and B", { sources: [src("A"), src("B")] }),
      draft("manual", c, "manual note", { origin: "manual", sources: [src("A")] }),
      draft("untouched", c, "from B", { sources: [src("B")] }),
      // Merge of o1 (only A), o2 (A and B), o3 (only B); merged carries all sources.
      draft("o1", c, "orig one", { status: "superseded", sources: [src("A")], lineage: { supersededBy: "merged" } }),
      draft("o2", c, "orig two", { status: "superseded", sources: [src("A"), src("B")], lineage: { supersededBy: "merged" } }),
      draft("o3", c, "orig three", { status: "superseded", sources: [src("B")], lineage: { supersededBy: "merged" } }),
      draft("merged", c, "merged text", { sources: [src("A"), src("B")], lineage: { mergedFrom: ["o1", "o2", "o3"] } }),
    ],
    suppress: [
      { id: "sA", fingerprint: "fa", reason: "deleted", sources: [src("A")] },
      { id: "sAB", fingerprint: "fb", reason: "corrected", sources: [src("A"), src("B")] },
      { id: "sUser", fingerprint: "fc", reason: "deleted", sources: [] },
    ],
  });
  await storage.saveCursor(c, "A", { processedMessageId: "m9" });
  await storage.saveCursor(c, "B", { processedMessageId: "m3", failureCount: 2, failureReason: "timeout" });
  await storage.applyChange("c2", "other", { put: [draft("other", "c2", "other char", { sources: [src("A")] })] });
}

async function assertCleared(storage: MemoryStorage) {
  const rows = new Map((await storage.listMemories("c1")).map((row) => [row.id, row]));
  assert.deepEqual([...rows.keys()].sort(), ["manual", "multi", "o2", "o3", "untouched"]);
  assert.deepEqual(rows.get("multi")!.sources, [src("B")]);
  assert.deepEqual(rows.get("manual")!.sources, []);
  assert.equal(rows.get("manual")!.origin, "manual");
  for (const id of ["o2", "o3"]) {
    assert.equal(rows.get(id)!.status, "active");
    assert.equal(rows.get(id)!.lineage.supersededBy, undefined);
  }
  assert.deepEqual(rows.get("o2")!.sources, [src("B")]);
  assert.deepEqual(ids(await storage.listSuppressions("c1")), ["sAB", "sUser"]);
  assert.deepEqual((await storage.listSuppressions("c1")).find((row) => row.id === "sAB")!.sources, [src("B")]);
  const cursors = await storage.listCursors("c1");
  assert.deepEqual(cursors.map((row) => row.sessionId), ["B"]);
  assert.equal(cursors[0].failureReason, "timeout");
  assert.equal((await storage.listOperations("c1")).length, 0, "undo records referencing A are dropped");
  assert.deepEqual(ids(await storage.listMemories("c2")), ["other"]);
}

test("clearing a session handles every category and lineage without model calls", async () => {
  const { storage } = setup();
  await seedClear(storage);
  await clearSession(storage, "c1", "A");
  await assertCleared(storage);
});

test("clear intent is persisted, survives reopen, and redo is idempotent", async () => {
  const { storage, make } = setup();
  await seedClear(storage);
  await recordClearIntent(storage, "c1", "A");
  const reopened = make();
  const pending = (await reopened.listCursors("c1")).filter((row) => row.clearRequestedAt !== undefined);
  assert.deepEqual(pending.map((row) => row.sessionId), ["A"]);
  assert.equal(pending[0].processedMessageId, "m9");
  assert.equal((await reopened.listMemories("c1")).length, 8, "nothing removed before completion");
  assert.deepEqual(await resumePendingClears(reopened, "c1"), ["A"]);
  await assertCleared(reopened);
  assert.deepEqual(await resumePendingClears(reopened, "c1"), []);
  await completeClear(reopened, "c1", "A");
  await recordClearIntent(reopened, "c1", "A");
  await completeClear(reopened, "c1", "A");
  await assertCleared(reopened);
});

test("a clear transaction that fails leaves data and the intent in place", async () => {
  const { storage, factory } = setup();
  await seedClear(storage);
  await recordClearIntent(storage, "c1", "A");
  let calls = 0;
  const failing = new MemoryStorage(() => factory, () => { if (++calls > 1) throw new Error("boom"); return 1; });
  await assert.rejects(completeClear(failing, "c1", "A"));
  assert.equal((await storage.listMemories("c1")).length, 8);
  assert.equal((await storage.listCursors("c1")).filter((row) => row.clearRequestedAt !== undefined).length, 1);
});

test("deleting a Character removes all its rows and nothing else", async () => {
  const { storage } = setup();
  await seedClear(storage);
  await deleteCharacterMemory(storage, "c1");
  assert.equal((await storage.listMemories("c1")).length, 0);
  assert.equal((await storage.listSuppressions("c1")).length, 0);
  assert.equal((await storage.listOperations("c1")).length, 0);
  assert.equal((await storage.listCursors("c1")).length, 0);
  assert.deepEqual(ids(await storage.listMemories("c2")), ["other"]);
  assert.equal((await storage.listOperations("c2")).length, 1);
});

test("cursors keep failure state and clear it on success", async () => {
  const { storage } = setup();
  await storage.saveCursor("c1", "A", { failureCount: 1, failureReason: "rate-limit" });
  await recordClearIntent(storage, "c1", "A");
  const [row] = await storage.listCursors("c1");
  assert.equal(row.failureReason, "rate-limit");
  assert.ok(row.clearRequestedAt !== undefined);
  const next = await storage.saveCursor("c1", "A", { failureCount: 0, processedMessageId: "m2" });
  assert.equal(next.failureReason, undefined);
  assert.ok(next.clearRequestedAt !== undefined, "progress writes do not drop a pending clear intent");
});

test("undo also reverses the suppressions an operation wrote", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "s1", { suppress: [{ id: "s", fingerprint: "f", reason: "deleted", sources: [src("B")] }] });
  await storage.applyChange("c1", "s2", { suppress: [{ id: "s", fingerprint: "f", reason: "corrected", sources: [src("B")] }, { id: "t", fingerprint: "g", reason: "deleted", sources: [] }] });
  await storage.undoLastOperation("c1");
  assert.deepEqual((await storage.listSuppressions("c1")).map((row) => [row.id, row.reason]), [["s", "deleted"]]);
  await storage.undoLastOperation("c1");
  assert.equal((await storage.listSuppressions("c1")).length, 0);
});

test("clearing does not revive an original already covered by another live memory", async () => {
  const { storage } = setup();
  const c = "c1";
  await storage.applyChange(c, "seed", { put: [
    draft("o1", c, "same words", { status: "superseded", sources: [src("A"), src("B")], lineage: { supersededBy: "merged" } }),
    draft("o2", c, "other words", { status: "superseded", sources: [src("B")], lineage: { supersededBy: "merged" } }),
    draft("merged", c, "merged", { sources: [src("A"), src("B")], lineage: { mergedFrom: ["o1", "o2"] } }),
    draft("live", c, "Same words!", { sources: [src("B")] }),
  ] });
  await clearSession(storage, c, "A");
  const rows = new Map((await storage.listMemories(c)).map((row) => [row.id, row]));
  assert.equal(rows.has("merged"), false);
  assert.equal(rows.get("o1")!.status, "superseded");
  assert.equal(rows.get("o1")!.lineage.supersededBy, undefined);
  assert.equal(rows.get("o2")!.status, "active");
});
