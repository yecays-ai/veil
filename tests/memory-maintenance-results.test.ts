import assert from "node:assert/strict";
import test from "node:test";
import { progressFixture } from "./memory-progress-fixture";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage, FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { runMaintenance, type MaintenanceRunnerDependencies } from "../lib/memory/maintenance-runner";
import { createMaintenanceDiagnostics, describeMaintenanceResult, pairMaintenanceResults, type MaintenanceDiagnostic, type MaintenanceDiagnosticStore } from "../lib/memory/maintenance-diagnostics";
import type { TextProvider } from "../lib/chat/provider";

const SECRET_WORDS = ["Peter loves the harbour at dawn", "SECRET-CANDIDATE-TEXT", "RAW-MODEL-RESPONSE-MARKER"];

async function fixture() {
  const f = await progressFixture(); let output = "";
  const character = { characterId: "c", ...normalizeCharacterInput({ name: "Peter", backstory: "A quiet student.", personality: "calm", speakingStyle: "short" }) };
  await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, await f.core.read(FOUNDATION_STORAGE_KEY), JSON.stringify({ ...defaultFoundation(), characters: [character] }));
  const chat = new ChatStorage(() => f.factory, () => f.locks, f.gate, true, f.memory);
  createIndexedDBFoundationStorage(f.core, f.memory);
  const source = { ...f.source, readChat: chat.readMemorySources.bind(chat), readStateSources: chat.readStateSources.bind(chat) };
  const protocol = new MemoryProgressProtocol(f.memory, source, f.locks, true);
  const diagnostics = createMaintenanceDiagnostics(true);
  const deps: MaintenanceRunnerDependencies = { protocol, memory: f.memory, readChat: chat.readMemorySources.bind(chat),
    sessions: (scope) => scope ? chat.listExistingSessions(scope) : chat.listSessions(),
    model: async () => ({ config: { id: "selected", baseUrl: "https://example.invalid/v1", apiKey: "stub-only", model: "stub" }, context: "{}" }),
    enabled: () => true, now: () => Date.now() + 310_000, triggerSequences: 1, diagnostics,
    provider: (async function* () { yield output; }) as TextProvider };
  return { ...f, chat, deps, diagnostics, say: (text: string) => { output = text; }, send: (text: string) => chat.send(f.session.id, text),
    progress: async () => (await f.memory.listCursors("c"))[0]?.extraction,
    run: () => runMaintenance("c", deps, new AbortController().signal) };
}
const last = (f: Awaited<ReturnType<typeof fixture>>) => f.diagnostics.read().at(-1)!;

test("IGNORE is committed as ok with zero written; the usage row's 'completed' no longer stands for success", async () => {
  const f = await fixture(); await f.send(SECRET_WORDS[0]);
  f.say(JSON.stringify({ operations: [{ op: "IGNORE" }] }));
  assert.equal(await f.run(), true);
  const d = last(f);
  assert.equal(d.stage, "ok"); assert.equal(d.operationCount, 1);
  assert.deepEqual(d.counts, { ignored: 1, created: 0, updated: 0, state: 0, droppedManual: 0, droppedTooLong: 0, droppedProtected: 0, droppedDuplicate: 0 });
  assert.match(describeMaintenanceResult(d), /1 ignored, 0 actionable\)\. Written: 0 created, 0 updated, 0 state/);
  assert.equal((await f.memory.listMemories("c")).length, 0);
});

test("valid, over-600, protected and duplicate operations are counted separately and only the valid one is written", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]);
  const op = (text: string) => ({ op: "CREATE", messageIds: [m.id], text, kind: "fact", subject: "user" });
  f.say(JSON.stringify({ operations: [op("Peter likes the harbour."), op("x".repeat(601)), op("password: hunter2 is Peter's"), op("Peter likes the harbour."), { op: "IGNORE" }] }));
  assert.equal(await f.run(), true);
  const d = last(f), c = d.counts!;
  assert.equal(d.operationCount, 5);
  assert.deepEqual([c.created, c.updated, c.ignored, c.droppedTooLong, c.droppedProtected, c.droppedDuplicate], [1, 0, 1, 1, 1, 1]);
  assert.equal(d.discarded, 3);
  assert.equal((await f.memory.listMemories("c")).filter((r) => r.status === "active").length, 1);
  assert.match(describeMaintenanceResult(d), /Dropped: 1 over 600 characters, 1 protected, 1 duplicate\./);
});

test("unparseable JSON and a format violation are distinct stages, the batch becomes a failed hole, and nothing is retried or re-billed", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]); let calls = 0;
  const provider = f.deps.provider; f.deps.provider = (async function* (...args: Parameters<TextProvider>) { calls++; yield* provider(...args); }) as TextProvider;
  f.say("RAW-MODEL-RESPONSE-MARKER not json");
  assert.equal(await f.run(), false);
  assert.equal(last(f).stage, "json");
  assert.equal((await f.progress())!.batches[0].state, "failed");
  await f.send("another"); f.say(JSON.stringify({ operations: [{ op: "CREATE", messageIds: [m.id] }] }));
  await f.run();
  assert.equal(last(f).stage, "format");
  // The first failed range is not offered again: each run spent at most one request on a fresh range.
  assert.ok(calls <= 2);
  assert.match(describeMaintenanceResult(last(f)), /^Not written: .*not retried/);
});

test("results contain only numbers and enums: no chat text, candidate text or model response", async () => {
  const f = await fixture(); const m = await f.send(SECRET_WORDS[0]);
  f.say(JSON.stringify({ operations: [{ op: "CREATE", messageIds: [m.id], text: SECRET_WORDS[1], kind: "fact", subject: "user" }] }));
  await f.run(); f.say(SECRET_WORDS[2]); await f.send("more"); await f.run();
  const stored = JSON.stringify(f.diagnostics.read());
  for (const word of SECRET_WORDS) assert.ok(!stored.includes(word), word);
  assert.ok(!stored.includes(m.id));
});

test("stored results are validated, bounded to 20 and survive a reload; junk is dropped", () => {
  let saved: string | null = JSON.stringify([{ outcome: "committed", messageCount: 1, candidateCount: 0, inputCharacters: 5, operationCount: 1, discarded: 0, durationMs: 1,
    stage: "ok", text: "LEAK", counts: { ignored: 1, created: 0, updated: 0, state: 0, droppedManual: 0, droppedTooLong: 0, droppedProtected: 0, droppedDuplicate: 0 } },
    { outcome: "bogus" }, { outcome: "rejected", messageCount: -1 }, "text"]);
  const store: MaintenanceDiagnosticStore = { load: () => saved, save: (v) => { saved = v; } };
  const first = createMaintenanceDiagnostics(true, store);
  assert.equal(first.read().length, 1); assert.ok(!("text" in first.read()[0]));
  for (let i = 0; i < 30; i++) first.record({ outcome: "rejected", stage: "json", at: i, messageCount: 1, candidateCount: 0, inputCharacters: 1, operationCount: 0, discarded: 0, durationMs: 1 });
  assert.equal(createMaintenanceDiagnostics(true, store).read().length, 20);
  assert.ok(!saved!.includes("LEAK"));
  assert.equal(createMaintenanceDiagnostics(true, { load: () => "{broken", save: () => { throw new Error("full"); } }).read().length, 0);
  assert.equal(createMaintenanceDiagnostics(false, store).read().length, 0);
});

test("each usage row pairs with the result of its own request, never an older or newer one", () => {
  const base = { outcome: "committed", messageCount: 1, candidateCount: 0, inputCharacters: 1, operationCount: 0, discarded: 0, durationMs: 1, stage: "ok" } as const;
  const a: MaintenanceDiagnostic = { ...base, at: 1_000 }, b: MaintenanceDiagnostic = { ...base, at: 500_000 };
  const rows = [{ at: 30_000 }, { at: 520_000 }, { at: 900_000 }];
  const { pairs, unpaired } = pairMaintenanceResults(rows, [a, b]);
  assert.equal(pairs.get(rows[0]), a); assert.equal(pairs.get(rows[1]), b); assert.equal(pairs.has(rows[2]), false); assert.equal(unpaired.length, 0);
});
