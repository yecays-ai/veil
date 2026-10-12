import assert from "node:assert/strict";
import test from "node:test";
import { IDBObjectStore } from "fake-indexeddb";
import { progressFixture, deferred } from "./memory-progress-fixture";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { runMaintenance, maintenanceDue, MAINTENANCE_IDLE_MS, nextMaintenanceRange, type MaintenanceRunnerDependencies } from "../lib/memory/maintenance-runner";
import { completeClear, recordClearIntent } from "../lib/memory/lifecycle";
import { ChatStorage } from "../lib/chat/storage";
import { maintenanceEnabled, maintenanceReleaseApproved, setMaintenanceConsent } from "../lib/memory/maintenance-config";
import { createMaintenanceScheduler } from "../lib/memory/maintenance-scheduler";
import { startBrowserMaintenance } from "../lib/memory/maintenance-browser";
import { createOpenAITextProvider, type TextProvider } from "../lib/chat/provider";
import { readUsageBaseline } from "../lib/chat/usage-baseline";
import type { MemoryDraft } from "../lib/memory/types";
import { FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";

const ignore = JSON.stringify({ operations: [{ op: "IGNORE" }] });
const signal = () => new AbortController().signal;
for (const stage of ["listMemories", "refresh", "readInput"] as const) test(`transient preflight ${stage} failure retains retryable sources without dispatch or cursor advance`, async () => {
  const f = await fixture(); await f.send();
  if (stage === "listMemories") {
    const original = f.memory.listMemories.bind(f.memory); let failed = false;
    f.memory.listMemories = async (...args) => {
      if (!args[1] && !failed) { failed = true; throw new Error("temporary read failure"); }
      return original(...args);
    };
  } else if (stage === "refresh") {
    const original = f.protocol.refresh.bind(f.protocol); let failed = false;
    f.protocol.refresh = async (...args) => {
      if (!failed) { failed = true; throw new Error("temporary refresh failure"); }
      return original(...args);
    };
  } else {
    const original = f.protocol.readInput.bind(f.protocol); let reads = 0;
    f.protocol.readInput = async (...args) => {
      if (++reads === 2) throw new Error("temporary snapshot failure");
      return original(...args);
    };
  }
  await f.run().catch(() => undefined);
  const progress = (await f.progress())!;
  assert.equal(progress.throughSeq, 0); assert.equal(progress.batches[0].state, "ready");
  assert.equal(progress.batches[0].attempts, 0); assert.equal(f.calls(), 0);
  assert.equal(await f.run(), true); assert.equal((await f.progress())!.throughSeq, 1);
  assert.equal(f.calls(), 1); assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
});
async function fixture(provider?: TextProvider) {
  const f = await progressFixture(); let calls = 0, clock = Date.now() + MAINTENANCE_IDLE_MS + 10_000, enabled = true;
  const deps: MaintenanceRunnerDependencies = { protocol: f.protocol, memory: f.memory,
    readChat: f.chat.readMemorySources.bind(f.chat),
    sessions: (scope) => scope ? f.chat.listExistingSessions(scope) : f.chat.listSessions(),
    model: async () => ({ config: { id: "selected", baseUrl: "https://example.invalid/v1", apiKey: "stub-only", model: "stub" }, context: "Character C" }),
    enabled: () => enabled, now: () => clock,
    provider: async function* (...args) {
      calls++; assert.equal((await f.progress())!.batches.find((b) => b.state === "in-flight")!.state, "in-flight");
      assert.equal(args[4]?.source, "memory-maintenance"); assert.equal(args[3]?.maxTokens, 2000);
      if (provider) yield* provider(...args); else yield ignore;
    } };
  return { ...f, deps, calls: () => calls, clock: (value: number) => { clock = value; }, enable: (value: boolean) => { enabled = value; },
    run: (s = signal()) => runMaintenance("c", deps, s) };
}

test("default-off browser wiring and configuration cause no storage or provider work", () => {
  assert.equal(maintenanceReleaseApproved(), false); assert.equal(maintenanceEnabled(), false);
  assert.throws(() => setMaintenanceConsent(true)); startBrowserMaintenance()();
});
test("five minutes is an earliest durable gate; no messages, disabled or invalid binding makes zero calls", async () => {
  const f = await fixture(); assert.equal(await f.run(), false); assert.equal(f.calls(), 0);
  const m = await f.send(); f.clock(m.createdAt + MAINTENANCE_IDLE_MS - 1);
  assert.equal(await f.run(), false); assert.equal(f.calls(), 0);
  f.clock(m.createdAt + MAINTENANCE_IDLE_MS); f.enable(false); assert.equal(await f.run(), false);
  f.enable(true); f.deps.model = async () => { throw new Error("Invalid explicit model"); };
  await assert.rejects(f.run()); assert.equal(f.calls(), 0); assert.equal(await f.progress(), undefined);
});
test("one paid-request slot and legal IGNORE atomically finish; remount never dispatches again", async () => {
  const f = await fixture(); await f.send(); assert.equal(await f.run(), true);
  assert.equal((await f.progress())?.throughSeq, 1); assert.deepEqual(await f.memory.listMemories("c"), []);
  f.deps.protocol = new MemoryProgressProtocol(f.memory, f.source, f.locks);
  assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
});
test("empty deleted sequence holes complete atomically with zero model calls", async () => {
  const f = await fixture(), m = await f.send(); await f.chat.deleteMessages(f.session.id, [m.id]);
  assert.equal(await f.run(), true); assert.equal((await f.progress())?.throughSeq, 1); assert.equal(f.calls(), 0);
});
test("real cross-tab owner excludes a second provider before dispatch, not merely duplicate writes", async () => {
  const entered = deferred(), released = deferred();
  const f = await fixture(async function* () { entered.resolve(); await released.promise; yield ignore; });
  await f.send(); const first = f.run(); await entered.promise;
  const other = { ...f.deps, protocol: new MemoryProgressProtocol(f.memory, f.source, f.origin.client()) };
  assert.equal(await runMaintenance("c", other, signal()), "busy"); assert.equal(f.calls(), 1);
  released.resolve(); await first; assert.equal(await runMaintenance("c", other, signal()), false); assert.equal(f.calls(), 1);
});
test("chat remains writable during network; new user and ongoing reply do not invalidate the frozen old batch", async () => {
  const entered = deferred(), released = deferred(); let firstId = "";
  const f = await fixture(async function* (_config, messages) {
    const ids = JSON.parse(messages[1].content).messages.map((m: { id: string }) => m.id);
    assert.deepEqual(ids, [firstId]); entered.resolve(); await released.promise;
    yield JSON.stringify({ operations: [{ op: "CREATE", text: "C likes orchids", kind: "fact", subject: "character", messageIds: [firstId] }] });
  });
  const first = await f.send(); firstId = first.id;
  const run = f.run(); await entered.promise;
  const second = await f.send("new topic next batch"); const generation = await f.chat.claimGeneration(f.session.id);
  assert.equal(second.memorySequence?.seq, 2); assert.ok(generation);
  released.resolve(); assert.equal(await run, true);
  assert.equal((await f.progress())?.throughSeq, 1); assert.equal(f.calls(), 1);
  assert.deepEqual((await f.memory.listMemories("c"))[0].sources, [{ sessionId: f.session.id, messageId: first.id }]);
  await f.chat.releaseGeneration(f.session.id, generation);
  f.deps.provider = async function* () { yield ignore; };
  assert.equal(await f.run(), true); assert.equal((await f.progress())?.throughSeq, 2);
});
for (const mutation of ["edit", "delete", "clear", "delete-character"] as const) test(`late ${mutation} cannot resurrect invalid sources`, async () => {
  const entered = deferred(), released = deferred(); let id = "";
  const f = await fixture(async function* () { entered.resolve(); await released.promise;
    yield JSON.stringify({ operations: [{ op: "CREATE", text: "C remembers a fact", kind: "fact", subject: "character", messageIds: [id] }] }); });
  const m = await f.send(); id = m.id; const run = f.run(); await entered.promise;
  if (mutation === "edit") await f.chat.editMessage(id, "edited source");
  if (mutation === "delete") await f.chat.deleteMessages(f.session.id, [id]);
  if (mutation === "clear") {
    await recordClearIntent(f.memory, "c", f.session.id);
    await f.memory.withExclusive((scope) => f.chat.clearSession(f.session.id, scope));
    await completeClear(f.memory, "c", f.session.id);
  }
  if (mutation === "delete-character") await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, await f.core.read(FOUNDATION_STORAGE_KEY), JSON.stringify({ version: 1, characters: [] }));
  released.resolve(); await run.catch(() => false);
  assert.deepEqual(await f.memory.listMemories("c"), []); assert.notEqual((await f.progress())?.throughSeq, 1);
  assert.equal(f.calls(), 1);
});
for (const kind of ["network", "timeout", "illegal-json", "illegal-source", "truncated", "aborted"] as const) test(`${kind} never advances success or resends after refresh`, async () => {
  const controller = new AbortController();
  const f = await fixture(async function* (_c, _m, _s, _g, _r, terminal) {
    if (kind === "network" || kind === "timeout") throw new Error(kind);
    if (kind === "aborted") { controller.abort(); yield ignore; return; }
    if (kind === "truncated") { terminal?.("length"); yield ignore; return; }
    yield kind === "illegal-json" ? "bad" : JSON.stringify({ operations: [{ op: "CREATE", text: "bad id", kind: "fact", subject: "character", messageIds: ["nonexistent"] }] });
  });
  await f.send(); assert.equal(await f.run(controller.signal), false);
  const state = (await f.progress())!;
  assert.equal(state.throughSeq, 0); assert.ok(["uncertain", "failed"].includes(state.batches[0].state));
  f.deps.protocol = new MemoryProgressProtocol(f.memory, f.source, f.locks);
  assert.equal(await f.run(), false); assert.equal(f.calls(), 1);
});
test("commit transaction failure is retained without partial Memory, progress or a second fee", async () => {
  let id = ""; const f = await fixture(async function* () {
    yield JSON.stringify({ operations: [{ op: "CREATE", text: "remember", kind: "fact", subject: "character", messageIds: [id] }] });
  }); id = (await f.send()).id;
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "memories" && (args[0] as MemoryDraft).text === "remember") throw new Error("fault");
    return put.apply(this, args);
  };
  try { assert.equal(await f.run(), false); } finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await f.progress())!.throughSeq, 0); assert.equal((await f.progress())!.batches[0].state, "uncertain");
  assert.deepEqual(await f.memory.listMemories("c"), []); await f.run(); assert.equal(f.calls(), 1);
});
test("safe pre-request claim recovery is finite; in-flight/commit-pending are uncertain and never automatically dispatched", async () => {
  for (const state of ["claimed", "in-flight", "commit-pending"] as const) {
    const f = await fixture(); await f.send();
    await f.protocol.withOwner("c", async (owner) => {
      const t = await f.protocol.prepare(owner, f.session.id, 1, 1); await f.protocol.claim(t, 2);
      if (state !== "claimed") await f.protocol.transition(t, "in-flight");
      if (state === "commit-pending") await f.protocol.transition(t, "commit-pending");
    });
    assert.equal(await f.run(), state === "claimed"); assert.equal(f.calls(), state === "claimed" ? 1 : 0);
    await f.run(); assert.equal(f.calls(), state === "claimed" ? 1 : 0);
  }
});
test("manual, suppression and five user undo records remain authoritative during the paid gap", async () => {
  const entered = deferred(), released = deferred(); let id = "";
  const f = await fixture(async function* () { entered.resolve(); await released.promise;
    yield JSON.stringify({ operations: [{ op: "CREATE", text: "protected fact", kind: "fact", subject: "user", messageIds: [id] }] }); });
  id = (await f.send()).id;
  const run = f.run(); await entered.promise;
  const manual = { id: "manual", characterId: "c", origin: "manual", status: "active", kind: "fact", subject: "user", text: "protected fact", sources: [], lineage: {} } satisfies MemoryDraft;
  await f.memory.applyChange("c", "user", { put: [manual] });
  for (let n = 0; n < 5; n++) await f.memory.applyChange("c", "manual edit", { put: [{ ...manual, text: n === 4 ? manual.text : `prior ${n}` }] });
  const before = await f.memory.getMemory("manual"), operations = await f.memory.listOperations("c"), suppressions = await f.memory.listSuppressions("c");
  assert.equal(operations.length, 5);
  released.resolve(); assert.equal(await run, false);
  assert.deepEqual(await f.memory.getMemory("manual"), before); assert.deepEqual(await f.memory.listOperations("c"), operations);
  assert.deepEqual(await f.memory.listSuppressions("c"), suppressions);
});
test("Character isolation, no group/legacy tracking and activation does not backfill old messages", async () => {
  const f = await fixture(); await f.send(); assert.equal(await runMaintenance("other", f.deps, signal()), false); assert.equal(f.calls(), 0);
  let enabled = false;
  const chat = new ChatStorage(() => f.factory, () => f.locks, f.gate, () => enabled);
  const s = await chat.openSession("new"); const legacy = await chat.send(s.id, "old");
  enabled = true; const fresh = await chat.send(s.id, "new");
  assert.equal(legacy.memorySequence, undefined); assert.equal(fresh.memorySequence?.seq, 1);
  assert.equal((await f.memory.withExclusive((scope) => chat.readMemorySources(s.id, scope))).messages.find((m) => m.id === legacy.id)?.memorySequence, undefined);
  const group = await chat.createGroupSession(["new", "c"], "group");
  assert.equal((await chat.send(group.id, "not tracked")).memorySequence, undefined);
});

test("long messages form smaller complete batches; overlarge single complete input stays pending with zero fees", async () => {
  const f = await fixture(); await f.send("a".repeat(8000)); await f.send("b".repeat(8000));
  assert.equal(await f.run(), true); assert.equal((await f.progress())?.throughSeq, 1);
  assert.equal(await f.run(), true); assert.equal((await f.progress())?.throughSeq, 2); assert.equal(f.calls(), 2);
  const large = await fixture(); await large.send("short"); const reply = await large.chat.beginReply(large.session.id); assert.ok(reply);
  await large.chat.finalizeReply(reply.assistant.id, "x".repeat(25_000)); await large.send("confirm");
  assert.equal(await large.run(), true); assert.equal((await large.progress())?.throughSeq, 1);
  assert.equal(await large.run(), false); assert.equal((await large.progress())?.batches[0].state, "too-large");
  assert.equal((await large.progress())?.throughSeq, 1); assert.equal(large.calls(), 1);
  assert.equal((await large.progress())?.batches[0].fromSeq, 2);
});

test("recent activity arriving during input preparation prevents request before persisted dispatch", async () => {
  const f = await fixture(); await f.send();
  const original = f.protocol.transition.bind(f.protocol);
  f.protocol.transition = async (ticket, state, guard) => {
    if (state === "in-flight") { const m = await f.send("just returned"); f.clock(m.createdAt); }
    return original(ticket, state, guard);
  };
  await assert.rejects(f.run()); assert.equal(f.calls(), 0); assert.equal((await f.progress())?.batches[0].state, "claimed");
});

test("binding deletion/change before persisted dispatch refuses fee and never falls back", async () => {
  const f = await fixture(); await f.send(); let reads = 0;
  const original = f.deps.model;
  f.deps.model = async (...args) => { reads++; if (reads > 1) throw new Error("explicit config removed"); return original(...args); };
  await assert.rejects(f.run()); assert.equal(f.calls(), 0); assert.equal((await f.progress())?.batches[0].state, "claimed");
});

test("preflight secret rejection retains a failed hole without starving later valid messages or sending the secret", async () => {
  const f = await fixture(); await f.send("password: private-value"); assert.equal(await f.run(), false);
  assert.equal(f.calls(), 0); assert.equal((await f.progress())?.batches[0].state, "failed");
  assert.equal((await f.progress())?.throughSeq, 0);
  await f.send("I adopted a rescue kitten");
  f.deps.provider = async function* (_c, messages) {
    assert.ok(!messages.some((m) => m.content.includes("private-value"))); yield ignore;
  };
  assert.equal(await f.run(), true); const p = (await f.progress())!;
  assert.equal(p.throughSeq, 0); assert.deepEqual(p.completed, [[2, 2]]); assert.equal(p.batches[0].state, "failed");
});

test("deleted evidence after safe claim keeps a failure hole instead of misusing completeEmpty or starving newer messages", async () => {
  const f = await fixture(), message = await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1); await f.protocol.claim(ticket, 2);
  });
  await f.chat.deleteMessages(f.session.id, [message.id]); await f.send("newer valid evidence");
  assert.equal(await f.run(), false); assert.equal(f.calls(), 0); assert.equal((await f.progress())?.batches[0].state, "failed");
  assert.equal(await f.run(), true); assert.equal(f.calls(), 1);
  assert.equal((await f.progress())?.throughSeq, 0); assert.deepEqual((await f.progress())?.completed, [[2, 2]]);
});

test("maintenance total request deadline cancels an abort-aware hanging provider and preserves uncertain", async () => {
  const f = await fixture(async function* (_c, _m, aborted) {
    await new Promise<void>((_, reject) => aborted.addEventListener("abort", () => reject(new Error("deadline")), { once: true }));
    yield ignore;
  });
  await f.send(); f.deps.requestTimeoutMs = 5; assert.equal(await f.run(), false);
  assert.equal(f.calls(), 1); assert.equal((await f.progress())?.batches[0].state, "uncertain");
  assert.equal((await f.progress())?.throughSeq, 0); await f.run(); assert.equal(f.calls(), 1);
});

test("runtime respects interrupted restore admission without dispatch or progress creation", async () => {
  const f = await fixture(); await f.send(); f.raw.set("veil.restore-journal.v1", "incomplete");
  await assert.rejects(f.run()); assert.equal(f.calls(), 0); f.raw.delete("veil.restore-journal.v1"); assert.equal(await f.progress(), undefined);
});

test("late deletion suppression prevents rewritten automatic candidate without touching undo or suppression", async () => {
  const entered = deferred(), released = deferred(); let id = "";
  const f = await fixture(async function* () { entered.resolve(); await released.promise;
    yield JSON.stringify({ operations: [{ op: "CREATE", text: "different wording", kind: "fact", subject: "user", messageIds: [id] }] }); });
  id = (await f.send()).id; const run = f.run(); await entered.promise;
  await f.memory.applyChange("c", "user delete", { suppress: [{ id: "deleted", fingerprint: "other original wording", reason: "deleted", sources: [{ sessionId: f.session.id, messageId: id }] }] });
  const operations = await f.memory.listOperations("c"), suppressions = await f.memory.listSuppressions("c");
  assert.ok(suppressions.length > 0); released.resolve(); assert.equal(await run, false);
  assert.deepEqual(await f.memory.listMemories("c"), []); assert.deepEqual(await f.memory.listOperations("c"), operations);
  assert.deepEqual(await f.memory.listSuppressions("c"), suppressions); assert.equal((await f.progress())?.throughSeq, 0);
});

test("real provider adapter with stub fetch records one bounded usage row, without real network", async () => {
  const f = await fixture(), previousFetch = globalThis.fetch, oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  await f.send();
  const values = new Map<string, string>(), store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  let calls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: store } });
  globalThis.fetch = async (_url, options) => {
    calls++; const body = JSON.parse(options!.body as string);
    assert.equal(body.model, "stub"); assert.equal(body.max_tokens, 2000);
    return new Response(JSON.stringify({ choices: [{ message: { content: ignore }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 9, total_tokens: 129 } }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    f.deps.provider = createOpenAITextProvider(); assert.equal(await f.run(), true); await f.run();
    assert.equal(calls, 1); const rows = readUsageBaseline(store); assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "memory-maintenance"); assert.equal(rows[0].totalTokens, 129);
    assert.ok(!JSON.stringify(rows).includes("A new fact"));
  } finally { globalThis.fetch = previousFetch; if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); }
});

test("network wait never holds backup exclusive and final commit waits for a queued snapshot", async (t) => {
  const entered = deferred(), released = deferred(), held = deferred(), unlock = deferred();
  const f = await fixture(async function* () { entered.resolve(); await released.promise; yield ignore; });
  await f.send(); f.holds.length = 0; f.waits.length = 0;
  const run = f.run(); await entered.promise;
  const snapshot = f.memory.withExclusive(async () => { held.resolve(); await unlock.promise; }); await held.promise;
  released.resolve(); await new Promise((r) => setTimeout(r, 10)); assert.equal((await f.progress())?.throughSeq, 0);
  unlock.resolve(); await snapshot; assert.equal(await run, true);
  const samples = [...f.holds].sort((a, b) => a - b);
  t.diagnostic(JSON.stringify({ exclusiveHolds: samples.length, maxHoldMs: samples.at(-1), maxWaitMs: Math.max(...f.waits),
    includesInjectedSnapshotHold: true, providerCalls: f.calls(), actualNetwork: false }));
});

test("measure warm runner lease holds with retained history and bounded candidates using only stub requests", async (t) => {
  const f = await fixture(), seed = await f.send("seed evidence");
  const rows: MemoryDraft[] = Array.from({ length: 15 }, (_, i) => ({ id: `seed${i}`, characterId: "c", kind: "fact", subject: "character",
    text: `seed preference ${i}`, origin: "auto", status: "active", sources: [{ sessionId: f.session.id, messageId: seed.id }], lineage: {} }));
  await f.memory.applyChange("c", "seed", { put: rows }); f.holds.length = 0; f.waits.length = 0;
  const elapsed: number[] = [];
  for (let i = 0; i < 30; i++) {
    await f.send(`seed preference development ${i}`); f.clock(Date.now() + MAINTENANCE_IDLE_MS);
    const start = performance.now(); assert.equal(await f.run(), true); elapsed.push(performance.now() - start);
  }
  const holds = [...f.holds].sort((a, b) => a - b), times = elapsed.sort((a, b) => a - b);
  const p = (xs: number[], pct: number) => Number(xs[Math.min(xs.length - 1, Math.floor(xs.length * pct))].toFixed(3));
  t.diagnostic(JSON.stringify({ runs: 30, retainedMessages: 31, candidates: 15, stubCalls: f.calls(), actualNetwork: false,
    exclusiveSamples: holds.length, holdMs: { p50: p(holds, .5), p95: p(holds, .95), max: p(holds, 1) },
    runnerMs: { p50: p(times, .5), p95: p(times, .95), max: p(times, 1) }, maxWaitMs: Math.max(...f.waits) }));
});
test("durable idle uses every direct session of Character and defers clock rollback or active generation", async () => {
  const f = await fixture(), m = await f.send(), rows = await f.chat.listSessions();
  assert.equal(maintenanceDue(rows, "c", m.createdAt - 1000), MAINTENANCE_IDLE_MS + 1000);
  assert.equal(maintenanceDue([...rows, { ...rows[0], id: "other", updatedAt: m.createdAt + 1000 }], "c", m.createdAt + MAINTENANCE_IDLE_MS), 1000);
  assert.equal(maintenanceDue([{ ...rows[0], generation: { id: "g", stage: "preparing" } }], "c", m.createdAt + MAINTENANCE_IDLE_MS), null);
});
test("failed holes remain explicit while later ranges can complete without advancing across them", async () => {
  const f = await fixture(async function* () { throw new Error("unknown"); });
  await f.send(); await f.run(); await f.send("later"); f.deps.provider = async function* () { yield ignore; };
  assert.equal(await f.run(), true); const p = (await f.progress())!;
  assert.equal(p.throughSeq, 0); assert.deepEqual(p.completed, [[2, 2]]); assert.equal(p.batches[0].state, "uncertain");
  assert.equal(nextMaintenanceRange(3, p), null);
});

test("scheduler uses earliest gate, resumes missed timers and preserves the running old batch on new chat", async () => {
  const f = await fixture(), first = await f.send(), entered = deferred(), released = deferred();
  let clock = first.createdAt, runnable = true, calls = 0;
  const timers = new Map<number, { cb: () => void; at: number }>(); let next = 0;
  const scheduler = createMaintenanceScheduler({ enabled: () => true, runnable: () => runnable, now: () => clock,
    sessions: () => f.chat.listSessions(),
    run: async (_id, s) => { calls++; entered.resolve(); await released.promise; assert.equal(s.aborted, false); return false; },
    setTimer: (cb, delay) => { timers.set(++next, { cb, at: clock + delay }); return next; }, clearTimer: (id) => { timers.delete(id as number); } });
  await scheduler.wake(); assert.equal([...timers.values()][0].at, clock + MAINTENANCE_IDLE_MS);
  clock += MAINTENANCE_IDLE_MS - 1; assert.equal(calls, 0);
  runnable = false; await scheduler.wake(); assert.equal(timers.size, 0);
  clock += 90_000; runnable = true; await scheduler.wake(); const timer = [...timers.values()][0]; timer.cb(); await entered.promise;
  await f.send("back while maintenance runs"); await scheduler.wake(); assert.equal(calls, 1);
  released.resolve(); await new Promise((r) => setTimeout(r, 20)); scheduler.stop(); assert.equal(calls, 1);
});
