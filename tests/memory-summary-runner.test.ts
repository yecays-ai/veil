import assert from "node:assert/strict";
import test from "node:test";
import type { TextProvider } from "../lib/chat/provider";
import { SUMMARY_CHARACTERS } from "../lib/chat/summary";
import { createMaintenanceScheduler } from "../lib/memory/maintenance-scheduler";
import { runSummary, type SummaryOutcome, type SummaryRunnerDependencies } from "../lib/memory/summary-runner";
import { progressFixture } from "./memory-progress-fixture";

const signal = () => new AbortController().signal;
async function fixture(answer: string | (() => AsyncGenerator<string>) = "I remember how we started.") {
  const f = await progressFixture(); let calls = 0; const settled: SummaryOutcome[] = [];
  const deps: SummaryRunnerDependencies = { protocol: f.protocol, memory: f.memory,
    readChat: f.chat.readMemorySources.bind(f.chat),
    sessions: (scope) => scope ? f.chat.listExistingSessions(scope) : f.chat.listSessions(),
    model: async () => ({ config: { id: "m", baseUrl: "https://example.invalid/v1", apiKey: "stub-only", model: "stub" }, context: "Character C" }),
    commit: f.chat.commitSummary.bind(f.chat), enabled: () => true, now: () => 7,
    settle: (_s, outcome) => { settled.push(outcome); },
    provider: (async function* (_c, _m, _s, options, context) {
      calls++; assert.equal(context?.source, "memory-summary"); assert.equal(options?.maxTokens, 2000);
      if (typeof answer === "string") yield answer; else yield* answer();
    }) as TextProvider };
  for (let i = 0; i < 30; i++) await f.send(`message ${i}`);
  return { ...f, deps, settled, calls: () => calls, run: () => runSummary("c", deps, signal()),
    stored: async () => (await f.chat.listSessions()).find((s) => s.id === f.session.id)!.summary };
}

test("nothing is requested until enough messages have left the History window", async () => {
  const f = await fixture();
  assert.equal(await f.run(), false); assert.equal(f.calls(), 0);
});

test("a due range makes exactly one request and stores a compare-and-set summary", async () => {
  const f = await fixture();
  for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
  assert.equal(await f.run(), true); assert.equal(f.calls(), 1);
  const summary = (await f.stored())!;
  assert.equal(summary.text, "I remember how we started."); assert.equal(summary.updatedAt, 7);
  // Nothing newer is due, so another run neither reads a model nor sends.
  assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
  assert.deepEqual(f.settled, [], "a session below the trigger is not even read");
});

test("over-long, secret-looking or JSON answers are rejected and nothing is stored", async () => {
  for (const answer of ["x".repeat(SUMMARY_CHARACTERS + 1), "my api_key is sk-abcdefghijklmnopqrstuvwxyz123456", '{"summary":"x"}', "  "]) {
    const f = await fixture(answer);
    for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
    assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
    assert.equal(await f.stored(), undefined); assert.deepEqual(f.settled, ["failed"]);
  }
});

test("a provider failure is reported once and stores nothing", async () => {
  const f = await fixture(async function* () { throw new Error("network"); });
  for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
  assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
  assert.equal(await f.stored(), undefined); assert.deepEqual(f.settled, ["failed"]);
});

test("a chat that changes while the request runs loses the write instead of overwriting", async () => {
  const f = await fixture(async function* () { await f.chat.deleteMessages(f.session.id, [(await f.snapshot()).messages.find((m) => m.order === 1)!.id]); yield "late summary"; });
  for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
  assert.equal(await f.run(), false); assert.equal(await f.stored(), undefined);
});

test("another tab that owns the Character makes the run report busy without a request", async () => {
  const f = await fixture();
  for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
  await f.protocol.withOwner("c", async () => { assert.equal(await f.run(), "busy"); });
  assert.equal(f.calls(), 0);
});

test("editing a covered message drops the summary and the next run rebuilds it with one request", async () => {
  const f = await fixture();
  for (let i = 0; i < 40; i++) await f.send(`more ${i}`);
  assert.equal(await f.run(), true); assert.ok(await f.stored());
  await f.chat.editMessage((await f.snapshot()).messages.find((m) => m.order === 1)!.id, "edited");
  assert.equal(await f.stored(), undefined);
  assert.equal(await f.run(), true); assert.equal(f.calls(), 2); assert.ok(await f.stored());
});

test("the scheduler asks for a summary-only run without touching maintenance", async () => {
  const runs: { memory: boolean; summary: boolean }[] = [];
  const sessions = [{ id: "s", characterId: "c", updatedAt: 1, autoReplyOnKeyboardDismiss: false, nextOrder: 100 }];
  const scheduler = createMaintenanceScheduler({ enabled: () => true, runnable: () => true, sessions: async () => sessions, cursors: async () => [],
    summaryDue: () => true, setTimer: (cb) => { queueMicrotask(cb); return 1; }, clearTimer: () => undefined,
    run: async (_id, _s, due) => { runs.push(due); return false; } });
  await scheduler.wake(); await new Promise((r) => setTimeout(r, 5)); scheduler.stop();
  assert.deepEqual(runs, [{ memory: false, summary: true }]);
});
