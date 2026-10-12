import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BackupLockManager } from "../lib/backup/coordination";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { validateBackupPackage } from "../lib/backup/validation";
import { addManualMemory, deleteMemory, describeSources, editMemory, filterMemories } from "../lib/memory/bank";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { clearSession, deleteCharacterMemory } from "../lib/memory/lifecycle";
import { MemoryConflictError, MemoryDuplicateError, MemoryStorage } from "../lib/memory/storage";
import type { Memory, MemoryDraft } from "../lib/memory/types";
import { backupData, packageFixture, TEST_NOW } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";

const passthrough: PersistenceWriteGate = { withWrite: (operation) => operation() };
/** Two handles on one database stand in for two tabs; the clock ticks so every write has its own time. */
function setup() {
  const factory = new IDBFactory();
  let clock = 1000;
  const make = () => new MemoryStorage(() => factory, () => ++clock, passthrough);
  return { factory, make, storage: make() };
}
const only = async (storage: MemoryStorage, characterId: string) => {
  const rows = await storage.listMemories(characterId);
  assert.equal(rows.length, 1);
  return rows[0];
};
const auto = (id: string, text: string): MemoryDraft => ({ id, characterId: "c1", kind: "event", text, subject: "user", status: "active",
  origin: "auto", sources: [{ sessionId: "A", messageId: "m1" }], lineage: {} });

test("adding creates an active manual memory with no source and no subject, and refuses empty or duplicate text", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "  Likes green tea.  " });
  const row = await only(storage, "c1");
  assert.deepEqual({ text: row.text, kind: row.kind, origin: row.origin, status: row.status, subject: row.subject, sources: row.sources },
    { text: "Likes green tea.", kind: "fact", origin: "manual", status: "active", subject: "", sources: [] });
  await assert.rejects(addManualMemory(storage, "c1", { kind: "fact", text: " ,. " }), /Write something/);
  await assert.rejects(addManualMemory(storage, "c1", { kind: "event", text: "likes GREEN tea" }), MemoryDuplicateError);
  assert.equal((await storage.listMemories("c1")).length, 1);
  assert.deepEqual((await storage.listSuppressions("c1")), []);
  assert.deepEqual((await storage.listOperations("c1")).map((op) => op.label), ["Added a memory"]);
});

test("editing an automatic memory makes it manual, keeps its sources, and suppresses the old text; undo restores both", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "auto", { put: [auto("a", "Went to Paris")] });
  const before = await only(storage, "c1");
  await editMemory(storage, before, { kind: "event", text: "Went to Lyon" });
  const after = await only(storage, "c1");
  assert.deepEqual({ text: after.text, origin: after.origin, sources: after.sources, createdAt: after.createdAt },
    { text: "Went to Lyon", origin: "manual", sources: before.sources, createdAt: before.createdAt });
  const [suppression] = await storage.listSuppressions("c1");
  assert.deepEqual({ fingerprint: suppression.fingerprint, reason: suppression.reason, sources: suppression.sources },
    { fingerprint: memoryFingerprint("Went to Paris"), reason: "corrected", sources: before.sources });

  const undone = await storage.undoLastOperation("c1");
  assert.equal(undone?.label, "Edited a memory");
  assert.deepEqual(await only(storage, "c1"), before); // original origin, text and timestamps
  assert.deepEqual(await storage.listSuppressions("c1"), []);
});

test("an edit that keeps the text writes no suppression, and an edit that changes nothing writes nothing", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "Has a cat" });
  const row = await only(storage, "c1");
  assert.equal(await editMemory(storage, row, { kind: "fact", text: " Has a cat " }), undefined);
  await editMemory(storage, row, { kind: "ongoing", text: "has a CAT" });
  assert.deepEqual(await storage.listSuppressions("c1"), []);
  assert.equal((await only(storage, "c1")).kind, "ongoing");
  assert.equal((await storage.listOperations("c1")).length, 2);
});

test("an edit cannot take the text of another memory of the same Character", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "Has a cat" });
  await addManualMemory(storage, "c1", { kind: "fact", text: "Has a dog" });
  const dog = (await storage.findByFingerprint("c1", "Has a dog"))[0];
  await assert.rejects(editMemory(storage, dog, { kind: "fact", text: "has a cat!" }), MemoryDuplicateError);
  assert.equal((await storage.getMemory(dog.id))?.text, "Has a dog");
});

test("deleting writes a deletion suppression; undo brings the memory back and removes the suppression", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "auto", { put: [auto("a", "Fears heights")] });
  const row = await only(storage, "c1");
  await deleteMemory(storage, row);
  assert.deepEqual(await storage.listMemories("c1"), []);
  const [suppression] = await storage.listSuppressions("c1");
  assert.deepEqual({ fingerprint: suppression.fingerprint, reason: suppression.reason, sources: suppression.sources },
    { fingerprint: row.fingerprint, reason: "deleted", sources: row.sources });
  await storage.undoLastOperation("c1");
  assert.deepEqual(await only(storage, "c1"), row);
  assert.deepEqual(await storage.listSuppressions("c1"), []);
});

test("re-adding text the user deleted is allowed and keeps the suppression for automatic maintenance", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "Plays piano" });
  await deleteMemory(storage, await only(storage, "c1"));
  await addManualMemory(storage, "c1", { kind: "fact", text: "Plays piano" });
  assert.equal((await only(storage, "c1")).origin, "manual");
  assert.equal((await storage.listSuppressions("c1")).length, 1);
});

test("undo keeps the last five user changes per Character and survives a reload", async () => {
  const { make, storage } = setup();
  for (let i = 1; i <= 7; i++) await addManualMemory(storage, "c1", { kind: "fact", text: `memory ${i}` });
  await addManualMemory(storage, "c2", { kind: "fact", text: "other Character" });
  const reloaded = make(); // a new page load opens the same database
  assert.equal((await reloaded.listOperations("c1")).length, 5);
  for (let i = 0; i < 5; i++) assert.ok(await reloaded.undoLastOperation("c1"));
  assert.equal(await reloaded.undoLastOperation("c1"), undefined);
  assert.deepEqual((await reloaded.listMemories("c1")).map((row) => row.text).sort(), ["memory 1", "memory 2"]);
  assert.deepEqual((await reloaded.listMemories("c2")).map((row) => row.text), ["other Character"]);
  assert.equal((await reloaded.listOperations("c2")).length, 1);
});

test("Characters cannot see or change each other's memories", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "Secret of c1" });
  const row = await only(storage, "c1");
  assert.deepEqual(await storage.listMemories("c2"), []);
  await assert.rejects(storage.applyChange("c2", "steal", { remove: [row.id] }, { expectUpdatedAt: { [row.id]: row.updatedAt } }), MemoryConflictError);
  assert.equal(await storage.undoLastOperation("c2"), undefined);
  assert.equal((await only(storage, "c1")).text, "Secret of c1");
});

test("a stale tab cannot overwrite, delete or undo over a newer change", async () => {
  const { make } = setup();
  const tabA = make(), tabB = make();
  await addManualMemory(tabA, "c1", { kind: "fact", text: "Original" });
  const seenByA = await only(tabA, "c1");
  const opSeenByA = (await tabA.listOperations("c1")).at(-1)!;

  await editMemory(tabB, seenByA, { kind: "fact", text: "Changed in B" });
  await assert.rejects(editMemory(tabA, seenByA, { kind: "fact", text: "Changed in A" }), MemoryConflictError);
  await assert.rejects(deleteMemory(tabA, seenByA), MemoryConflictError);
  assert.equal((await only(tabA, "c1")).text, "Changed in B");
  assert.equal((await tabA.listSuppressions("c1")).length, 1); // only B's correction
  // A's Undo button still names A's add; B's edit is newer, so undo refuses rather than undoing B's edit.
  await assert.rejects(tabA.undoLastOperation("c1", opSeenByA), MemoryConflictError);
  assert.equal((await only(tabA, "c1")).text, "Changed in B");

  // Sequence numbers are reused after an undo; a different operation with the same number is still refused.
  const opSeenByB = (await tabB.listOperations("c1")).at(-1)!;
  await tabA.undoLastOperation("c1");
  await deleteMemory(tabA, await only(tabA, "c1"));
  const reused = (await tabA.listOperations("c1")).at(-1)!;
  assert.equal(reused.id, opSeenByB.id);
  await assert.rejects(tabB.undoLastOperation("c1", opSeenByB), MemoryConflictError);
  assert.equal((await tabB.undoLastOperation("c1", reused))?.label, "Deleted a memory");
});

test("clearing a chat keeps a memory the user edited and only drops that chat as its source", async () => {
  const { storage } = setup();
  await storage.applyChange("c1", "auto", { put: [auto("a", "Met at the cafe"), { ...auto("b", "Likes jazz"), sources: [{ sessionId: "B", messageId: "m2" }] }] });
  await editMemory(storage, (await storage.getMemory("a"))!, { kind: "event", text: "Met at the library" });
  await clearSession(storage, "c1", "A");
  const kept = await storage.getMemory("a");
  assert.deepEqual({ text: kept?.text, origin: kept?.origin, sources: kept?.sources }, { text: "Met at the library", origin: "manual", sources: [] });
  assert.ok(await storage.getMemory("b"));
  // The correction's suppression was sourced only from A, and undo records that point at A are dropped (M2 rule).
  assert.deepEqual(await storage.listSuppressions("c1"), []);
  assert.deepEqual(await storage.listOperations("c1"), []);
});

test("deleting a Character removes its Bank rows, suppressions and undo history", async () => {
  const { storage } = setup();
  await addManualMemory(storage, "c1", { kind: "fact", text: "x1" });
  await deleteMemory(storage, await only(storage, "c1"));
  await addManualMemory(storage, "c2", { kind: "fact", text: "x2" });
  await deleteCharacterMemory(storage, "c1");
  assert.deepEqual(await storage.listCharacterIds(), ["c2"]);
});

test("search and filters run locally, newest first", () => {
  const row = (id: string, text: string, extra: Partial<Memory> = {}): Memory => ({ id, characterId: "c1", kind: "fact", text, subject: "",
    status: "active", origin: "manual", sources: [], lineage: {}, fingerprint: memoryFingerprint(text), createdAt: 1, updatedAt: 1, ...extra });
  const rows = [row("a", "Likes Green Tea", { updatedAt: 1 }), row("b", "Drinks tea at night", { updatedAt: 3, kind: "event" }),
    row("c", "Ｔｅａ ceremony", { updatedAt: 2, origin: "auto", status: "archived" })];
  assert.deepEqual(filterMemories(rows, { query: "tea" }).map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(filterMemories(rows, { query: "green TEA" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterMemories(rows, { kind: "event" }).map((item) => item.id), ["b"]);
  assert.deepEqual(filterMemories(rows, { origin: "auto", status: "archived" }).map((item) => item.id), ["c"]);
  assert.deepEqual(filterMemories(rows, { query: "coffee" }), []);
});

test("sources are described by conversation and message presence, never by chat text", async () => {
  const memory = { sources: [{ sessionId: "A", messageId: "m1" }, { sessionId: "A", messageId: "m2" }, { sessionId: "gone", messageId: "m3" }] } as Memory;
  const asked: string[] = [];
  const summary = await describeSources(memory, {
    sessionName: (id) => id === "A" ? "Private chat" : null,
    existingMessageIds: async (id, ids) => { asked.push(id); return new Set(ids.filter((item) => item === "m1")); },
  });
  assert.deepEqual(summary, [{ sessionId: "A", name: "Private chat", messages: 2, present: 1 },
    { sessionId: "gone", name: null, messages: 1, present: 0 }]);
  assert.deepEqual(asked, ["A"]);
  await assert.rejects(describeSources(memory, { sessionName: () => "x", existingMessageIds: async () => { throw new Error("read failed"); } }), /read failed/);
});

test("Bank rows pass backup validation and restore with their ids, undo history and suppressions", async () => {
  const raw = new Map<string, string>();
  const source: RestoreDevice = { indexedDB: new IDBFactory(), localStorage: { getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); } } };
  let clock = TEST_NOW;
  const storage = new MemoryStorage(() => source.indexedDB, () => ++clock, passthrough);
  await storage.applyChange("peter", "auto", { put: [{ ...auto("auto-1", "Went hiking"), characterId: "peter",
    sources: [{ sessionId: "character:peter", messageId: "user-test" }] }] });
  await addManualMemory(storage, "peter", { kind: "fact", text: "Allergic to cats" });
  await editMemory(storage, (await storage.getMemory("auto-1"))!, { kind: "event", text: "Went climbing" });
  await deleteMemory(storage, (await storage.findByFingerprint("peter", "Allergic to cats"))[0]);

  const data = backupData();
  data.memory = (await readStaticBackupSource(source)).memory as typeof data.memory;
  const fixture = await packageFixture(data);
  const validated = await validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  assert.deepEqual(validated.data.memory, data.memory);

  const target: RestoreDevice = { ...source, indexedDB: new IDBFactory() };
  raw.clear();
  await restoreIntoEmpty(JSON.stringify(fixture.manifest), fixture.files, target, lockOrigin().client() as unknown as BackupLockManager);
  const restored = new MemoryStorage(() => target.indexedDB, () => ++clock, passthrough);
  assert.deepEqual(await restored.listMemories("peter"), await storage.listMemories("peter"));
  assert.equal((await restored.listOperations("peter")).length, 4);
  assert.equal((await restored.undoLastOperation("peter"))?.label, "Deleted a memory");
  assert.equal((await restored.findByFingerprint("peter", "Allergic to cats")).length, 1);
  assert.equal((await restored.listSuppressions("peter")).length, 1); // the correction's suppression remains
});
