import assert from "node:assert/strict";
import test from "node:test";
import { BackupValidationError } from "../lib/backup/format";
import { validateBackupPackage } from "../lib/backup/validation";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { buildMaintenanceInput, selectMaintenanceCandidates } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { ONGOING_REVIEW, ongoingDue } from "../lib/memory/ongoing";
import type { Memory, MemoryDraft } from "../lib/memory/types";
import { backupData, packageFixture, TEST_NOW } from "./backup-fixture";
import { progressFixture } from "./memory-progress-fixture";

const NOW = 100; // The fixture's Memory clock.
type Fixture = Awaited<ReturnType<typeof progressFixture>>;
const row = (id: string, sessionId: string, messageId: string, text: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({
  id, characterId: "c", text, kind: "ongoing", subject: "character", status: "active", origin: "auto",
  sources: [{ sessionId, messageId }], lineage: {}, ...extra });

async function setup(seed: (f: Fixture, a: string) => MemoryDraft[]) {
  const f = await progressFixture(), a = await f.send("I am renovating the kitchen"), b = await f.send("Still waiting on the tiles");
  await f.memory.applyChange("c", "seed", { put: seed(f, a.id) });
  return { f, a: a.id, b: b.id };
}
/** One prepared batch: `parse` may be called many times (rejections), `commit` once. Stub model output, no network. */
async function batch<T>(f: Fixture, candidateIds: string[], body: (tools: {
  parse: (operation: Record<string, unknown>) => ReturnType<typeof parseMaintenanceOperations>;
  commit: (operation: Record<string, unknown>) => Promise<void>; }) => Promise<T>): Promise<T> {
  return (await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 2, 2, candidateIds);
    const snapshot = (await f.protocol.readInput(ticket))!;
    const parse = (operation: Record<string, unknown>) => parseMaintenanceOperations(JSON.stringify({ operations: [operation] }), snapshot, () => "new", NOW);
    const commit = async (operation: Record<string, unknown>) => {
      const plan = parse(operation);
      await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
      await f.protocol.commitAutomatic(ticket, { put: plan.put });
    };
    return body({ parse, commit });
  }))!;
}
const DAY = ONGOING_REVIEW.dayMs;
const invalid = /Invalid/;

test("a new ongoing memory gets a review time from reviewInDays; other kinds cannot, and out-of-range days are invalid", async () => {
  const { f, b } = await setup(() => []);
  const create = { op: "CREATE", text: "Renovating the kitchen", kind: "ongoing", subject: "character", messageIds: [b] };
  await batch(f, [], async ({ parse, commit }) => {
    assert.throws(() => parse({ ...create, kind: "fact", reviewInDays: 7 }), invalid);
    for (const days of [0, 366, 1.5, "7"]) assert.throws(() => parse({ ...create, reviewInDays: days }), invalid);
    await commit({ ...create, reviewInDays: 7 });
  });
  assert.deepEqual((await f.memory.getMemory("new"))?.ongoing, { reviewAt: NOW + 7 * DAY });
  const g = await setup(() => []);
  await batch(g.f, [], ({ commit }) => commit({ ...create, messageIds: [g.b] })); // No time given: no review time, never due.
  assert.equal((await g.f.memory.getMemory("new"))?.ongoing, undefined);
});

test("due marks only ongoing active rows past their review time; old rows without a time are never due", () => {
  const base = { kind: "ongoing", status: "active" } as const;
  assert.equal(ongoingDue({ ...base, ongoing: { reviewAt: 50 } }, 100), true);
  assert.equal(ongoingDue({ ...base, ongoing: { reviewAt: 150 } }, 100), false);
  assert.equal(ongoingDue({ ...base }, 100), false);
  assert.equal(ongoingDue({ kind: "ongoing", status: "archived", ongoing: { reviewAt: 50 } }, 100), false);
  assert.equal(ongoingDue({ kind: "fact", status: "active" }, 100), false);
});

test("the model sees due:true only for due candidates, and a due matter survives a tight candidate budget", async () => {
  const { f } = await setup((x, a) => [row("due", x.session.id, a, "Renovating the kitchen", { ongoing: { reviewAt: 50 } }),
    row("later", x.session.id, a, "Learning to bake bread", { ongoing: { reviewAt: 5000 } }), row("old", x.session.id, a, "Writing a novel")]);
  const snapshot = await f.protocol.withOwner("c", async (owner) =>
    (await f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 2, 2, ["due", "later", "old"])))!);
  const sent = JSON.parse(buildMaintenanceInput(snapshot!, { characterId: "c", context: "" }, undefined, NOW)[1].content).candidates as { id: string; due?: boolean }[];
  assert.deepEqual(sent.map((c) => [c.id, c.due]).sort(), [["due", true], ["later", undefined], ["old", undefined]]);
  const none = JSON.parse(buildMaintenanceInput(snapshot!, { characterId: "c", context: "" })[1].content).candidates as { due?: boolean }[];
  assert.equal(none.some((c) => c.due), false);
  const system = buildMaintenanceInput(snapshot!, { characterId: "c", context: "" }, undefined, NOW)[0].content;
  for (const phrase of ["reviewInDays", "EXTEND", "due:true", "presumed", "never a claim that the matter finished"]) assert.ok(system.includes(phrase), phrase);
  const tight = selectMaintenanceCandidates("c", await f.memory.listMemories("c"), "bread bread bread", 150, NOW);
  assert.equal(tight.mode, "limited");
  assert.ok(tight.ids.includes("due"), "reviewed even when the conversation is about something else");
});

test("EXTEND keeps the matter active, moves the review time and adds the cited evidence; non-ongoing targets are invalid", async () => {
  const { f, a, b } = await setup((x, a) => [row("o", x.session.id, a, "Renovating the kitchen", { ongoing: { reviewAt: 50 } }),
    row("fact", x.session.id, a, "Likes tea", { kind: "fact", subject: "user" })]);
  await batch(f, ["o", "fact"], async ({ parse, commit }) => {
    assert.throws(() => parse({ op: "EXTEND", targetId: "fact", messageIds: [b], reviewInDays: 3 }), invalid);
    assert.throws(() => parse({ op: "EXTEND", targetId: "o", messageIds: [b] }), invalid);
    await commit({ op: "EXTEND", targetId: "o", messageIds: [b], reviewInDays: 14 });
  });
  const after = await f.memory.getMemory("o");
  assert.equal(after?.status, "active");
  assert.deepEqual(after?.ongoing, { reviewAt: NOW + 14 * DAY });
  assert.deepEqual(after?.sources.map((s) => s.messageId), [a, b]);
});

test("ARCHIVE of an ongoing matter records explicit or presumed ending; presumed needs a due matter; other kinds take no marker", async () => {
  const seed = (x: Fixture, a: string) => [row("due", x.session.id, a, "Renovating the kitchen", { ongoing: { reviewAt: 50 } }),
    row("later", x.session.id, a, "Learning to bake bread", { ongoing: { reviewAt: 5000 } }), row("fact", x.session.id, a, "Likes tea", { kind: "fact", subject: "user" })];
  const { f, b } = await setup(seed);
  const archive = (targetId: string, extra: Record<string, unknown> = {}) => ({ op: "ARCHIVE", targetId, messageIds: [b], ...extra });
  await batch(f, ["due", "later", "fact"], async ({ parse, commit }) => {
    assert.throws(() => parse(archive("due")), invalid, "ongoing needs a marker");
    assert.throws(() => parse(archive("later", { ended: "presumed" })), invalid, "not due yet");
    assert.throws(() => parse(archive("fact", { ended: "explicit" })), invalid);
    assert.throws(() => parse(archive("due", { ended: "maybe" })), invalid);
    await commit(archive("due", { ended: "presumed" }));
  });
  const presumed = await f.memory.getMemory("due");
  assert.equal(presumed?.status, "archived");
  assert.deepEqual(presumed?.ongoing, { reviewAt: 50, ended: "presumed" });
  const g = await setup(seed);
  await batch(g.f, ["later"], ({ commit }) => commit({ op: "ARCHIVE", targetId: "later", messageIds: [g.b], ended: "explicit" }));
  assert.equal((await g.f.memory.getMemory("later"))?.ongoing?.ended, "explicit");
  const h = await setup(seed);
  await batch(h.f, ["fact"], ({ commit }) => commit({ op: "ARCHIVE", targetId: "fact", messageIds: [h.b] }));
  assert.equal((await h.f.memory.getMemory("fact"))?.status, "archived");
});

test("the commit gate rejects an implausible review time, and a manual memory cannot carry review data", async () => {
  const { f, b } = await setup((x, a) => [row("o", x.session.id, a, "Renovating the kitchen", { ongoing: { reviewAt: 50 } })]);
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 2, 2, ["o"]);
    await f.protocol.claim(ticket, 1); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    const target = (await f.memory.getMemory("o"))!;
    const { fingerprint: _f, createdAt: _c, updatedAt: _u, ...draft } = target; void [_f, _c, _u];
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [{ ...draft, ongoing: { reviewAt: NOW + 400 * DAY },
      sources: [...target.sources, { sessionId: f.session.id, messageId: b }] }] }));
  });
  assert.deepEqual((await f.memory.getMemory("o"))?.ongoing, { reviewAt: 50 });
  await assert.rejects(f.memory.applyChange("c", "manual", { put: [{ id: "m", characterId: "c", kind: "ongoing", text: "Mine", subject: "character",
    status: "active", origin: "manual", sources: [], lineage: {}, ongoing: { reviewAt: 5 } }] }), /ongoing review data/);
});

test("backup validation accepts review data on automatic ongoing rows and rejects everything else", async () => {
  const make = (extra: Partial<Memory> = {}): Memory => ({ id: "o", characterId: "peter", kind: "ongoing", text: "Renovating the kitchen", subject: "character",
    status: "active", origin: "auto", sources: [{ sessionId: "character:peter", messageId: "user-test" }], lineage: {}, fingerprint: memoryFingerprint("Renovating the kitchen"),
    createdAt: TEST_NOW, updatedAt: TEST_NOW, ongoing: { reviewAt: TEST_NOW + DAY }, ...extra });
  const validate = async (memory: Memory) => {
    const data = backupData(); data.memory = { ...data.memory, memories: [memory] };
    const fixture = await packageFixture(data);
    return validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  };
  assert.deepEqual((await validate(make())).data.memory.memories, [make()]);
  assert.equal((await validate(make({ status: "archived", ongoing: { reviewAt: 5, ended: "presumed" } }))).data.memory.memories.length, 1);
  for (const bad of [make({ ongoing: { ended: "explicit" } }), make({ ongoing: {} }), make({ ongoing: { reviewAt: 0 } }), make({ ongoing: { reviewAt: 5, ended: "later" as never } }),
    make({ origin: "manual" }), make({ ongoing: { reviewAt: 5, extra: 1 } as never }), make({ kind: "fact" })]) {
    await assert.rejects(validate(bad), (error: unknown) => error instanceof BackupValidationError);
  }
});
