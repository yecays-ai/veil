import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { MemoryStorage } from "../lib/memory/storage";
import { completeClear, recordClearIntent } from "../lib/memory/lifecycle";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import type { MemoryDraft } from "../lib/memory/types";

const src = (sessionId: string, messageId = "m") => ({ sessionId, messageId });
const draft = (id: string, sources: string[], extra: Partial<MemoryDraft> = {}): MemoryDraft => ({ id, characterId: "c", text: `fact ${id}`,
  kind: "fact", subject: "user", status: "active", origin: "auto", sources: sources.map((id) => src(id)), lineage: {}, ...extra });
const setup = () => { const factory = new IDBFactory(); return new MemoryStorage(() => factory, () => 1, { withWrite: (f) => f() }); };

test("multi-layer merges unwind to independent originals", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [
    draft("a", ["A"], { status: "superseded", lineage: { supersededBy: "inner" } }),
    draft("b", ["B"], { status: "superseded", lineage: { supersededBy: "inner" } }),
    draft("inner", ["A", "B"], { status: "superseded", lineage: { mergedFrom: ["a", "b"], supersededBy: "outer" } }),
    draft("c", ["C"], { status: "superseded", lineage: { supersededBy: "outer" } }),
    draft("outer", ["A", "B", "C"], { lineage: { mergedFrom: ["inner", "c"] } }),
  ] });
  await completeClear(s, "c", "A");
  assert.deepEqual((await s.listMemories("c")).map((m) => [m.id, m.status]).sort(), [["b", "active"], ["c", "active"]]);
  await completeClear(s, "c", "B"); assert.deepEqual((await s.listMemories("c")).map((m) => m.id), ["c"]);
});

test("UPDATE predecessor survives partial deletion and restores its original archived status", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [
    draft("old", ["B"], { status: "superseded", lineage: { supersededBy: "middle", previousStatus: "archived" } }),
    draft("middle", ["A"], { status: "superseded", lineage: { supersededBy: "last", previousStatus: "active" } }), draft("last", ["C"]),
  ] });
  await completeClear(s, "c", "A");
  assert.equal((await s.getMemory("old"))?.status, "superseded"); assert.equal((await s.getMemory("old"))?.lineage.supersededBy, "last");
  await completeClear(s, "c", "C"); assert.equal((await s.getMemory("old"))?.status, "archived");
});

test("REINFORCE removes only deleted evidence without changing a remaining fact", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [draft("reinforced", ["A", "B"])] });
  const before = await s.getMemory("reinforced"); await completeClear(s, "c", "A");
  const after = await s.getMemory("reinforced"); assert.equal(after?.text, before?.text); assert.deepEqual(after?.sources, [src("B")]);
});

test("suppression and manual authority prevent predecessor resurrection", async () => {
  for (const protectedBy of ["suppression", "manual"] as const) {
    const s = setup(); await s.applyChange("c", "seed", { put: [
      draft("old", ["B"], { status: "superseded", lineage: { supersededBy: "new" } }), draft("new", ["A"]),
      ...(protectedBy === "manual" ? [draft("manual", ["A"], { origin: "manual" as const, text: "fact old" })] : []),
    ], ...(protectedBy === "suppression" ? { suppress: [{ id: "s", fingerprint: memoryFingerprint("fact old"), reason: "deleted" as const, sources: [src("A"), src("B")] }] } : {}) });
    await completeClear(s, "c", "A"); assert.equal((await s.getMemory("old"))?.status, "superseded");
    if (protectedBy === "manual") assert.equal((await s.getMemory("manual"))?.origin, "manual");
    else assert.deepEqual((await s.listSuppressions("c"))[0].sources, [src("B")]);
  }
});

for (const broken of ["missing", "cycle", "unreciprocated"] as const) test(`damaged ${broken} chain is quarantined with intent retained`, async () => {
  const s = setup();
  const rows = broken === "missing" ? [draft("bad", ["A"], { lineage: { mergedFrom: ["missing"] } })]
    : broken === "cycle" ? [draft("bad", ["A"], { status: "superseded", lineage: { supersededBy: "other" } }),
      draft("other", ["B"], { status: "superseded", lineage: { supersededBy: "bad" } })]
      : [draft("bad", ["A"], { lineage: { mergedFrom: ["other"] } }), draft("other", ["B"] )];
  await s.applyChange("c", "seed", { put: [...rows, draft("manual", ["A"], { origin: "manual" }), draft("unrelated", ["B"])] });
  await recordClearIntent(s, "c", "A"); await assert.rejects(completeClear(s, "c", "A"), /damaged chain/);
  assert.equal((await s.getMemory("bad"))?.status, "flagged"); assert.equal((await s.getMemory("bad"))?.text, "fact bad");
  assert.equal((await s.getMemory("manual"))?.status, "active"); assert.equal((await s.getMemory("unrelated"))?.status, "active");
  assert.notEqual((await s.listCursors("c"))[0].clearRequestedAt, undefined);
  await assert.rejects(completeClear(s, "c", "A"), /damaged chain/);
});

test("targeted source deletion preserves newer evidence and other Characters", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [draft("same-session", [], { sources: [src("A", "old"), src("A", "new")] })] });
  await s.applyChange("other", "seed", { put: [{ ...draft("other", ["A"]), characterId: "other" }] });
  await completeClear(s, "c", "A", new Set(["old"]));
  assert.deepEqual((await s.getMemory("same-session"))?.sources, [src("A", "new")]); assert.equal((await s.getMemory("other"))?.status, "active");
});

test("manual authority survives historical dangling lineage without blocking cleanup", async () => {
  const s = setup(); await s.applyChange("c", "seed", { put: [draft("manual", ["A", "B"], { origin: "manual", lineage: { mergedFrom: ["gone"] } })] });
  await completeClear(s, "c", "A"); await completeClear(s, "c", "B");
  assert.equal((await s.getMemory("manual"))?.status, "active"); assert.deepEqual((await s.getMemory("manual"))?.sources, []);
  assert.deepEqual(await s.listCursors("c"), []);
});
