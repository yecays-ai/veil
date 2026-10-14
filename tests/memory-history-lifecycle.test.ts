import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { MemoryStorage } from "../lib/memory/storage";
import type { MemoryBatchTicket } from "../lib/memory/progress";
import { addManualMemory, deleteMemory, editMemory, memoryHistoryOf } from "../lib/memory/bank";
import { completeClear, recordClearIntent } from "../lib/memory/lifecycle";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { pruneMemoryHistory } from "../lib/memory/lineage";
import { selectMaintenanceCandidates } from "../lib/memory/maintenance-input";
import { MEMORY_HISTORY_LIMIT, type Memory, type MemoryDraft } from "../lib/memory/types";
import { progressFixture } from "./memory-progress-fixture";

const src = (sessionId: string, messageId = "m") => ({ sessionId, messageId });
const draft = (id: string, sources: string[], extra: Partial<MemoryDraft> = {}): MemoryDraft => ({ id, characterId: "c", text: `fact ${id}`,
  kind: "fact", subject: "user", status: "active", origin: "auto", sources: sources.map((s) => src(s)), lineage: {}, ...extra });
const setup = () => { const factory = new IDBFactory(); return new MemoryStorage(() => factory, () => 1, { withWrite: (f) => f() }); };
const dangling = (rows: readonly Memory[]) => rows.flatMap((r) => [...(r.lineage.mergedFrom ?? []), ...(r.lineage.supersededBy ? [r.lineage.supersededBy] : [])]
  .filter((id) => !rows.some((o) => o.id === id)).map((id) => `${r.id}->${id}`));

// SUPERSEDE chain: old0 -> old1 -> head. Their only link to the head is `supersededBy`, never `mergedFrom`.
const supersedeChain = () => [
  draft("old0", ["B"], { status: "superseded", lineage: { supersededBy: "old1" } }),
  draft("old1", ["B"], { status: "superseded", lineage: { supersededBy: "head" } }),
  draft("head", ["A"]),
];

test("deleting a memory removes its whole supersede history and suppresses every earlier text", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [...supersedeChain(), draft("other", ["B"])] });
  const head = (await s.getMemory("head"))!;
  assert.deepEqual(memoryHistoryOf(head, await s.listMemories("c")).map((r) => r.id), ["old1", "old0"]);
  await deleteMemory(s, head);
  assert.deepEqual((await s.listMemories("c")).map((r) => r.id), ["other"]);
  const suppressed = new Set((await s.listSuppressions("c")).map((r) => r.fingerprint));
  for (const id of ["head", "old0", "old1"]) assert.ok(suppressed.has(memoryFingerprint(`fact ${id}`)), id);
});

test("after a delete, clearing or editing the chat of an old source neither throws, locks, nor brings old text back", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: supersedeChain() });
  await deleteMemory(s, (await s.getMemory("head"))!);
  for (const session of ["A", "B"]) {
    await recordClearIntent(s, "c", session);
    assert.deepEqual(await completeClear(s, "c", session), { isolated: 0 });
  }
  assert.deepEqual(await s.listMemories("c"), []);
  assert.deepEqual(await s.listCursors("c"), []);
});

test("undo of a delete restores the head together with its history", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: supersedeChain() });
  await deleteMemory(s, (await s.getMemory("head"))!);
  await s.undoLastOperation("c");
  assert.deepEqual((await s.listMemories("c")).map((r) => r.id).sort(), ["head", "old0", "old1"]);
  assert.deepEqual(dangling(await s.listMemories("c")), []);
});

test("a user-edited merged memory survives clearing both source chats with no flagged row or pending intent", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [
    draft("a", ["A"], { status: "superseded", lineage: { supersededBy: "m" } }), draft("b", ["B"], { status: "superseded", lineage: { supersededBy: "m" } }),
    draft("m", ["A", "B"], { lineage: { mergedFrom: ["a", "b"] } })] });
  await editMemory(s, (await s.getMemory("m"))!, { kind: "fact", text: "the user's own wording" });
  await completeClear(s, "c", "A"); await completeClear(s, "c", "B");
  const rows = await s.listMemories("c");
  assert.deepEqual(rows.map((r) => [r.id, r.origin, r.status]), [["m", "manual", "active"]]);
  assert.deepEqual(await s.listCursors("c"), []);
});

test("a superseded row whose successor is gone stays hidden: not revived, not flagged, cleanup completes", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [draft("orphan", ["B"], { status: "superseded", lineage: { supersededBy: "gone" } }), draft("touched", ["A"])] });
  await completeClear(s, "c", "A");
  const orphan = await s.getMemory("orphan");
  assert.equal(orphan?.status, "superseded"); assert.equal(await s.getMemory("touched"), undefined);
  assert.deepEqual(await s.listCursors("c"), []);
});

for (const broken of ["cycle", "unreciprocated"] as const) test(`a genuinely damaged ${broken} chain is flagged and the cleanup still finishes`, async () => {
  const s = setup();
  const rows = broken === "cycle" ? [draft("bad", ["A"], { status: "superseded", lineage: { supersededBy: "other" } }),
    draft("other", ["B"], { status: "superseded", lineage: { supersededBy: "bad" } })]
    : [draft("bad", ["A"], { lineage: { mergedFrom: ["other"] } }), draft("other", ["B"])];
  await s.applyChange("c", "seed", { put: [...rows, draft("manual", ["A"], { origin: "manual" }), draft("unrelated", ["B"])] });
  await recordClearIntent(s, "c", "A");
  const result = await completeClear(s, "c", "A");
  assert.ok(result.isolated >= 1);
  assert.equal((await s.getMemory("bad"))?.status, "flagged"); assert.equal((await s.getMemory("bad"))?.text, "fact bad");
  assert.equal((await s.getMemory("manual"))?.status, "active"); assert.equal((await s.getMemory("unrelated"))?.status, "active");
  assert.deepEqual(await s.listCursors("c"), []);
  assert.deepEqual(await completeClear(s, "c", "A"), { isolated: 0 });
});

test("a manual memory is never the target of history trimming and a mixed history is left untouched", () => {
  const row = (id: string, extra: Partial<Memory> = {}): Memory => ({ ...draft(id, ["A"]), fingerprint: id, createdAt: Number(id.slice(1)), updatedAt: 1, ...extra } as Memory);
  const rows = [row("h9", { lineage: { mergedFrom: ["h8"] } }),
    ...[8, 7, 6, 5, 4].map((n) => row(`h${n}`, { status: "superseded", lineage: { supersededBy: `h${n + 1}`, ...(n > 4 ? { mergedFrom: [`h${n - 1}`] } : {}) } }))];
  rows[rows.length - 1] = row("h4", { status: "superseded", origin: "manual", lineage: { supersededBy: "h5" } });
  assert.deepEqual(pruneMemoryHistory(rows, ["h9"], MEMORY_HISTORY_LIMIT, 10), { deleted: [], rows: [] });
});

test("an automatic UPDATE keeps at most three hidden versions and leaves every pointer resolvable", async () => {
  const f = await progressFixture(), message = await f.send(), at = { sessionId: f.session.id, messageId: message.id };
  const version = (n: number, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({ id: `v${n}`, characterId: "c", text: `fact v${n}`, kind: "fact", subject: "user",
    status: "superseded", origin: "auto", sources: [at], lineage: n ? { mergedFrom: [`v${n - 1}`], supersededBy: `v${n + 1}` } : { supersededBy: "v1" }, ...extra });
  await f.memory.applyChange("c", "seed", { put: [version(0), version(1), version(2), version(3), version(4), version(5, { status: "active", lineage: { mergedFrom: ["v4"] } })] });
  await f.protocol.withOwner("c", async (owner) => {
    const ticket: MemoryBatchTicket = await f.protocol.prepare(owner, f.session.id, 1, 1, ["v5", "v4", "v3", "v2", "v1", "v0"]);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await f.protocol.commitAutomatic(ticket, { put: [
      { ...version(5), lineage: { mergedFrom: ["v4"], supersededBy: "v6" } },
      { ...version(6, { status: "active" }), lineage: { mergedFrom: ["v5"] } }] });
  });
  const rows = await f.memory.listMemories("c");
  assert.deepEqual(rows.map((r) => r.id).sort(), ["v3", "v4", "v5", "v6"]);
  assert.deepEqual(dangling(rows), []);
  assert.equal(memoryHistoryOf(rows.find((r) => r.id === "v6")!, rows).length, MEMORY_HISTORY_LIMIT);
  // The next maintenance run must still be able to build candidates from this lineage.
  assert.deepEqual(selectMaintenanceCandidates("c", rows, "").ids.sort(), ["v3", "v4", "v5", "v6"]);
});

test("a manual add and delete never touch other memories' history", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [...supersedeChain(), draft("keep-old", ["B"], { status: "superseded", lineage: { supersededBy: "keep" } }), draft("keep", ["B"])] });
  await addManualMemory(s, "c", { kind: "fact", text: "manual one" });
  await deleteMemory(s, (await s.getMemory("head"))!);
  assert.deepEqual((await s.listMemories("c")).map((r) => r.id).filter((id) => id.startsWith("keep")).sort(), ["keep", "keep-old"]);
});
