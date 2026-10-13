import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { addManualMemory, editMemory } from "../lib/memory/bank";
import { buildMaintenanceInput, MAINTENANCE_LIMITS } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { MemoryStorage } from "../lib/memory/storage";
import { MEMORY_TEXT_CHARACTERS, type MemoryDraft } from "../lib/memory/types";
import { progressFixture } from "./memory-progress-fixture";

type Fixture = Awaited<ReturnType<typeof progressFixture>>;
const NOW = 100;
/** One prepared batch on a fresh fixture; the stub model output is a plain object, never a network call. */
async function batch<T>(body: (f: Fixture, tools: {
  parse: (operations: Record<string, unknown>[]) => ReturnType<typeof parseMaintenanceOperations>;
  commit: (put: MemoryDraft[]) => Promise<void>; snapshot: Parameters<typeof buildMaintenanceInput>[0]; ids: string[] }) => Promise<T>): Promise<T> {
  const f = await progressFixture(), a = await f.send("Please call me by the new name now"), b = await f.send("Okay, my contact says Lan");
  return (await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 2, 2, []);
    const snapshot = (await f.protocol.readInput(ticket))!;
    const parse = (operations: Record<string, unknown>[]) => parseMaintenanceOperations(JSON.stringify({ operations }), snapshot, () => "new", NOW);
    const commit = async (put: MemoryDraft[]) => {
      await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
      await f.protocol.commitAutomatic(ticket, { put });
    };
    return body(f, { parse, commit, snapshot, ids: [a.id, b.id] });
  }))!;
}
const create = (messageId: string, text: string) => ({ op: "CREATE", text, kind: "relationship", subject: "character", messageIds: [messageId] });

test("the per-memory cap is 600 characters everywhere, and the Journal keeps its own", () => {
  assert.equal(MEMORY_TEXT_CHARACTERS, 600);
  assert.equal(MAINTENANCE_LIMITS.entryCharacters, 600);
});

test("a rename-the-contact chat that the model answers with IGNORE writes nothing and is not an error", async () => {
  await batch(async (f, { parse, commit, ids }) => {
    const plan = parse([{ op: "IGNORE" }]);
    assert.deepEqual(plan.put, []);
    await commit(plan.put);
    assert.deepEqual(await f.memory.listMemories("c"), []);
    assert.deepEqual(parse([]).put, []); // An empty answer is also a valid zero-memory result.
    assert.equal(ids.length, 2);
  });
});

test("an over-long entry is dropped alone; its siblings and the request survive, and exactly 600 is accepted", async () => {
  await batch(async (f, { parse, commit, ids }) => {
    const plan = parse([create(ids[1], "x".repeat(601)), create(ids[1], "y".repeat(600))]);
    assert.equal(plan.put.length, 1);
    assert.equal(plan.put[0].text.length, 600);
    assert.deepEqual(parse([create(ids[1], "z".repeat(601))]).put, []);
    await commit(plan.put);
    assert.equal((await f.memory.listMemories("c")).length, 1);
  });
});

test("the commit gate rejects a new automatic memory over 600 characters even if the parser was bypassed", async () => {
  await batch(async (f, { parse, commit, ids }) => {
    const [good] = parse([create(ids[1], "I remember this evening.")]).put;
    await assert.rejects(commit([{ ...good, text: "q".repeat(601) }]));
    assert.deepEqual(await f.memory.listMemories("c"), []);
  });
});

test("maintenance input gives every message a time in the user's timezone and the model is told to write first person", async () => {
  await batch(async (_f, { snapshot }) => {
    const read = (timezone?: string) => JSON.parse(buildMaintenanceInput(snapshot, { characterId: "c", context: "{}", timezone }, undefined, NOW)[1].content).messages as { time: string }[];
    const utc = read(), tokyo = read("Asia/Tokyo");
    for (const m of [...utc, ...tokyo]) assert.match(m.time, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} [^\]]+\]$/);
    assert.notDeepEqual(utc.map((m) => m.time), tokyo.map((m) => m.time));
    const system = buildMaintenanceInput(snapshot, { characterId: "c", context: "{}" })[0].content;
    assert.match(system, /first person/);
    assert.match(system, /at most 600 characters/);
    assert.match(system, /an empty result is normal/);
    assert.match(system, /contact names and remarks/);
    assert.match(system, /with UPDATE; do not SUPERSEDE/);
  });
});

test("manual memories are limited to 600 characters too, and an existing manual memory can still be shortened", async () => {
  const storage = new MemoryStorage(() => new IDBFactory(), () => 1, { withWrite: (work) => work() });
  await assert.rejects(addManualMemory(storage, "c", { kind: "fact", text: "m".repeat(601) }), /at most 600/);
  await addManualMemory(storage, "c", { kind: "fact", text: "m".repeat(600) });
  const [row] = await storage.listMemories("c");
  await assert.rejects(editMemory(storage, row, { kind: "fact", text: "n".repeat(601) }), /at most 600/);
  const shorter = await editMemory(storage, row, { kind: "fact", text: "short" });
  assert.ok(shorter);
});
