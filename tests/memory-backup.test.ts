import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BackupLockManager } from "../lib/backup/coordination";
import { BackupValidationError, type BackupData } from "../lib/backup/format";
import type { PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, digestUnits, recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY,
  RESTORE_UNITS, type RestoreDevice } from "../lib/backup/restore";
import { exportStaticBackup } from "../lib/backup/static-export";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { validateBackupPackage } from "../lib/backup/validation";
import { withMemoryClear } from "../lib/memory/browser";
import { findLeftovers, removeLeftovers } from "../lib/character-leftovers";
import { cancelClearIntent, deleteCharacterMemory, recordClearIntent } from "../lib/memory/lifecycle";
import { MemoryStorage } from "../lib/memory/storage";
import { lockOrigin } from "./generation-lock-fixture";
import { A, B, buildWorld } from "./character-deletion-fixture";
import { backupData, memoryData, packageFixture, replacePayload, TEST_COMMIT, TEST_NOW, type Fixture } from "./backup-fixture";

function newDevice() {
  const raw = new Map<string, string>();
  const device: RestoreDevice & { raw: Map<string, string> } = { indexedDB: new IDBFactory(), raw,
    localStorage: { getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); } } };
  return device;
}
const locksClient = () => lockOrigin().client() as unknown as BackupLockManager;
const pack = async (data: BackupData = backupData()) => { const f = await packageFixture(data); return { fixture: f, manifestJson: JSON.stringify(f.manifest), files: f.files }; };
const validate = (f: Fixture) => validateBackupPackage(JSON.stringify(f.manifest), f.files);
const memoryRows = async (device: RestoreDevice) => (await readStaticBackupSource(device)).memory;
const passthrough: PersistenceWriteGate = { withWrite: (operation) => operation() };

test("export includes all four Memory stores with stable ids and no chat text", async () => {
  const device = newDevice(), source = new MemoryStorage(() => device.indexedDB, () => TEST_NOW, passthrough);
  const data = memoryData();
  await source.applyChange("peter", "add", { put: data.memories.map((row) => { const { fingerprint, createdAt, updatedAt, ...draft } = row; void [fingerprint, createdAt, updatedAt]; return draft; }),
    suppress: [{ id: "suppress-1", fingerprint: data.suppressions[0].fingerprint, reason: "deleted", sources: data.suppressions[0].sources }] });
  await source.saveCursor("peter", "character:peter", { processedMessageId: "reply-test" });
  const snapshot = await readStaticBackupSource(device);
  assert.deepEqual(Object.keys(snapshot.memory).sort(), ["cursors", "memories", "operations", "suppressions"]);
  assert.deepEqual(snapshot.memory.memories.map((row) => (row as { id: string }).id).sort(), ["memory-1", "memory-2"]);
  assert.equal(snapshot.memory.suppressions.length, 1); assert.equal(snapshot.memory.operations.length, 1); assert.equal(snapshot.memory.cursors.length, 1);
  // The rest of the fixture is absent, so only the Memory database is read; with no chat the export is refused by reference rules.
  await assert.rejects(exportStaticBackup(device, { backupId: "x", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT }),
    (error) => error instanceof BackupValidationError);
  assert.equal(JSON.stringify(snapshot.memory).includes("hello"), false);
});

test("a full export carries Memory and counts every row", async () => {
  const { fixture } = await pack();
  const section = fixture.manifest.domains.find((row) => row.domain === "memory")!;
  assert.equal(section.records, 5);
  const validated = await validate(fixture);
  assert.deepEqual(validated.data.memory, memoryData());
});

test("validation: sources may reference deleted messages, a deleted session only with a pending clear intent", async () => {
  await validate((await pack()).fixture); // memory-2 points at a message that no longer exists
  const data = backupData();
  data.memory.memories[0].sources = [{ sessionId: "gone-session", messageId: "m" }];
  await assert.rejects(validate((await pack(data)).fixture), (e) => e instanceof BackupValidationError && e.code === "missing-session");
  data.memory.cursors.push({ id: "peter\u0000gone-session", characterId: "peter", sessionId: "gone-session", failureCount: 0, clearRequestedAt: TEST_NOW, updatedAt: TEST_NOW });
  await validate((await pack(data)).fixture);
});

test("validation rejects malformed Memory, unknown stores, wrong version and broken references", async () => {
  const cases: [string, (data: BackupData) => void, string][] = [
    ["extra field", (d) => { Object.assign(d.memory.memories[0], { chatText: "x" }); }, "invalid-data"],
    ["unknown store", (d) => { Object.assign(d.memory, { journal: [] }); }, "invalid-data"],
    ["missing store", (d) => { delete (d.memory as Partial<BackupData["memory"]>).cursors; }, "invalid-data"],
    ["bad status", (d) => { Object.assign(d.memory.memories[0], { status: "deleted" }); }, "invalid-data"],
    ["fingerprint mismatch", (d) => { d.memory.memories[0].fingerprint = "wrong"; }, "invalid-data"],
    ["source with copied text", (d) => { Object.assign(d.memory.memories[0].sources[0], { text: "chat" }); }, "invalid-data"],
    ["duplicate id", (d) => { d.memory.memories[1].id = d.memory.memories[0].id; }, "duplicate-id"],
    ["unknown Character", (d) => { d.memory.memories[1].characterId = "nobody"; }, "missing-character"],
    ["operation id mismatch", (d) => { d.memory.operations[0].id = "peter\u00009"; }, "invalid-data"],
    ["operation of another Character", (d) => { d.memory.operations[0].characterId = "pep"; d.memory.operations[0].id = "pep\u00001"; }, "cross-character-reference"],
    ["cursor id mismatch", (d) => { d.memory.cursors[0].id = "other"; }, "invalid-data"],
    ["source in another Character's chat", (d) => { d.memory.memories[1].characterId = "pep"; }, "cross-character-reference"],
    ["source message in another session", (d) => {
      d.chat.sessions.push({ id: "character:pep", characterId: "pep", updatedAt: 0, autoReplyOnKeyboardDismiss: false, nextOrder: 1 } as never);
      d.memory.memories[1].sources = [{ sessionId: "character:pep", messageId: "user-test" }]; d.memory.memories[1].characterId = "pep";
    }, "cross-session-reference"],
  ];
  for (const [name, change, code] of cases) {
    const data = backupData(); change(data);
    const fixture = await packageFixture(data);
    await assert.rejects(validate(fixture), (e) => e instanceof BackupValidationError && e.code === code, name);
  }
  const wrongVersion = await packageFixture();
  wrongVersion.manifest.domains.find((row) => row.domain === "memory")!.version = 2;
  await assert.rejects(validate(wrongVersion), (e) => e instanceof BackupValidationError && e.code === "unsupported-domain-version");
  const tampered = await packageFixture();
  await replacePayload(tampered, "memory", { memories: [], suppressions: [], operations: [] });
  await assert.rejects(validate(tampered), (e) => e instanceof BackupValidationError);
});

test("an old-format backup is refused as unsupported before anything is written", async () => {
  const device = newDevice(), locks = locksClient(), { fixture, files } = await pack();
  const manifest = { ...fixture.manifest, version: 1 };
  await assert.rejects(restoreIntoEmpty(JSON.stringify(manifest), files, device, locks),
    (e) => e instanceof BackupValidationError && e.code === "unsupported-format");
  const preview = await previewRestore(JSON.stringify(manifest), files, device, locks);
  assert.equal(preview.mode, "blocked");
  assert.equal(preview.blockers[0].code === "backup-invalid" && preview.blockers[0].error, "unsupported-format");
  assert.deepEqual(await device.indexedDB.databases(), []);
  assert.equal(device.raw.size, 0);
});

test("an empty device restores Memory with its original ids, and a confirmed replace overwrites it", async () => {
  const device = newDevice(), locks = locksClient(), a = await pack();
  await restoreIntoEmpty(a.manifestJson, a.files, device, locks);
  const restored = await memoryRows(device);
  assert.deepEqual(restored.memories.map((row) => (row as { id: string }).id).sort(), ["memory-1", "memory-2"]);
  assert.deepEqual(restored.cursors.map((row) => (row as { id: string }).id), ["peter\u0000character:peter"]);
  // The restored database is a working Memory database (indexes included).
  const storage = new MemoryStorage(() => device.indexedDB, () => TEST_NOW, passthrough);
  assert.deepEqual((await storage.listMemories("peter")).map((row) => row.id).sort(), ["memory-1", "memory-2"]);
  assert.equal((await storage.findByFingerprint("peter", "likes tea")).length, 1);

  const data = backupData();
  data.memory = { ...memoryData(), memories: [memoryData().memories[1]], operations: [], suppressions: [] };
  const b = await pack(data);
  const confirmed = await previewRestore(b.manifestJson, b.files, device, locks);
  assert.equal(confirmed.mode, "replace-required");
  assert.deepEqual(confirmed.domains.memory, { backup: 2, current: 5 });
  await replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed });
  const replaced = await memoryRows(device);
  assert.deepEqual(replaced.memories.map((row) => (row as { id: string }).id), ["memory-2"]);
  assert.equal(replaced.operations.length, 0);
  assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
});

test("a Memory-only difference makes the target non-empty and restores identically twice", async () => {
  const device = newDevice(), locks = locksClient(), a = await pack();
  await restoreIntoEmpty(a.manifestJson, a.files, device, locks);
  const first = await digestUnits(await readStaticBackupSource(device));
  assert.notEqual(first.memory, "empty");
  const confirmed = await previewRestore(a.manifestJson, a.files, device, locks);
  await replaceWithBackup(a.manifestJson, a.files, device, locks, { confirmed });
  assert.deepEqual(await digestUnits(await readStaticBackupSource(device)), first);
});

test("an injected Memory failure rolls back and keeps the previous Memory ids; an interrupted restore resumes or rolls back", async () => {
  const locks = locksClient(), a = await pack();
  // Rolled back on an empty device.
  const empty = newDevice(), real = createUnitWriters(empty);
  await assert.rejects(restoreIntoEmpty(a.manifestJson, a.files, empty, locks, { writers: { ...real,
    memory: { ...real.memory, write: async (s) => { await real.memory.write(s); throw new Error("injected"); } } } }),
    (e) => e instanceof RestoreError && e.code === "restore-failed-rolled-back" && e.unit === "memory");
  assert.equal((await memoryRows(empty)).memories.length, 0);
  assert.equal(empty.raw.has(RESTORE_JOURNAL_KEY), false);

  for (const action of ["resume", "rollback"] as const) {
    const device = newDevice(), writers = createUnitWriters(device);
    await assert.rejects(restoreIntoEmpty(a.manifestJson, a.files, device, locks, { writers: { ...writers,
      contacts: { ...writers.contacts, write: async () => { throw new Error("injected"); } },
      memory: { ...writers.memory, clear: async () => { throw new Error("killed"); } } } }));
    assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), true);
    await recoverRestore(action, device, locks, action === "resume" ? { manifestJson: a.manifestJson, files: a.files } : null);
    assert.equal(device.raw.has(RESTORE_JOURNAL_KEY), false);
    const ids = (await memoryRows(device)).memories.map((row) => (row as { id: string }).id).sort();
    assert.deepEqual(ids, action === "resume" ? ["memory-1", "memory-2"] : []);
  }
});

test("a replace that fails after Memory landed restores the old Memory rows exactly", async () => {
  const device = newDevice(), locks = locksClient(), a = await pack();
  await restoreIntoEmpty(a.manifestJson, a.files, device, locks);
  const before = await memoryRows(device);
  const data = backupData(); data.memory = { memories: [], suppressions: [], operations: [], cursors: [] };
  data.contacts = null;
  const b = await pack(data), confirmed = await previewRestore(b.manifestJson, b.files, device, locks);
  const real = createUnitWriters(device);
  let armed = true;
  await assert.rejects(replaceWithBackup(b.manifestJson, b.files, device, locks, { confirmed, writers: { ...real,
    contacts: { ...real.contacts, write: async (s) => { if (armed) { armed = false; throw new Error("injected"); } return real.contacts.write(s); } } } }),
    (e) => e instanceof RestoreError && e.code === "restore-failed-rolled-back");
  assert.deepEqual(await memoryRows(device), before);
});

test("an unknown Memory database version or store is rejected without being touched", async () => {
  for (const [version, stores] of [[2, ["memories", "suppressions", "operations", "cursors"]], [1, ["memories", "suppressions", "operations", "cursors", "journal"]],
    [1, ["memories", "suppressions", "operations"]]] as const) {
    const device = newDevice(), locks = locksClient(), a = await pack();
    await new Promise<void>((resolve, reject) => {
      const open = device.indexedDB.open("veil-memory-v1", version);
      open.onupgradeneeded = () => { for (const name of stores) open.result.createObjectStore(name, { keyPath: "id" }); };
      open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
    });
    await assert.rejects(readStaticBackupSource(device), (e) => e instanceof BackupValidationError && e.code === "unsupported-source-schema" && e.path === "veil-memory-v1");
    const preview = await previewRestore(a.manifestJson, a.files, device, locks);
    assert.equal(preview.mode, "blocked");
    await assert.rejects(restoreIntoEmpty(a.manifestJson, a.files, device, locks));
    assert.equal(device.raw.size, 0);
  }
});

test("deleting a Character removes every Memory row it owns and leaves other Characters alone", async () => {
  const world = await buildWorld();
  const storage = world.memoryStorage;
  const row = (id: string, characterId: string) => ({ id, characterId, kind: "fact", text: `fact ${id}`, subject: "user", status: "active" as const,
    origin: "auto" as const, sources: [{ sessionId: world.ids.sessionA.id, messageId: "m" }], lineage: {} });
  await storage.applyChange(A, "add", { put: [row("a1", A), row("a2", A)], suppress: [{ id: "s1", fingerprint: "f", reason: "deleted", sources: [] }] });
  await storage.applyChange("char-bob-0002", "add", { put: [row("b1", "char-bob-0002")] });
  await storage.saveCursor(A, world.ids.sessionA.id, { processedMessageId: "m" });
  const { deleteCharacterWithData } = await import("../lib/character-deletion");
  const report = await deleteCharacterWithData({ characterId: A, commitFoundation: world.commitFoundation, deps: world.deps });
  assert.deepEqual(report.failed, []);
  assert.ok(report.completed.includes("memory"));
  assert.deepEqual([await storage.listMemories(A), await storage.listSuppressions(A), await storage.listOperations(A), await storage.listCursors(A)], [[], [], [], []]);
  assert.deepEqual((await storage.listMemories("char-bob-0002")).map((m) => m.id), ["b1"]);
  assert.equal((await storage.listOperations("char-bob-0002")).length, 1);
  await deleteCharacterMemory(storage, A); // idempotent
});

test("clearing or deleting a session saves the intent first, then runs the chat operation, then cleans up", async () => {
  const factory = new IDBFactory(), steps: string[] = [];
  const storage = new MemoryStorage(() => factory, () => 1, passthrough);
  const draft = (id: string, sessions: string[]) => ({ id, characterId: "c1", kind: "fact", text: `fact ${id}`, subject: "user", status: "active" as const,
    origin: "auto" as const, sources: sessions.map((sessionId) => ({ sessionId, messageId: "m" })), lineage: {} });
  await storage.applyChange("c1", "add", { put: [draft("only-a", ["A"]), draft("both", ["A", "B"]), draft("only-b", ["B"])] });
  const session = { id: "A", characterId: "c1", type: "direct" as const };
  const result = await withMemoryClear(session, async () => {
    steps.push(`chat:${(await storage.listCursors("c1")).map((c) => `${c.sessionId}:${c.clearRequestedAt !== undefined}`).join(",")}`);
    return "done";
  }, storage);
  assert.equal(result.value, "done"); assert.equal(result.cleanupIncomplete, false);
  assert.deepEqual(steps, ["chat:A:true"], "the intent was durable before the chat operation started");
  assert.deepEqual((await storage.listMemories("c1")).map((m) => m.id).sort(), ["both", "only-b"]);
  assert.deepEqual((await storage.getMemory("both"))!.sources, [{ sessionId: "B", messageId: "m" }]);
  assert.deepEqual(await storage.listCursors("c1"), [], "intent and cursor are gone once cleanup completed");
});

test("a failed chat operation withdraws the intent and keeps Memory; a group clears every member", async () => {
  const factory = new IDBFactory(), storage = new MemoryStorage(() => factory, () => 1, passthrough);
  const draft = (id: string, characterId: string) => ({ id, characterId, kind: "fact", text: `fact ${id}`, subject: "user", status: "active" as const,
    origin: "auto" as const, sources: [{ sessionId: "G", messageId: "m" }], lineage: {} });
  await storage.applyChange("c1", "add", { put: [draft("x1", "c1")] });
  await storage.applyChange("c2", "add", { put: [draft("x2", "c2")] });
  await storage.saveCursor("c1", "G", { processedMessageId: "m" });
  const group = { id: "G", characterId: "c1", type: "group" as const, participantIds: ["c1", "c2"] };
  await assert.rejects(withMemoryClear(group, async () => { throw new Error("chat down"); }, storage), /chat down/);
  assert.equal((await storage.listMemories("c1")).length + (await storage.listMemories("c2")).length, 2);
  const cursors = [...await storage.listCursors("c1"), ...await storage.listCursors("c2")];
  assert.deepEqual(cursors.map((c) => [c.characterId, c.processedMessageId, c.clearRequestedAt]), [["c1", "m", undefined]], "progress kept, intent withdrawn");
  await withMemoryClear(group, async () => undefined, storage);
  assert.deepEqual([await storage.listMemories("c1"), await storage.listMemories("c2")], [[], []]);
});

test("an intent that was saved but never finished survives reopening and can be cancelled", async () => {
  const factory = new IDBFactory(), storage = new MemoryStorage(() => factory, () => 1, passthrough);
  await recordClearIntent(storage, "c1", "A");
  const reopened = new MemoryStorage(() => factory, () => 2, passthrough);
  assert.equal((await reopened.listCursors("c1"))[0].clearRequestedAt, 1);
  await cancelClearIntent(reopened, "c1", "A");
  assert.deepEqual(await reopened.listCursors("c1"), []);
});

test("every restore unit has a writer and the Memory unit is ordered before Foundation", () => {
  assert.ok(RESTORE_UNITS.includes("memory"));
  assert.ok(RESTORE_UNITS.indexOf("memory") < RESTORE_UNITS.indexOf("foundation"));
});

test("a failed retry keeps a clear intent from an earlier attempt, and a failed withdrawal is reported", async () => {
  const factory = new IDBFactory(), storage = new MemoryStorage(() => factory, () => 1, passthrough);
  await recordClearIntent(storage, "c1", "A"); // earlier attempt, never finished
  const session = { id: "A", characterId: "c1", type: "direct" as const };
  await assert.rejects(withMemoryClear(session, async () => { throw new Error("chat down"); }, storage), /chat down/);
  assert.equal((await storage.listCursors("c1"))[0].clearRequestedAt, 1, "the earlier intent survives");
  // A fresh intent is withdrawn on failure; if the withdrawal itself fails the caller learns about it.
  const fresh = { id: "B", characterId: "c1", type: "direct" as const };
  await assert.rejects(withMemoryClear(fresh, async () => {
    storage.transaction = (async () => { throw new Error("storage down"); }) as never;
    throw new Error("chat down");
  }, storage), (e) => e instanceof Error && /could not be withdrawn/.test(e.message) && (e.cause as Error).message === "chat down");
});

test("cleanup failing after the chat operation succeeded is reported as incomplete and keeps the intent", async () => {
  const factory = new IDBFactory(), storage = new MemoryStorage(() => factory, () => 1, passthrough);
  const outcome = await withMemoryClear({ id: "A", characterId: "c1", type: "direct" }, async () => {
    const real = storage.transaction.bind(storage);
    storage.transaction = ((mode: IDBTransactionMode, run: never, scope?: never) => {
      if (mode === "readwrite") return Promise.reject(new Error("storage down"));
      return real(mode, run, scope);
    }) as never;
    return "cleared";
  }, storage);
  assert.deepEqual(outcome, { value: "cleared", cleanupIncomplete: true });
  Reflect.deleteProperty(storage, "transaction");
  assert.equal((await storage.listCursors("c1"))[0].clearRequestedAt, 1, "resumable");
});

test("leftovers list Characters that only own Memory, and removal counts each Character once", async () => {
  const world = await buildWorld();
  const row = { id: "g1", characterId: "ghost", kind: "fact", text: "ghost fact", subject: "user", status: "active" as const, origin: "auto" as const, sources: [], lineage: {} };
  await world.memoryStorage.applyChange("ghost", "add", { put: [row] });
  await world.memoryStorage.applyChange(B, "add", { put: [{ ...row, id: "b1", characterId: B, text: "bob fact" }] });
  const leftovers = await findLeftovers(world.foundation, world.deps);
  assert.deepEqual(leftovers.memories, [{ characterId: "ghost" }]);
  assert.deepEqual(await removeLeftovers(leftovers, world.foundation, world.deps), { removed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(await world.memoryStorage.listMemories("ghost"), []);
  assert.equal((await world.memoryStorage.listMemories(B)).length, 1, "a living Character keeps its Memory");
});
