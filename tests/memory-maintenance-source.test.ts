import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BackupLockManager } from "../lib/backup/coordination";
import { RESTORE_JOURNAL_KEY, restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { completeClear } from "../lib/memory/lifecycle";
import { buildMaintenanceInput, selectMaintenanceCandidates } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { MemoryStorage, request } from "../lib/memory/storage";
import type { Memory, MemoryDraft, MemorySource } from "../lib/memory/types";
import { backupData, packageFixture, TEST_NOW } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";
import { progressFixture } from "./memory-progress-fixture";

type Fixture = Awaited<ReturnType<typeof progressFixture>>;
const draft = (id: string, sessionId: string, messageIds: string[], text: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({
  id, characterId: "c", text, kind: "fact", subject: "user", status: "active", origin: "auto",
  sources: messageIds.map((messageId) => ({ sessionId, messageId })), lineage: {}, ...extra });

/** Runs one batch through the real parser and the real automatic commit path (stub model output, no network). */
async function applyBatch(f: Fixture, seq: number, candidateIds: string[], operation: Record<string, unknown>, newId = "new") {
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, seq, seq, candidateIds);
    const snapshot = await f.protocol.readInput(ticket);
    const plan = parseMaintenanceOperations(JSON.stringify({ operations: [operation] }), snapshot, () => newId);
    await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await f.protocol.commitAutomatic(ticket, { put: plan.put });
  });
}
const clear = (f: Fixture, ...ids: string[]) => completeClear(f.memory, "c", f.session.id, new Set(ids));
const view = async (f: Fixture) => (await f.memory.listMemories("c")).map((m) => `${m.id}:${m.status}:${m.sources.map((s) => s.messageId).join("+")}`).sort();

/** Messages A (initial claim), B (partial correction), C (independent later confirmation). */
async function rats() {
  const f = await progressFixture(), a = await f.send("I have three rats: White, Black, Gray"),
    b = await f.send("Gray is actually called Silver"), c = await f.send("The rats are doing fine, all three");
  await f.memory.applyChange("c", "seed", { put: [draft("old", f.session.id, [a.id], "The user has three rats named White, Black and Gray.")] });
  const update = { op: "UPDATE", targetId: "old", text: "The user has three rats named White, Black and Silver.", kind: "fact", subject: "user", messageIds: [b.id] };
  return { f, a: a.id, b: b.id, c: c.id, update };
}

test("UPDATE inherits the old sources and registers the old row; SUPERSEDE keeps only its own evidence", async () => {
  const { f, a, b, update } = await rats();
  await applyBatch(f, 2, ["old"], update);
  const row = await f.memory.getMemory("new");
  assert.deepEqual(row?.sources.map((s) => s.messageId), [a, b]);
  assert.deepEqual(row?.lineage.mergedFrom, ["old"]);
  assert.equal((await f.memory.getMemory("old"))?.status, "superseded");
  const other = await rats();
  await applyBatch(other.f, 2, ["old"], { ...other.update, op: "SUPERSEDE" });
  const replaced = await other.f.memory.getMemory("new");
  assert.deepEqual(replaced?.sources.map((s) => s.messageId), [other.b]);
  assert.equal(replaced?.lineage.mergedFrom, undefined);
});

test("partial correction: deleting the correction restores the old fact, deleting the original leaves no stale text", async () => {
  const fixed = await rats();
  await applyBatch(fixed.f, 2, ["old"], fixed.update);
  await clear(fixed.f, fixed.b);
  assert.deepEqual(await view(fixed.f), [`old:active:${fixed.a}`], "the correction is gone and the earlier fact is back");
  const original = await rats();
  await applyBatch(original.f, 2, ["old"], original.update);
  await clear(original.f, original.a);
  assert.deepEqual(await view(original.f), [], "the corrected text depends on A, so neither version survives; the conservative result");
});

test("REINFORCE with an independent source, then UPDATE: each deleted source unwinds only what depends on it", async () => {
  for (const [deleted, expected] of [["c", (ids: { a: string; b: string; c: string }) => [`old:active:${ids.a}`]],
    ["b", (ids: { a: string; b: string; c: string }) => [`old:active:${ids.a}+${ids.c}`]],
    ["a", (ids: { a: string; b: string; c: string }) => [`old:active:${ids.c}`]]] as const) {
    const t = await rats();
    await applyBatch(t.f, 3, ["old"], { op: "REINFORCE", targetId: "old", messageIds: [t.c] });
    assert.deepEqual((await t.f.memory.getMemory("old"))?.sources.map((s) => s.messageId), [t.a, t.c]);
    await applyBatch(t.f, 2, ["old"], t.update);
    assert.deepEqual((await t.f.memory.getMemory("new"))?.sources.map((s) => s.messageId), [t.a, t.c, t.b]);
    await clear(t.f, t[deleted]);
    assert.deepEqual(await view(t.f), expected(t), `deleting ${deleted}`);
  }
});

test("MERGE keeps unwinding on any contributing source, and manual memories are never targeted or removed", async () => {
  const f = await progressFixture(), a = await f.send("tea"), b = await f.send("night"), c = await f.send("later");
  await f.memory.applyChange("c", "seed", { put: [draft("x", f.session.id, [a.id], "likes tea"), draft("y", f.session.id, [b.id], "drinks at night"),
    draft("manual", f.session.id, [a.id], "Tea matters to me", { origin: "manual" })] });
  await applyBatch(f, 3, ["x", "y"], { op: "MERGE", targetIds: ["x", "y"], text: "likes tea at night", kind: "fact", subject: "user", messageIds: [c.id] });
  await clear(f, a.id);
  assert.deepEqual(await view(f), ["manual:active:", `y:active:${b.id}`].sort());
  assert.equal((await f.memory.getMemory("manual"))?.text, "Tea matters to me", "manual text stays; only its source link to the cleared chat is dropped");
  const t = await rats();
  await t.f.memory.applyChange("c", "m", { put: [draft("man", t.f.session.id, [t.a], "Manual rats note", { origin: "manual" })] });
  await t.f.protocol.withOwner("c", async (owner) => {
    const ticket = await t.f.protocol.prepare(owner, t.f.session.id, 2, 2, ["old"]), snapshot = await t.f.protocol.readInput(ticket);
    const result = parseMaintenanceOperations(JSON.stringify({ operations: [{ ...t.update, targetId: "man" }] }), snapshot, () => "new");
    assert.equal(result.discarded, 1); assert.deepEqual(result.put, []);
  });
});

test("cross-session sources: clearing either session unwinds an UPDATE the same way", async () => {
  const src = (sessionId: string, messageId: string): MemorySource => ({ sessionId, messageId });
  const row = (id: string, text: string, status: Memory["status"], sources: MemorySource[], lineage: Memory["lineage"]): Memory =>
    ({ id, characterId: "c", kind: "fact", text, subject: "user", status, origin: "auto", sources, lineage, fingerprint: memoryFingerprint(text), createdAt: 1, updatedAt: 1 });
  for (const [session, expected] of [["s1", []], ["s2", ["o:active:[s1/A]"]]] as const) {
    const f = await progressFixture();
    await f.memory.transaction("readwrite", async (tx) => {
      await request(tx.store("memories").put(row("o", "v1", "superseded", [src("s1", "A")], { supersededBy: "n", previousStatus: "active" })));
      await request(tx.store("memories").put(row("n", "v2", "active", [src("s1", "A"), src("s2", "B")], { mergedFrom: ["o"] })));
    });
    await f.memory.withExclusive((scope) => completeClear(f.memory, "c", session, undefined, scope));
    assert.deepEqual((await f.memory.listMemories("c")).map((m) => `${m.id}:${m.status}:[${m.sources.map((s) => `${s.sessionId}/${s.messageId}`)}]`), expected);
  }
});

test("a legacy UPDATE row (no mergedFrom) is left as it is; new rules only apply to new records", async () => {
  const f = await progressFixture(), a = await f.send("A"), b = await f.send("B");
  await f.memory.applyChange("c", "seed", { put: [
    draft("o", f.session.id, [a.id], "v1", { status: "superseded", lineage: { supersededBy: "n" } }),
    draft("n", f.session.id, [b.id], "v2") ] });
  await clear(f, a.id);
  assert.deepEqual(await view(f), [`n:active:${b.id}`]);
});

test("candidate budget counts only the active rows sent to the model; hidden originals stay as authorization", () => {
  const row = (id: string, status: Memory["status"], text: string, lineage: Memory["lineage"]): Memory => ({ id, characterId: "c", kind: "fact", text,
    subject: "user", status, origin: "auto", sources: [{ sessionId: "s", messageId: id }], lineage, fingerprint: id, createdAt: 1, updatedAt: 1 });
  const rows = [row("o", "superseded", "x".repeat(300), { supersededBy: "n", previousStatus: "active" }), row("n", "active", "y".repeat(300), { mergedFrom: ["o"] })];
  const activeOnly = JSON.stringify({ id: "n", kind: "fact", subject: "user", text: "y".repeat(300), status: "active" }).length;
  const fits = selectMaintenanceCandidates("c", rows, "anything", activeOnly);
  assert.equal(fits.mode, "all"); assert.deepEqual(new Set(fits.ids), new Set(["o", "n"]));
  assert.equal(selectMaintenanceCandidates("c", rows, "anything", activeOnly - 1).mode, "limited");
  const inherited = [rows[0], { ...rows[1], sources: Array.from({ length: 50 }, (_, i) => ({ sessionId: "s", messageId: `m${i}` })) }];
  assert.equal(selectMaintenanceCandidates("c", inherited, "anything", activeOnly).mode, "all", "inherited sources are not sent, so they do not use the budget");
});

test("the model prompt checks state changes before IGNORE and keeps role-speech and source rules", async () => {
  const f = await progressFixture(), m = await f.send("hello");
  await f.protocol.withOwner("c", async (owner) => {
    const snapshot = await f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 1, 1, []));
    const prompt = buildMaintenanceInput(snapshot, { characterId: "c", context: "" })[0].content;
    assert.ok(prompt.indexOf("changed, ended or was replaced") < prompt.indexOf("IGNORE when nothing above applies"));
    for (const phrase of ["if unsure use UPDATE", "Never CREATE what a candidate already covers", "for other operations, every messageId you cite must itself state or confirm the memory",
      "Character's world, settings and conversation context", "never to avoid deciding", "stable interaction pattern"])
      assert.ok(prompt.includes(phrase), phrase);
    assert.doesNotMatch(prompt, /\bPeter\b|\bMiles\b/, "no hard-coded Character names");
  });
  assert.ok(m);
});

test("backup round trip keeps the UPDATE lineage and sources, and cleanup still unwinds after a restore", async () => {
  const raw = new Map<string, string>();
  const device: RestoreDevice = { indexedDB: new IDBFactory(), localStorage: { getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); } } };
  const mk = (id: string, text: string, status: Memory["status"], messageIds: string[], lineage: Memory["lineage"]): Memory => ({ id, characterId: "peter", kind: "fact",
    text, subject: "user", status, origin: "auto", sources: messageIds.map((messageId) => ({ sessionId: "character:peter", messageId })), lineage,
    fingerprint: memoryFingerprint(text), createdAt: TEST_NOW, updatedAt: TEST_NOW });
  const rows = [mk("old", "Three rats", "superseded", ["gone-a"], { supersededBy: "new", previousStatus: "active" }),
    mk("new", "Three rats, one named Silver", "active", ["gone-a", "gone-b"], { mergedFrom: ["old"] })];
  const data = backupData(); data.memory = { memories: rows, suppressions: [], operations: [], cursors: [], backgrounds: [], states: [] };
  const fixture = await packageFixture(data);
  await restoreIntoEmpty(JSON.stringify(fixture.manifest), fixture.files, device, lockOrigin().client() as unknown as BackupLockManager);
  assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  const restored = (await readStaticBackupSource(device)).memory.memories as Memory[];
  assert.deepEqual(restored.slice().sort((x, y) => x.id < y.id ? -1 : 1), rows.slice().sort((x, y) => x.id < y.id ? -1 : 1));
  const gate = createPersistenceWriteGate(() => lockOrigin().client(), () => ({ getItem: (key) => raw.get(key) ?? null }));
  const storage = new MemoryStorage(() => device.indexedDB, () => TEST_NOW, gate);
  await storage.withExclusive((scope) => completeClear(storage, "peter", "character:peter", new Set(["gone-b"]), scope));
  assert.deepEqual((await storage.listMemories("peter")).map((m) => `${m.id}:${m.status}`), ["old:active"]);
});
