import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultFoundation, normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import { DAY_PLAN_CLAIM_TTL_MS, DAY_PLAN_MAX_TOKENS, applyDayPlan, dayPlanPrompt, ensureDayPlan, parseDayPlan } from "../lib/life/day-plan";
import { reconcileProjectedLife } from "../lib/life/plan";
import { settleLifeDocument } from "../lib/life/settle";
import { normalizePresenceDocument, createPresenceStorage, presenceRecord, setRoutine, addSituation, setLifeState, emptyPresenceDocument } from "../lib/presence/storage";

const ID = "char-a", HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 16, 8, 0);
const at = (hour: number, minute = 0, day = 16) => Date.UTC(2026, 9, day, hour, minute);
const routine = { defaultStatus: "online" as const, jitterMinutes: 0, blocks: [
  { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 7 * 60, status: "offline" as const },
  { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" as const }] };
const mark = { changedAt: 0, source: null } as never;
const reply = (activities: object[]) => JSON.stringify({ activities });
const goodReply = reply([
  { start: "08:30", end: "10:00", kind: "meal", title: "Breakfast at the bakery", moment: "The baker remembered the order." },
  { start: "10:00", end: "13:00", kind: "work", title: "Clinic rounds" },
  { start: "19:00", end: "23:00", kind: "social", title: "Dinner with Bo" }]);

function fixture(text: string | (() => string | Promise<string>) = goodReply, withRoutine = true) {
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: ID, ...normalizeCharacterInput({ name: "Ada", occupation: "nurse", timezone: "UTC", speakingStyle: "terse" }) },
    { characterId: "char-b", ...normalizeCharacterInput({ name: "Bo", timezone: "UTC" }) }];
  foundation.universe = { ...foundation.universe, name: "Harbor City", worldSetting: "A rainy port town.", relations: [
    { id: "r1", characterAId: ID, characterBId: "char-b", kind: null, label: "old friend", aToBContext: "trusts Bo", bToAContext: "owes Ada", sharedHistory: null },
    { id: "r2", characterAId: "x", characterBId: "y", kind: null, label: "strangers", aToBContext: null, bToAContext: null, sharedHistory: null }] };
  const values = new Map<string, string>();
  const store = createPresenceStorage(() => ({ getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }), () => undefined);
  const state = { foundation: foundation as FoundationDocument, api: true, now: T0, requests: [] as { messages: { content: string }[]; maxTokens?: number }[] };
  const provider: TextProvider = async function* (_config, messages, signal, generation) {
    state.requests.push({ messages: messages as never, maxTokens: generation?.maxTokens });
    const out = typeof text === "string" ? text : await text();
    signal.throwIfAborted();
    yield out;
  };
  const deps = { foundation: async () => state.foundation, presence: () => store.load(), bindings: async () => ({ global: {}, characters: {} }),
    presets: async () => createPresetDocument(), provider, write: (change: Parameters<typeof store.transact>[0]) => store.transact(change), now: () => state.now,
    api: async (id: string) => state.api ? { id, apiKey: "k", model: "m", baseUrl: "https://example.test/v1" } : undefined };
  const ready = store.transact((document) => withRoutine ? setRoutine(document, ID, routine, mark) : document);
  return { state, deps, store, ready, record: async () => presenceRecord(await store.load(), ID) };
}

test("a reply becomes rows on the local day, clipped to now and to situations", () => {
  const rows = parseDayPlan("```json\n" + goodReply + "\n```", "UTC", T0)!;
  assert.deepEqual(rows.map((row) => [row.title, row.startsAt, row.endsAt]), [
    ["Breakfast at the bakery", T0, at(10)], ["Clinic rounds", at(10), at(13)], ["Dinner with Bo", at(19), at(23)]]);
  assert.equal(rows[0].moment, "The baker remembered the order.");
  const blocked = parseDayPlan(goodReply, "UTC", T0, [{ startsAt: at(11), endsAt: at(12) }])!;
  assert.deepEqual(blocked.map((row) => [row.title, row.endsAt]), [["Breakfast at the bakery", at(10)], ["Clinic rounds", at(11)], ["Dinner with Bo", at(23)]]);
  const inside = parseDayPlan(goodReply, "UTC", T0, [{ startsAt: at(9), endsAt: at(10, 30) }])!;
  assert.deepEqual(inside.map((row) => [row.title, row.endsAt]), [["Breakfast at the bakery", at(9)], ["Dinner with Bo", at(23)]],
    "a row starting inside a situation is dropped; one running into it is cut");
});

test("a row that ends before now, runs short, or is badly formed is dropped; overlap rejects the whole reply", () => {
  const rows = parseDayPlan(reply([{ start: "05:00", end: "06:00", kind: "sleep", title: "Old" }, { start: "08:00", end: "08:10", kind: "other", title: "Tiny" },
    { start: "11:00", end: "12:00", kind: "nonsense", title: "Bad kind" }, { start: "12:00", end: "13:00", kind: "Meal", title: "Lunch" },
    { start: "25:00", end: "26:00", kind: "meal", title: "Bad time" }, { start: "14:00", end: "02:00", kind: "other", title: "Past midnight" }]), "UTC", T0)!;
  assert.deepEqual(rows.map((row) => row.title), ["Lunch", "Past midnight"]);
  assert.equal(rows[1].endsAt, at(2, 0, 17));
  assert.equal(parseDayPlan(reply([{ start: "09:00", end: "11:00", kind: "work", title: "A" }, { start: "10:00", end: "12:00", kind: "work", title: "B" }]), "UTC", T0), null);
  for (const bad of ["", "none", "{", "{}", reply([])]) assert.equal(parseDayPlan(bad, "UTC", T0), null, bad);
});

test("the prompt carries Universe, direct relations and language, and never a worldbook", async () => {
  const f = fixture(); await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  const prompt = f.state.requests[0].messages[0].content;
  assert.match(prompt, /Harbor City\. A rainy port town\./);
  assert.match(prompt, /Bo: old friend \(trusts Bo\)/);
  assert.doesNotMatch(prompt, /strangers/);
  assert.match(prompt, /Speaking style: terse/);
  assert.match(prompt, /language this character's description is written in/);
  assert.match(prompt, /Their usual rhythm today:/);
  assert.doesNotMatch(prompt, /worldbook/i);
  assert.equal(f.state.requests[0].maxTokens, DAY_PLAN_MAX_TOKENS);
  void dayPlanPrompt;
});

test("opening repeatedly makes one request a day; a new local day plans again", async () => {
  const f = fixture(); await f.ready;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "current");
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "current");
  assert.equal(f.state.requests.length, 1);
  const record = (await f.record())!;
  assert.deepEqual(record.life?.plan, { day: "2026-10-16", claimedAt: T0, status: "done" });
  assert.ok(record.life!.activities.some((item) => item.origin === "plan" && item.title === "Clinic rounds"));
  f.state.now = at(8, 0, 17);
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  assert.equal(f.state.requests.length, 2);
});

test("two simultaneous openings send one request", async () => {
  const f = fixture(); await f.ready;
  const results = await Promise.all([ensureDayPlan(ID, undefined, f.deps), ensureDayPlan(ID, undefined, f.deps)]);
  assert.deepEqual(results.sort(), ["busy", "generated"]);
  assert.equal(f.state.requests.length, 1);
});

test("another tab's fresh claim blocks; a stale claim from a closed page can be taken over", async () => {
  const f = fixture(); await f.ready;
  await f.store.transact((document) => setLifeState(document, ID, { activities: [], reconciledAt: T0, plan: { day: "2026-10-16", claimedAt: T0 - 30_000, status: "claimed" } }));
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "current");
  assert.equal(f.state.requests.length, 0);
  f.state.now = T0 + DAY_PLAN_CLAIM_TTL_MS;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  assert.equal(f.state.requests.length, 1);
});

test("a failed or unusable reply is not retried that day, and the Routine skeleton stays", async () => {
  const f = fixture("no json at all"); await f.ready;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "invalid");
  assert.equal((await f.record())!.life?.plan?.status, "failed");
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "current");
  assert.equal(f.state.requests.length, 1);
  assert.ok(!(await f.record())!.life!.activities.some((item) => item.origin === "plan"));
});

test("a reply that lands after local midnight is discarded and the claimed day marked failed", async () => {
  const f = fixture(() => { f.state.now = at(0, 5, 17); return goodReply; }); await f.ready;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "invalid");
  const record = (await f.record())!;
  assert.equal(record.life?.plan?.status, "failed");
  assert.equal(record.life?.plan?.day, "2026-10-16");
  assert.ok(!record.life!.activities.some((item) => item.origin === "plan"));
});

test("a provider error marks the day failed; an abort does too", async () => {
  const boom = fixture(() => { throw new Error("down"); }); await boom.ready;
  assert.equal(await ensureDayPlan(ID, undefined, boom.deps), "error");
  assert.equal((await boom.record())!.life?.plan?.status, "failed");
  const f = fixture(); await f.ready;
  const controller = new AbortController(); controller.abort();
  assert.equal(await ensureDayPlan(ID, controller.signal, f.deps), "cancelled");
  assert.equal(f.state.requests.length, 0);
});

test("no API or no routine: no request, and the day is not used up", async () => {
  const f = fixture(); await f.ready;
  f.state.api = false;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "no-api");
  assert.equal((await f.record())!.life?.plan, undefined);
  f.state.api = true;
  assert.equal(await ensureDayPlan(ID, undefined, f.deps), "generated");
  const bare = fixture(); await bare.ready;
  const none = fixture(goodReply, false); await none.ready;
  assert.equal(await ensureDayPlan(ID, undefined, none.deps), "no-routine");
  assert.equal(await ensureDayPlan("missing", undefined, bare.deps), "no-character");
  assert.equal(none.state.requests.length, 0);
});

test("applying a plan replaces unstarted skeleton rows and cuts the running one at now", async () => {
  const f = fixture(); await f.ready;
  await f.store.transact((document) => settleLifeDocument(document, ID, "UTC", T0));
  const before = (await f.record())!.life!.activities;
  assert.ok(before.some((item) => item.startsAt >= T0 && !item.origin), "skeleton rows ahead exist");
  await ensureDayPlan(ID, undefined, f.deps);
  const life = (await f.record())!.life!;
  const live = life.activities.filter((item) => item.state !== "cancelled");
  for (let i = 1; i < live.length; i++) assert.ok(live[i].startsAt >= live[i - 1].endsAt, "no overlap");
  assert.ok(life.activities.some((item) => item.origin === "plan" && item.startsAt === T0), "plan starts now");
  for (const item of before.filter((row) => row.endsAt <= T0))
    assert.deepEqual(life.activities.find((row) => row.id === item.id), item, "finished history is unchanged");
  const gone = before.filter((item) => item.startsAt >= T0 && item.startsAt < at(13));
  for (const item of gone) assert.ok(!life.activities.some((x) => x.id === item.id && !x.origin), `${item.title} gave way`);
});

test("plan rows survive a Routine edit and a later settle; Situations still win", async () => {
  const f = fixture(); await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  await f.store.transact((document) => setRoutine(document, ID, { ...routine, defaultStatus: "away" }, mark));
  await f.store.transact((document) => settleLifeDocument(document, ID, "UTC", T0 + HOUR));
  let life = (await f.record())!.life!;
  assert.ok(life.activities.some((item) => item.title === "Dinner with Bo" && item.origin === "plan"), "plan row kept after Routine edit");
  assert.ok(life.activities.some((item) => item.title === "Clinic rounds"));
  await f.store.transact((document) => addSituation(document, ID, { status: "away", reason: "Hospital call", startsAt: at(11), endsAt: at(12) }, mark, T0 + HOUR));
  await f.store.transact((document) => settleLifeDocument(document, ID, "UTC", T0 + HOUR + 60_000));
  life = (await f.record())!.life!;
  const rounds = life.activities.find((item) => item.title === "Clinic rounds")!;
  assert.equal(rounds.endsAt, at(11), "the tail under the situation is dropped");
  assert.ok(life.activities.some((item) => item.title === "Hospital call"));
  const live = life.activities.filter((item) => item.state !== "cancelled");
  for (let i = 1; i < live.length; i++) assert.ok(live[i].startsAt >= live[i - 1].endsAt);
});

test("history never changes: a finished plan row and its revealed Moment are kept as they were", async () => {
  const f = fixture(); await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  const first = (await f.record())!.life!.activities.find((item) => item.title === "Breakfast at the bakery")!;
  await f.store.transact((document) => setRoutine(document, ID, { ...routine, defaultStatus: "dnd" }, mark));
  await f.store.transact((document) => settleLifeDocument(document, ID, "UTC", at(20)));
  const after = (await f.record())!.life!.activities.find((item) => item.id === first.id);
  assert.deepEqual(after, first);
});

test("a plan round-trips through backup normalization unchanged", async () => {
  const f = fixture(); await f.ready;
  await ensureDayPlan(ID, undefined, f.deps);
  const document = await f.store.load();
  assert.deepEqual(normalizePresenceDocument(JSON.parse(JSON.stringify(document))), document);
  void emptyPresenceDocument; void reconcileProjectedLife; void applyDayPlan;
});

test("the chat page and the Life page ask for the plan; the proactive scheduler does not", () => {
  const [room, page, scheduler] = ["components/chat/chat-room.tsx", "components/chat/life-timeline.tsx", "lib/chat/proactive-scheduler.ts"]
    .map((path) => readFileSync(path, "utf8"));
  assert.match(room, /requestDayPlan\(characterId\)/);
  assert.match(page, /requestDayPlan\(character\.characterId\)/);
  assert.doesNotMatch(scheduler, /DayPlan/);
});
