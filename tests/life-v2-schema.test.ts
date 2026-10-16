import assert from "node:assert/strict";
import test from "node:test";
import { LIFE_KEEPSAKE_LIMIT, lifeTimeline, normalizeLifeActivity, normalizeLifeState, reconcileLifeActivities,
  type LifeActivity, type LifeKeepsake, type LifeState, type LifeThread } from "../lib/life/activity";
import { reconcileProjectedLife } from "../lib/life/plan";
import { recentLife } from "../lib/life/recent";
import { settleLifeDocument } from "../lib/life/settle";
import { emptyPresenceDocument, normalizePresenceDocument, presenceRecord, setLifeState, setRoutine } from "../lib/presence/storage";

const HOUR = 60 * 60_000;
const NOON = Date.UTC(2026, 9, 12, 12);
const row = (id: string, startsAt: number, endsAt: number, extra: Partial<LifeActivity> = {}): LifeActivity =>
  ({ id: `life:${id}`, occurrenceKey: `a|${id}`, kind: "leisure", title: id, startsAt, endsAt, ...extra });
const thread = (id: string, state: LifeThread["state"] = "active", createdAt = 1): LifeThread =>
  ({ id, title: `Thread ${id}`, progress: "Started.", next: "Call back.", state, createdAt, updatedAt: createdAt });
const keepsake = (id: string, weight: LifeKeepsake["weight"] = 3, createdAt = 1): LifeKeepsake =>
  ({ id, text: `Kept ${id}`, weight, createdAt, updatedAt: createdAt });
const full = (): LifeState => ({
  reconciledAt: NOON,
  activities: [row("early", NOON - 3 * HOUR, NOON - 2 * HOUR), row("plan", NOON + HOUR, NOON + 2 * HOUR, { origin: "plan" })],
  threads: [thread("t1"), thread("t2", "paused", 2)], keepsakes: [keepsake("k1"), keepsake("k2", 5, 2)],
  plan: { day: "2026-10-12", claimedAt: NOON - HOUR, status: "done" },
});

test("state written before Life V2 reads back exactly as it was, with no new keys", () => {
  const legacy = { activities: [row("early", NOON - 3 * HOUR, NOON - 2 * HOUR)], reconciledAt: NOON };
  const normalized = normalizeLifeState(legacy);
  assert.equal(JSON.stringify(normalized), JSON.stringify(legacy));
  const document = setLifeState(emptyPresenceDocument(), "a", legacy);
  assert.equal(JSON.stringify(normalizePresenceDocument(JSON.parse(JSON.stringify(document)))), JSON.stringify(document));
});

test("threads, keepsakes, the day mark and row flags survive a Presence round trip in one fixed order", () => {
  const life = full();
  const scrambled = { ...life, threads: [...life.threads!].reverse(), keepsakes: [...life.keepsakes!].reverse() };
  const stored = normalizeLifeState(scrambled)!;
  assert.deepEqual(stored.threads?.map((item) => item.id), ["t1", "t2"]);
  assert.deepEqual(stored.keepsakes?.map((item) => item.id), ["k1", "k2"]);
  const document = setLifeState(emptyPresenceDocument(), "a", scrambled);
  const restored = normalizePresenceDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(presenceRecord(restored, "a")?.life, stored);
  assert.equal(JSON.stringify(restored), JSON.stringify(document), "a backup of this state equals its normalized form");
  assert.equal(stored.activities[1].origin, "plan");
});

test("a bad optional record is left out and never costs the activities or the other records", () => {
  const base = full();
  const cases: [string, Partial<LifeState> | Record<string, unknown>, keyof LifeState][] = [
    ["four active threads", { threads: [1, 2, 3, 4].map((n) => thread(`t${n}`, "active", n)) }, "threads"],
    ["six paused threads", { threads: [1, 2, 3, 4, 5, 6].map((n) => thread(`t${n}`, "paused", n)) }, "threads"],
    ["duplicate thread id", { threads: [thread("t1"), thread("t1", "paused", 2)] }, "threads"],
    ["empty thread list", { threads: [] }, "threads"],
    ["over-limit keepsakes", { keepsakes: Array.from({ length: LIFE_KEEPSAKE_LIMIT + 1 }, (_, n) => keepsake(`k${n}`, 3, n)) }, "keepsakes"],
    ["weight 6", { keepsakes: [{ ...keepsake("k1"), weight: 6 }] }, "keepsakes"],
    ["impossible day", { plan: { day: "2026-02-30", claimedAt: 1, status: "claimed" } }, "plan"],
    ["unknown plan status", { plan: { day: "2026-10-12", claimedAt: 1, status: "later" } }, "plan"],
  ];
  for (const [name, change, key] of cases) {
    const state = normalizeLifeState({ ...base, ...change });
    assert.ok(state, name);
    assert.equal(key in state!, false, `${name}: the bad record is dropped`);
    assert.equal(state!.activities.length, 2, `${name}: activities are kept`);
    for (const other of ["threads", "keepsakes", "plan"] as const) if (other !== key) assert.ok(other in state!, `${name}: ${other} is kept`);
  }
  assert.equal(normalizeLifeState({ ...base, threads: [1, 2, 3].map((n) => thread(`t${n}`, "active", n)) })?.threads?.length, 3);
});

test("an unknown row flag makes the row invalid instead of being guessed", () => {
  assert.equal(normalizeLifeActivity({ ...row("x", 1, 2), origin: "model" }), null);
  assert.equal(normalizeLifeActivity({ ...row("x", 1, 2), state: "moved" }), null);
});

test("a cancelled row did not happen: it never blocks time and is never shown or told", () => {
  const cancelled = row("lunch", NOON - 2 * HOUR, NOON - HOUR, { state: "cancelled" });
  const replacement = row("errand", NOON - 2 * HOUR, NOON - HOUR, { origin: "plan" });
  const state = reconcileLifeActivities(undefined, [cancelled, replacement], NOON);
  assert.equal(state.activities.length, 2);
  assert.throws(() => reconcileLifeActivities(undefined, [replacement, row("other", NOON - 2 * HOUR, NOON - HOUR)], NOON), /overlap/);
  assert.deepEqual(lifeTimeline(state, NOON).completed.map((item) => item.title), ["errand"]);
  assert.deepEqual(recentLife(state, [], NOON).map((item) => item.title), ["errand"]);
  assert.ok(normalizeLifeState({ ...state }));
});

test("settling and reconciling hand the Life V2 records on untouched", () => {
  const life = full();
  const inputs = { characterId: "a", timezone: "UTC", routine: null, situations: [] };
  const next = reconcileProjectedLife(life, inputs, NOON + 60_000);
  assert.deepEqual([next.threads, next.keepsakes, next.plan], [life.threads, life.keepsakes, life.plan]);
  const routine = { defaultStatus: "online" as const, jitterMinutes: 0, blocks: [
    { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" as const }] };
  const mark = { at: 0, source: null } as never;
  const document = setLifeState(setRoutine(emptyPresenceDocument(), "a", routine, mark), "a", { ...life, activities: [] });
  const settled = settleLifeDocument(document, "a", "UTC", NOON + 9 * HOUR);
  const record = presenceRecord(settled, "a")!.life!;
  assert.ok(record.activities.length > 0, "the settle really wrote");
  assert.deepEqual([record.threads, record.keepsakes, record.plan], [life.threads, life.keepsakes, life.plan]);
});
