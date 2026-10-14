import assert from "node:assert/strict";
import test from "node:test";
import { IDBObjectStore } from "fake-indexeddb";
import { progressFixture } from "./memory-progress-fixture";
import { rehearseMaintenance } from "./memory-maintenance-rehearsal";
import { buildMaintenanceInput, MaintenanceInputTooLarge, selectMaintenanceCandidates } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { createMaintenanceDiagnostics } from "../lib/memory/maintenance-diagnostics";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { completeClear } from "../lib/memory/lifecycle";
import type { Memory, MemoryDraft } from "../lib/memory/types";

const seed = (id: string, sessionId: string, messageId: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({
  id, characterId: "c", text: `fact ${id}`, kind: "fact", subject: "character", status: "active", origin: "auto",
  sources: [{ sessionId, messageId }], lineage: {}, ...extra });

for (const status of ["archived", "flagged"] as const) test(`automatic ${status} is restricted, preserves manual/suppression/undo and lineage`, async () => {
  const f = await progressFixture(), m = await f.send();
  const old = seed("old", f.session.id, m.id), manual = seed("manual", f.session.id, m.id, { origin: "manual" });
  await f.memory.applyChange("c", "seed", { put: [old, manual] });
  const ops = await f.memory.listOperations("c"), suppression = await f.memory.listSuppressions("c");
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1, ["old"]);
    await f.protocol.claim(t, 1); await f.protocol.transition(t, "in-flight"); await f.protocol.transition(t, "commit-pending");
    await assert.rejects(f.protocol.commitAutomatic(t, { put: [{ ...old, status, text: "changed" }] }));
    await assert.rejects(f.protocol.commitAutomatic(t, { put: [{ ...manual, status }] }));
    await f.protocol.commitAutomatic(t, { put: [{ ...old, status }] });
  });
  assert.equal((await f.memory.getMemory("old"))?.status, status);
  assert.deepEqual((await f.memory.getMemory("old"))?.lineage, old.lineage);
  assert.equal((await f.memory.getMemory("manual"))?.status, "active");
  assert.deepEqual(await f.memory.listOperations("c"), ops); assert.deepEqual(await f.memory.listSuppressions("c"), suppression);
});

for (const match of ["source", "fingerprint"] as const) test(`automatic submission rejects ${match} suppression added after input capture`, async () => {
  const f = await progressFixture(), m = await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1);
    await f.protocol.readInput(t); await f.protocol.claim(t, 1); await f.protocol.transition(t, "in-flight"); await f.protocol.transition(t, "commit-pending");
    await f.memory.applyChange("c", "delete", { suppress: [{ id: "s", fingerprint: match === "source" ? "different" : memoryFingerprint("new fact"), reason: "deleted",
      sources: match === "source" ? [{ sessionId: f.session.id, messageId: m.id }] : [] }] });
    const ops = await f.memory.listOperations("c"), suppressions = await f.memory.listSuppressions("c");
    await assert.rejects(f.protocol.commitAutomatic(t, { put: [seed("new", f.session.id, m.id, { text: "new fact" })] }));
    assert.equal(await f.memory.getMemory("new"), undefined); assert.equal((await f.progress())?.throughSeq, 0);
    assert.deepEqual(await f.memory.listOperations("c"), ops); assert.deepEqual(await f.memory.listSuppressions("c"), suppressions);
  });
});

test("empty completion requires genuine holes, does not claim or dispatch and rolls back a failed cursor write", async () => {
  const f = await progressFixture(), m = await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1);
    await assert.rejects(f.protocol.completeEmpty(t));
    await f.chat.deleteMessages(f.session.id, [m.id]);
    const empty = await f.protocol.refresh(t);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "cursors" && value.extraction?.throughSeq === 1) throw new Error("injected cursor failure");
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    try { await assert.rejects(f.protocol.completeEmpty(empty)); } finally { IDBObjectStore.prototype.put = put; }
    assert.equal((await f.progress())?.throughSeq, 0); assert.equal((await f.progress())?.batches[0].attempts, 0);
    await f.protocol.completeEmpty(empty); assert.equal((await f.progress())?.throughSeq, 1);
    await f.protocol.completeEmpty(empty);
    assert.deepEqual(await f.memory.listMemories("c"), []);
  });
});

for (const op of ["CREATE", "UPDATE", "SUPERSEDE", "MERGE", "REINFORCE", "ARCHIVE", "FLAG", "IGNORE"]) {
  test(`parsed ${op} applies atomically through the restricted route and source cleanup preserves valid lineage`, async () => {
    const f = await progressFixture(), first = await f.send("old evidence"), second = await f.send("new evidence");
    await f.memory.applyChange("c", "seed", { put: [seed("old", f.session.id, first.id), seed("other", f.session.id, first.id)] });
    const operations = await f.memory.listOperations("c");
    await f.protocol.withOwner("c", async (owner) => {
      const t = await f.protocol.prepare(owner, f.session.id, 2, 2, ["old", "other"]);
      const snapshot = await f.protocol.readInput(t);
      const value = op === "IGNORE" ? { op } : { op, messageIds: [second.id],
        ...(["CREATE", "UPDATE", "SUPERSEDE", "MERGE"].includes(op) ? { text: "A new remembered fact", kind: "fact", subject: "character" } : {}),
        ...(op === "MERGE" ? { targetIds: ["old", "other"] } : op === "CREATE" ? {} : { targetId: "old" }) };
      const plan = parseMaintenanceOperations(JSON.stringify({ operations: [value] }), snapshot, () => "fresh");
      await f.protocol.claim(t, 1); await f.protocol.transition(t, "in-flight"); await f.protocol.transition(t, "commit-pending");
      await f.protocol.commitAutomatic(t, { put: plan.put });
      assert.deepEqual(await f.memory.listOperations("c"), operations);
      assert.deepEqual((await f.progress())?.completed, [[2, 2]], "later completed range cannot skip earlier evidence");
    });
    if (op === "UPDATE") {
      assert.deepEqual((await f.memory.getMemory("fresh"))?.sources, [{ sessionId: f.session.id, messageId: first.id }, { sessionId: f.session.id, messageId: second.id }]);
      assert.deepEqual((await f.memory.getMemory("fresh"))?.lineage.mergedFrom, ["old"]);
      await completeClear(f.memory, "c", f.session.id, new Set([second.id]));
      assert.equal(await f.memory.getMemory("fresh"), undefined);
      assert.equal((await f.memory.getMemory("old"))?.status, "active");
    } else if (op === "SUPERSEDE") {
      assert.deepEqual((await f.memory.getMemory("fresh"))?.sources, [{ sessionId: f.session.id, messageId: second.id }]);
      assert.equal((await f.memory.getMemory("fresh"))?.lineage.mergedFrom, undefined);
      await completeClear(f.memory, "c", f.session.id, new Set([second.id]));
      assert.equal(await f.memory.getMemory("fresh"), undefined);
      assert.equal((await f.memory.getMemory("old"))?.status, "active");
    } else if (op === "MERGE") {
      assert.deepEqual((await f.memory.getMemory("fresh"))?.lineage.mergedFrom, ["old", "other"]);
      await completeClear(f.memory, "c", f.session.id, new Set([second.id]));
      assert.equal(await f.memory.getMemory("fresh"), undefined);
      assert.equal((await f.memory.getMemory("old"))?.status, "active");
      assert.equal((await f.memory.getMemory("other"))?.status, "active");
    } else if (op === "REINFORCE") {
      await completeClear(f.memory, "c", f.session.id, new Set([second.id]));
      assert.deepEqual((await f.memory.getMemory("old"))?.sources, [{ sessionId: f.session.id, messageId: first.id }]);
    } else if (op === "ARCHIVE" || op === "FLAG") {
      assert.equal((await f.memory.getMemory("old"))?.status, op === "ARCHIVE" ? "archived" : "flagged");
    }
  });
}

test("verified input rejects edited evidence; construction rejects secrets, cross Character and whole oversize input", async () => {
  const f = await progressFixture(), m = await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(t);
    assert.throws(() => buildMaintenanceInput(snapshot, { characterId: "other", context: "" }));
    assert.throws(() => buildMaintenanceInput(snapshot, { characterId: "c", context: "" }, 5), MaintenanceInputTooLarge);
    // A secret in any field is redacted locally and never fails the request or reaches the model.
    const redacted = buildMaintenanceInput(snapshot, { characterId: "c", context: "password: hunter2xyz" }).map((turn) => turn.content).join("\n");
    assert.ok(!redacted.includes("hunter2xyz") && redacted.includes("[redacted]"));
    await f.chat.editMessage(m.id, "changed"); await assert.rejects(f.protocol.readInput(t));
  });
});

test("maintenance candidates use all small active auto sets beyond five, or a deterministic bounded local set", () => {
  const rows: Memory[] = Array.from({ length: 12 }, (_, i) => ({ ...seed(String(i), "s", "m", { text: i < 6 ? "orchid rescue cat" : "cooking pasta" }),
    fingerprint: String(i), createdAt: 1, updatedAt: 1 }));
  assert.equal(selectMaintenanceCandidates("c", rows, "orchid").ids.length, 12);
  const result = selectMaintenanceCandidates("c", rows, "orchid", 300);
  assert.equal(result.mode, "limited"); assert.ok(result.ids.length > 0 && result.ids.length < 6);
  assert.deepEqual(result, selectMaintenanceCandidates("c", [...rows].reverse(), "orchid", 300));
  assert.deepEqual(selectMaintenanceCandidates("c", rows, "unrelated", 300).ids, []);
  assert.deepEqual(selectMaintenanceCandidates("other", rows, "orchid").ids, []);
});

test("merged active candidates carry protected lineage dependencies for subsequent UPDATE", async () => {
  const f = await progressFixture(), first = await f.send("first"), second = await f.send("second"), third = await f.send("later development");
  await f.memory.applyChange("c", "seed", { put: [
    seed("a", f.session.id, first.id, { status: "superseded", lineage: { supersededBy: "merged" } }),
    seed("b", f.session.id, second.id, { status: "superseded", lineage: { supersededBy: "merged" } }),
    seed("merged", f.session.id, first.id, { sources: [{ sessionId: f.session.id, messageId: first.id }, { sessionId: f.session.id, messageId: second.id }], lineage: { mergedFrom: ["a", "b"] } }),
  ] });
  const candidates = selectMaintenanceCandidates("c", await f.memory.listMemories("c"), "later development");
  assert.deepEqual(new Set(candidates.ids), new Set(["a", "b", "merged"]));
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 3, 3, candidates.ids), snapshot = await f.protocol.readInput(t);
    const payload = JSON.parse(buildMaintenanceInput(snapshot, { characterId: "c", context: "" })[1].content);
    assert.deepEqual(payload.candidates.map((r: { id: string }) => r.id), ["merged"]);
    assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [{ op: "ARCHIVE", targetId: "a", messageIds: [third.id] }] }), snapshot));
    const plan = parseMaintenanceOperations(JSON.stringify({ operations: [{ op: "UPDATE", targetId: "merged", text: "Later development", kind: "fact", subject: "character", messageIds: [third.id] }] }), snapshot, () => "new");
    await f.protocol.claim(t, 1); await f.protocol.transition(t, "in-flight"); await f.protocol.transition(t, "commit-pending");
    await f.protocol.commitAutomatic(t, { put: plan.put });
  });
  await completeClear(f.memory, "c", f.session.id, new Set([third.id]));
  assert.equal((await f.memory.getMemory("merged"))?.status, "active");
  assert.equal((await f.memory.getMemory("a"))?.status, "superseded");
});

test("operation parser accepts every permitted operation and rejects forged IDs, sources, unknown fields and invalid structure", async () => {
  const f = await progressFixture(), m = await f.send();
  await f.memory.applyChange("c", "seed", { put: [seed("old", f.session.id, m.id), seed("other", f.session.id, m.id)] });
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1, ["old", "other"]), s = await f.protocol.readInput(t);
    const common = { text: "A different fact", kind: "event", subject: "character", messageIds: [m.id] };
    for (const op of ["CREATE", "UPDATE", "SUPERSEDE", "MERGE", "REINFORCE", "ARCHIVE", "FLAG", "IGNORE"]) {
      const value = op === "IGNORE" ? { op } : { op, messageIds: [m.id],
        ...(["CREATE", "UPDATE", "SUPERSEDE", "MERGE"].includes(op) ? common : {}),
        ...(op === "MERGE" ? { targetIds: ["old", "other"] } : op === "CREATE" ? {} : { targetId: "old" }) };
      assert.ok(parseMaintenanceOperations(JSON.stringify({ operations: [value] }), s, () => "new"));
    }
    for (const value of [{ op: "DELETE", targetId: "old" }, { op: "CREATE", ...common, id: "rogue" },
      { op: "CREATE", ...common, messageIds: ["fake"] }, { op: "FLAG", targetId: "unknown", messageIds: [m.id] },
      { op: "CREATE", ...common, kind: "state" }, { op: "CREATE", ...common, characterId: "other" }])
      assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [value] }), s));
    assert.throws(() => parseMaintenanceOperations("not JSON", s));
    assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: Array.from({ length: 21 }, () => ({ op: "IGNORE" })) }), s));
  });
});

test("parser discards manual conflicts, duplicate facts, secrets and source suppression without touching authority", async () => {
  const f = await progressFixture(), m = await f.send();
  await f.memory.applyChange("c", "manual", { put: [seed("manual", f.session.id, m.id, { text: "My family matters", origin: "manual" })] });
  await f.protocol.withOwner("c", async (owner) => {
    const t = await f.protocol.prepare(owner, f.session.id, 1, 1), s = await f.protocol.readInput(t);
    const value = (text: string) => ({ op: "CREATE", text, kind: "fact", subject: "character", messageIds: [m.id] });
    const result = parseMaintenanceOperations(JSON.stringify({ operations: [value("My family matters!"), value("api_key: private"),
      { op: "FLAG", targetId: "manual", messageIds: [m.id] }] }), s);
    assert.equal(result.discarded, 3); assert.deepEqual(result.put, []);
    s.suppressions.push({ id: "s", characterId: "c", fingerprint: memoryFingerprint("different"), reason: "deleted",
      sources: [{ sessionId: f.session.id, messageId: m.id }], createdAt: 1 });
    assert.equal(parseMaintenanceOperations(JSON.stringify({ operations: [value("paraphrased")] }), s).discarded, 1);
  });
});

test("stub rehearsal runs preparation, parse, commit and failure paths in fresh fake databases without network", async () => {
  const formal = await progressFixture(), saved = await formal.send("formal data must remain unchanged");
  await formal.memory.applyChange("c", "formal manual", { put: [seed("formal", formal.session.id, saved.id, { origin: "manual" })] });
  const before = await formal.memory.listMemories("c"), undo = await formal.memory.listOperations("c");
  const fetch = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw new Error("forbidden network"); };
  try {
    const good = JSON.stringify({ operations: [{ op: "CREATE", text: "Adopted a rescue cat", kind: "event", subject: "character", messageIds: ["$MESSAGE"] }] });
    const committed = await rehearseMaintenance(good);
    assert.equal(committed.stubCalls, 1); assert.equal(committed.memories.length, 1); assert.equal(committed.progress?.throughSeq, 1);
    assert.equal((await rehearseMaintenance("invalid")).progress?.batches[0].state, "failed");
    assert.equal((await rehearseMaintenance(new Error("scripted failure"))).progress?.batches[0].state, "failed");
    const failed = await rehearseMaintenance(good, async (f) => {
      const snapshot = await f.snapshot(); await f.chat.editMessage(snapshot.messages[0].id, "changed before commit");
    });
    assert.equal(failed.memories.length, 0); assert.equal(failed.progress?.throughSeq, 0);
    assert.equal(failed.diagnostics.at(-1)?.outcome, "commit-failed");
    assert.equal(network, 0);
    assert.deepEqual(await formal.memory.listMemories("c"), before);
    assert.deepEqual(await formal.memory.listOperations("c"), undo);
    assert.equal(await formal.progress(), undefined);
  } finally { globalThis.fetch = fetch; }
});

test("diagnostics are bounded, numeric-only RAM records and disabled outside explicit dev use", () => {
  const trace = createMaintenanceDiagnostics(true), value = { outcome: "prepared" as const, messageCount: 1, candidateCount: 2,
    inputCharacters: 3, operationCount: 4, discarded: 0, durationMs: 5 };
  for (let i = 0; i < 25; i++) trace.record({ ...value, text: "secret" } as typeof value);
  assert.equal(trace.read().length, 20); assert.ok(!JSON.stringify(trace.read()).includes("secret"));
  const disabled = createMaintenanceDiagnostics(false); disabled.record(value); assert.deepEqual(disabled.read(), []);
});
