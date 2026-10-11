import assert from "node:assert/strict";
import test from "node:test";
import { defaultFoundation, normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import { ensureRoutine, ensureRoutineAfterSave, parseRoutine, routineBasis, routinePrompt, routineSource, ROUTINE_MAX_TOKENS } from "../lib/presence/routine";
import { effectivePresence } from "../lib/presence/compute";
import { createPresenceStorage, presenceRecord, setRoutine, emptyPresenceDocument } from "../lib/presence/storage";

const ID = "char-a";
const goodReply = JSON.stringify({ defaultStatus: "online", jitterMinutes: 45, blocks: [
  { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:30", status: "busy" }, { days: [0, 1, 2, 3, 4, 5, 6], start: "23:30", end: "07:00", status: "offline" }] });

function fixture(reply: string | (() => string | Promise<string>) = goodReply) {
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: ID, ...normalizeCharacterInput({ name: "Ada", occupation: "nurse", backstory: "night shifts", personality: "calm" }) }];
  const values = new Map<string, string>();
  const store = createPresenceStorage(() => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }), () => undefined);
  const state = { foundation: foundation as FoundationDocument, api: true, requests: [] as { messages: unknown; maxTokens?: number }[] };
  const provider: TextProvider = async function* (_config, messages, signal, generation) {
    state.requests.push({ messages, maxTokens: generation?.maxTokens });
    const text = typeof reply === "string" ? reply : await reply();
    signal.throwIfAborted();
    yield text;
  };
  const deps = { foundation: async () => state.foundation, presence: () => store.load(), bindings: async () => ({ global: {}, characters: {} }),
    presets: async () => createPresetDocument(), provider, write: (change: Parameters<typeof store.transact>[0]) => store.transact(change), now: () => 1_000,
    api: async (id: string) => state.api ? { id, apiKey: "k", model: "m", baseUrl: "https://example.test/v1" } : undefined };
  const edit = (patch: Partial<{ name: string; occupation: string; backstory: string; personality: string; statusMessage: string; speakingStyle: string }>) => {
    state.foundation = { ...state.foundation, characters: state.foundation.characters.map((c) => ({ ...c, ...patch })) };
  };
  return { state, deps, store, edit, record: async () => presenceRecord(await store.load(), ID) };
}

test("the basis follows occupation, backstory and personality only", () => {
  const base = { occupation: "nurse", backstory: "night shifts", personality: "calm" };
  assert.equal(routineBasis(base), routineBasis({ ...base, occupation: "  nurse " }));
  for (const change of [{ occupation: "pilot" }, { backstory: "day shifts" }, { personality: "restless" }, { occupation: null }])
    assert.notEqual(routineBasis({ ...base, ...change }), routineBasis(base));
  const prompt = routinePrompt({ name: "Ada", ...base })[0].content;
  assert.match(prompt, /nurse/); assert.match(prompt, /night shifts/); assert.match(prompt, /calm/);
});

test("a model reply becomes a routine only when every part is valid", () => {
  const parsed = parseRoutine("```json\n" + goodReply + "\n```")!;
  assert.deepEqual([parsed.defaultStatus, parsed.jitterMinutes, parsed.blocks.length], ["online", 45, 2]);
  assert.deepEqual(parsed.blocks[1], { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1410, endMinute: 420, status: "offline" });
  const block = { days: [1], start: "09:00", end: "10:00", status: "busy" };
  for (const bad of ["", "no json", "{", "{}", JSON.stringify({ defaultStatus: "online", jitterMinutes: 5, blocks: [] }),
    JSON.stringify({ defaultStatus: "gone", jitterMinutes: 5, blocks: [block] }), JSON.stringify({ defaultStatus: "online", blocks: [block] }),
    JSON.stringify({ defaultStatus: "online", jitterMinutes: 5, blocks: [{ ...block, start: "25:00" }] }),
    JSON.stringify({ defaultStatus: "online", jitterMinutes: 5, blocks: [{ ...block, start: "9am" }] }),
    JSON.stringify({ defaultStatus: "online", jitterMinutes: 5, blocks: [{ ...block, days: [7] }] }),
    JSON.stringify({ defaultStatus: "online", jitterMinutes: 5, blocks: [{ ...block, status: "sleeping" }] })])
    assert.equal(parseRoutine(bad), null, bad);
});

test("the first save generates a routine with one request and records its basis", async () => {
  const f = fixture();
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
  const record = (await f.record())!;
  assert.deepEqual([record.routine?.routine.blocks.length, record.routine?.changedAt], [2, 1_000]);
  assert.equal(record.routine?.source, routineSource(routineBasis(f.state.foundation.characters[0])));
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].maxTokens, ROUTINE_MAX_TOKENS);
});

test("saves that leave the life basis alone make no request; a changed basis regenerates", async () => {
  const f = fixture();
  await ensureRoutine(ID, undefined, f.deps);
  f.edit({ name: "Ada L.", statusMessage: "hi", speakingStyle: "terse" });
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "current");
  assert.equal(f.state.requests.length, 1);
  f.edit({ occupation: "pilot" });
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
  assert.equal(f.state.requests.length, 2);
  assert.equal((await f.record())!.routine?.source, routineSource(routineBasis(f.state.foundation.characters[0])));
});

test("a failed, invalid or unavailable generation keeps the existing routine and is not retried by itself", async () => {
  const f = fixture();
  await ensureRoutine(ID, undefined, f.deps);
  const before = JSON.stringify(await f.store.load());
  f.edit({ backstory: "moved cities" });
  f.deps.provider = async function* () { throw new Error("offline"); };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "error");
  f.deps.provider = async function* () { yield "I cannot do that."; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "invalid");
  f.deps.provider = async function* () { yield "{".repeat(9_000); };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "invalid");
  f.state.api = false;
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "no-api");
  assert.equal(JSON.stringify(await f.store.load()), before);
});

test("without a routine, a failed request leaves nothing stored", async () => {
  const f = fixture("nonsense");
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "invalid");
  assert.equal(await f.record(), undefined);
  assert.equal(await ensureRoutine("missing", undefined, f.deps), "no-character");
});

test("an edit or deletion while the model is answering discards the old routine", async () => {
  const f = fixture();
  f.deps.provider = async function* () { f.edit({ personality: "restless" }); yield goodReply; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "stale");
  assert.equal(await f.record(), undefined);
  f.deps.provider = async function* () { f.state.foundation = { ...f.state.foundation, characters: [] }; yield goodReply; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "stale");
  assert.equal(await f.record(), undefined);
});

test("a save during generation triggers one follow-up for the new basis, and concurrent calls share one request", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  f.deps.provider = async function* (...args) {
    f.state.requests.push({ messages: args[1] });
    if (first) { first = false; await gate; }
    yield goodReply;
  };
  const running = ensureRoutineAfterSave(ID, f.deps);
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.edit({ occupation: "pilot" });
  const second = ensureRoutineAfterSave(ID, f.deps);
  assert.equal(await second, "busy");
  release();
  assert.equal(await running, "generated");
  assert.equal(f.state.requests.length, 2);
  assert.equal((await f.record())!.routine?.source, routineSource(routineBasis(f.state.foundation.characters[0])));
});

test("a save during the follow-up request is checked too", async () => {
  const f = fixture();
  const gates: (() => void)[] = [];
  f.deps.provider = async function* (...args) {
    f.state.requests.push({ messages: args[1] });
    await new Promise<void>((resolve) => gates.push(resolve));
    yield goodReply;
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const first = ensureRoutineAfterSave(ID, f.deps);
  await tick();
  f.edit({ occupation: "pilot" });
  void ensureRoutineAfterSave(ID, f.deps);
  gates.shift()!();
  await tick(); await tick();
  assert.equal(f.state.requests.length, 2);
  f.edit({ occupation: "chef" });
  void ensureRoutineAfterSave(ID, f.deps);
  gates.shift()!();
  await tick(); await tick();
  assert.equal(f.state.requests.length, 3);
  gates.shift()!();
  await first;
  assert.equal((await f.record())!.routine?.source, routineSource(routineBasis(f.state.foundation.characters[0])));
});

test("cancelling stops the request and stores nothing", async () => {
  const f = fixture(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return goodReply; });
  const controller = new AbortController();
  const running = ensureRoutine(ID, controller.signal, f.deps);
  setTimeout(() => controller.abort(), 5);
  assert.equal(await running, "cancelled");
  assert.equal(await f.record(), undefined);
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
});

test("a routine for an unrelated stored basis is replaced only for the same Character", async () => {
  const f = fixture();
  await f.store.transact(() => setRoutine(setRoutine(emptyPresenceDocument(), "other", parseRoutine(goodReply)!, { changedAt: 5, source: "x" }), ID, parseRoutine(goodReply)!, { changedAt: 5, source: "manual" }));
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
  const document = await f.store.load();
  assert.equal(presenceRecord(document, "other")?.routine?.source, "x");
  assert.equal(presenceRecord(document, ID)?.routine?.changedAt, 1_000);
});

test("the token budget is the routine's own: a chat preset's smaller maxTokens does not cap it", async () => {
  assert.equal(ROUTINE_MAX_TOKENS, 3000);
  const f = fixture();
  const presets = createPresetDocument();
  presets.presets[0] = { ...presets.presets[0], generation: { temperature: 0.4, maxTokens: 512 } };
  f.deps.presets = async () => presets;
  const seen: unknown[] = [];
  f.deps.provider = async function* (_c, _m, _s, generation) { seen.push(generation); yield goodReply; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
  assert.deepEqual(seen, [{ temperature: 0.4, maxTokens: 3000 }]);
});

test("failures are told apart: no API, request failure, truncated output and an invalid reply", async () => {
  const f = fixture();
  f.state.api = false;
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "no-api");
  f.state.api = true;
  f.deps.provider = async function* () { throw new Error("HTTP 500"); };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "error");
  // Reasoning-only output that ends at the token limit: nothing to parse, and the finish reason says why.
  f.deps.provider = async function* (_c, _m, _s, _g, _r, terminal) { terminal?.("length"); yield ""; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "truncated");
  f.deps.provider = async function* (_c, _m, _s, _g, _r, terminal) { terminal?.("stop"); yield "Sorry, no."; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "invalid");
  // Cut off but still a complete, valid routine: it is used.
  f.deps.provider = async function* (_c, _m, _s, _g, _r, terminal) { terminal?.("length"); yield goodReply; };
  assert.equal(await ensureRoutine(ID, undefined, f.deps), "generated");
  assert.equal(await f.record().then((r) => r?.routine?.routine.blocks.length), 2);
});

test("harmless format deviations are accepted, structural ones are not", () => {
  const make = (patch: object, top: object = {}) => JSON.stringify({ defaultStatus: "online", jitterMinutes: 5,
    blocks: [{ days: [1], start: "09:00", end: "10:00", status: "busy", ...patch }], ...top });
  const lenient = parseRoutine(make({ days: ["1", 2], status: " Busy " }, { jitterMinutes: "45", defaultStatus: "ONLINE" }))!;
  assert.deepEqual([lenient.jitterMinutes, lenient.defaultStatus, lenient.blocks[0].days, lenient.blocks[0].status], [45, "online", [1, 2], "busy"]);
  for (const bad of [make({ start: "24:00" }), make({ end: "24:01" }), make({ days: ["mon"] }), make({ days: [7] }),
    make({ status: "sleeping" }), make({}, { jitterMinutes: "soon" }), make({}, { defaultStatus: "gone" })])
    assert.equal(parseRoutine(bad), null, bad);
});

test("24:00 as an end time keeps midnight-crossing ranges exact, with no zero-length or all-day misreading", () => {
  const at = (routineJson: string, hour: number, minute = 0) => {
    const routine = parseRoutine(routineJson)!;
    // 2026-10-12 is a Monday; the Character lives in UTC and the routine has no jitter.
    return effectivePresence({ characterId: ID, timezone: "UTC", routine, situations: [] }, Date.UTC(2026, 9, 12, hour, minute)).status;
  };
  const range = (start: string, end: string) => JSON.stringify({ defaultStatus: "online", jitterMinutes: 0,
    blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], start, end, status: "busy" }] });
  const toMidnight = range("23:00", "24:00"), pastMidnight = range("23:00", "01:00"), wholeDay = range("00:00", "24:00");
  assert.deepEqual(parseRoutine(toMidnight)!.blocks[0], { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1380, endMinute: 0, status: "busy" });
  assert.deepEqual([at(toMidnight, 22, 59), at(toMidnight, 23), at(toMidnight, 23, 59), at(toMidnight, 0), at(toMidnight, 0, 1)],
    ["online", "busy", "busy", "online", "online"]);
  assert.deepEqual([at(pastMidnight, 22, 59), at(pastMidnight, 23), at(pastMidnight, 0, 30), at(pastMidnight, 1), at(pastMidnight, 12)],
    ["online", "busy", "busy", "online", "online"]);
  assert.deepEqual([0, 6, 12, 18, 23].map((hour) => at(wholeDay, hour)), ["busy", "busy", "busy", "busy", "busy"]);
});
