import assert from "node:assert/strict";
import test from "node:test";
import { LIFE_ACTIVITY_LIMIT, reconcileLifeActivities, type LifeActivity } from "../lib/life/activity";
import { recentLife } from "../lib/life/recent";
import { settleLifeDocument } from "../lib/life/settle";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { emptyPresenceDocument, presenceRecord, setRoutine, addSituation } from "../lib/presence/storage";
import { normalizeCharacterInput } from "../lib/foundation-types";

const HOUR = 3_600_000;
const NOON = Date.UTC(2026, 9, 12, 12);
const mark = { at: 0, source: null } as never;
const routine = { defaultStatus: "online" as const, jitterMinutes: 0, blocks: [
  { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 8 * 60, status: "offline" as const },
  { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" as const },
] };
const character = { characterId: "a", ...normalizeCharacterInput({ name: "A", timezone: "UTC" }) };
const activity = (id: string, startsAt: number, endsAt: number, extra: Partial<LifeActivity> = {}): LifeActivity =>
  ({ id: `life:${id}`, occurrenceKey: `a|${id}`, kind: "work", title: "Working", startsAt, endsAt, ...extra });
const documentWithRoutine = () => setRoutine(emptyPresenceDocument(), "a", routine, mark);

test("settling after hours away stores finished time without opening the Life page, and repeating it writes nothing", () => {
  const first = settleLifeDocument(documentWithRoutine(), "a", "UTC", NOON + 9 * HOUR);
  const life = presenceRecord(first, "a")!.life!;
  assert.ok(life.activities.some((item) => item.endsAt <= NOON + 9 * HOUR && item.title === "Working"));
  assert.equal(settleLifeDocument(first, "a", "UTC", NOON + 9 * HOUR + 60_000), first, "same document, nothing to write");
});

test("a Character with no routine and no situation is left alone", () => {
  const empty = emptyPresenceDocument();
  assert.equal(settleLifeDocument(empty, "a", "UTC", NOON), empty);
});

test("recent life holds only finished time inside the window, newest four, oldest first", () => {
  const items = Array.from({ length: 6 }, (_, index) => activity(String(index), NOON - (12 - index * 2) * HOUR, NOON - (11 - index * 2) * HOUR, { title: `T${index}` }));
  const result = recentLife({ reconciledAt: NOON, activities: [...items, activity("run", NOON - HOUR, NOON + HOUR, { title: "Now" }),
    activity("next", NOON + 2 * HOUR, NOON + 3 * HOUR, { title: "Later" })] }, [], NOON);
  assert.deepEqual(result.map((item) => item.title), ["T2", "T3", "T4", "T5"]);
  assert.ok(result.length <= 4);
  assert.ok(!result.some((item) => item.title === "Now" || item.title === "Later"), "neither the running nor a planned activity is finished");
});

test("an activity ending exactly now is finished; one starting now is not", () => {
  const life = { reconciledAt: NOON, activities: [activity("done", NOON - 2 * HOUR, NOON, { title: "Done" }), activity("begin", NOON, NOON + HOUR, { title: "Begin" })] };
  assert.deepEqual(recentLife(life, [], NOON).map((item) => item.title), ["Done"]);
});

test("a situation wins over the projected day: only the uncovered time of a Life activity stays", () => {
  const life = { reconciledAt: NOON, activities: [activity("w", NOON - 6 * HOUR, NOON - 2 * HOUR)] };
  const covers = [{ status: "busy" as const, reason: "At the clinic", startsAt: NOON - 4 * HOUR, endsAt: NOON - 3 * HOUR }];
  const result = recentLife(life, covers, NOON);
  assert.deepEqual(result.map((item) => [item.title, item.startsAt, item.endsAt]), [
    ["Working", NOON - 6 * HOUR, NOON - 4 * HOUR], ["At the clinic", NOON - 4 * HOUR, NOON - 3 * HOUR], ["Working", NOON - 3 * HOUR, NOON - 2 * HOUR]]);
  const tiny = recentLife(life, [{ ...covers[0], startsAt: NOON - 6 * HOUR + 5 * 60_000, endsAt: NOON - 2 * HOUR }], NOON);
  assert.ok(!tiny.some((item) => item.title === "Working"), "a five-minute leftover is dropped, not told");
});

test("adjacent identical activities merge and a repeated Moment is told once", () => {
  const life = { reconciledAt: NOON, activities: [activity("1", NOON - 5 * HOUR, NOON - 4 * HOUR, { moment: "Same joke." }),
    activity("2", NOON - 4 * HOUR, NOON - 3 * HOUR), activity("3", NOON - 2 * HOUR, NOON - HOUR, { moment: "Same joke." })] };
  const result = recentLife(life, [], NOON);
  assert.equal(result.length, 2);
  assert.ok(result.filter((item) => item.moment === "Same joke.").length <= 1);
});

test("the prompt separates finished time from the present, plans nothing, and stays optional", () => {
  const life = { reconciledAt: NOON, activities: [activity("w", NOON - 5 * HOUR, NOON - 3 * HOUR), activity("future", NOON + 2 * HOUR, NOON + 3 * HOUR, { title: "Tomorrow plan" })] };
  const record = { characterId: "a", routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null, life };
  const text = selfStateContent(selfState(character, undefined, record as never, NOON))!;
  assert.match(text, /Earlier today, from VEIL's rough record.*07:00–09:00 "Working"/);
  assert.match(text, /not verified events/);
  assert.match(text, /do not bring it up every time/);
  assert.doesNotMatch(text, /Tomorrow plan/);
  assert.equal(selfState(character, undefined, { ...record, life: undefined } as never, NOON).recent, undefined);
});

test("over the 96-activity cap only the oldest finished activities go, never the running or future ones", () => {
  const now = NOON;
  const old = Array.from({ length: LIFE_ACTIVITY_LIMIT }, (_, index) => activity(`o${index}`, now - (LIFE_ACTIVITY_LIMIT - index + 2) * 60 * 60_000 / 4 - HOUR, now - (LIFE_ACTIVITY_LIMIT - index + 1) * 60 * 60_000 / 4 - HOUR));
  const current = { reconciledAt: now, activities: old };
  const running = activity("run", now - 30 * 60_000, now + HOUR, { title: "Running" });
  const future = activity("fut", now + 2 * HOUR, now + 3 * HOUR, { title: "Future" });
  const next = reconcileLifeActivities(current, [running, future], now);
  assert.equal(next.activities.length, LIFE_ACTIVITY_LIMIT);
  assert.ok(next.activities.some((item) => item.title === "Running") && next.activities.some((item) => item.title === "Future"));
  assert.ok(!next.activities.some((item) => item.id === "life:o0"), "the oldest finished one was dropped");
  const crowded = { reconciledAt: now, activities: Array.from({ length: LIFE_ACTIVITY_LIMIT }, (_, i) => activity(`f${i}`, now + (2 * i + 1) * HOUR / 2 / 4, now + (2 * i + 2) * HOUR / 2 / 4)) };
  assert.throws(() => reconcileLifeActivities(crowded, [running], now), /Too many|overlap/, "future time is never traded away");
});

test("a Situation recorded with the document does not break settling", () => {
  const withSituation = addSituation(documentWithRoutine(), "a", { status: "away", reason: "Errand", startsAt: NOON + 10 * HOUR, endsAt: NOON + 11 * HOUR }, mark, NOON);
  const settled = settleLifeDocument(withSituation, "a", "UTC", NOON + 12 * HOUR);
  assert.ok(presenceRecord(settled, "a")!.life);
});
