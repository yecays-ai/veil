import assert from "node:assert/strict";
import test from "node:test";
import { lifeActivityStatus, lifeMomentRevealAt, lifeTimeline, normalizeLifeState, reconcileLifeActivities,
  type LifeActivity } from "../lib/life/activity";
import { emptyPresenceDocument, normalizePresenceDocument, presenceRecord, setLifeState } from "../lib/presence/storage";

const HOUR = 60 * 60_000;
const lunch = (overrides: Partial<LifeActivity> = {}): LifeActivity => ({
  id: "peter:2026-10-14:lunch", occurrenceKey: "peter|2026-10-14|lunch", kind: "meal",
  title: "Lunch", startsAt: 12 * HOUR, endsAt: 13 * HOUR,
  moment: "The new place was much worse than its photo.", ...overrides,
});

test("the same planned lunch stays one activity across repeated wakeups", () => {
  const first = reconcileLifeActivities(undefined, [lunch()], 11 * HOUR);
  const second = reconcileLifeActivities(first, [lunch({ id: "another-id", title: "Prepare lunch",
    moment: "This replacement must not overwrite the settled detail." })], 11 * HOUR + 10);
  assert.equal(second.activities.length, 1);
  assert.deepEqual(second.activities[0], lunch());
});

test("activity status is a projection of absolute time and survives a closed page", () => {
  const activity = lunch();
  assert.equal(lifeActivityStatus(activity, 11 * HOUR), "upcoming");
  assert.equal(lifeActivityStatus(activity, 12 * HOUR), "active");
  assert.equal(lifeActivityStatus(activity, 13 * HOUR), "completed");
  const state = reconcileLifeActivities(undefined, [activity], 11 * HOUR);
  assert.equal(lifeTimeline(state, 12 * HOUR + 30_000).current?.occurrenceKey, activity.occurrenceKey);
  assert.equal(lifeTimeline(state, 14 * HOUR).completed[0]?.occurrenceKey, activity.occurrenceKey);
  assert.deepEqual(lifeTimeline(state, 14 * HOUR, 0).completed, []);
});

test("a row id cannot be reused for another occurrence", () => {
  const state = reconcileLifeActivities(undefined, [lunch()], 11 * HOUR);
  assert.throws(() => reconcileLifeActivities(state, [lunch({ occurrenceKey: "peter|2026-10-15|lunch" })], 11 * HOUR),
    /ID collision/);
});

test("the first core rejects two simultaneous primary activities", () => {
  assert.throws(() => reconcileLifeActivities(undefined, [lunch(), lunch({ id: "patrol", occurrenceKey: "patrol",
    kind: "work", title: "Patrol", startsAt: 12 * HOUR + 30_000, endsAt: 14 * HOUR })], 11 * HOUR), /overlap/);
});

test("direct persisted state cannot bypass the retention window", () => {
  const reconciledAt = 10 * 24 * HOUR;
  assert.equal(normalizeLifeState({ reconciledAt, activities: [lunch({ startsAt: HOUR, endsAt: 2 * HOUR })] }), null);
  assert.equal(normalizeLifeState({ reconciledAt, activities: [lunch({
    startsAt: reconciledAt + 4 * 24 * HOUR, endsAt: reconciledAt + 4 * 24 * HOUR + HOUR,
  })] }), null);
});

test("a backward clock change uses the last reconciliation time consistently", () => {
  const now = 10 * 24 * HOUR;
  const future = lunch({ startsAt: now + 3 * 24 * HOUR, endsAt: now + 3 * 24 * HOUR + HOUR });
  const state = reconcileLifeActivities(undefined, [future], now);
  const afterClockChange = reconcileLifeActivities(state, [], now - HOUR);
  assert.deepEqual(afterClockChange.activities, [future]);
  assert.equal(afterClockChange.reconciledAt, now);
});

test("persisted life state is strict, bounded and preserved by Presence normalization", () => {
  const life = reconcileLifeActivities(undefined, [lunch()], 11 * HOUR);
  const document = setLifeState(emptyPresenceDocument(), "peter", life);
  const restored = normalizePresenceDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(presenceRecord(restored, "peter")?.life, life);
  assert.equal(normalizeLifeState({ ...life, activities: [lunch(), lunch({ id: "two" })] }), null,
    "one occurrence cannot be stored twice even under different row ids");
});

test("one activity carries at most one short settled Moment", () => {
  assert.equal(normalizeLifeState({ reconciledAt: 1, activities: [lunch({ moment: "x".repeat(281) })] }), null);
  const valid = normalizeLifeState({ reconciledAt: 1, activities: [lunch({ moment: "Told a joke. Nobody laughed." })] });
  assert.equal(valid?.activities[0].moment, "Told a joke. Nobody laughed.");
});

test("the timeline only shows a repeated settled moment once without changing stored history", () => {
  const repeated = "Spilled a little water and cleaned it up before anyone noticed.";
  const older = lunch({ id: "older", occurrenceKey: "older", startsAt: 8 * HOUR, endsAt: 9 * HOUR, moment: repeated });
  const newer = lunch({ id: "newer", occurrenceKey: "newer", startsAt: 10 * HOUR, endsAt: 11 * HOUR, moment: repeated });
  const state = reconcileLifeActivities(undefined, [older, newer], 12 * HOUR);

  const timeline = lifeTimeline(state, 12 * HOUR);
  assert.equal(timeline.completed.find((item) => item.id === "newer")?.moment, repeated);
  assert.equal(timeline.completed.find((item) => item.id === "older")?.moment, undefined);
  assert.equal(state.activities.filter((item) => item.moment === repeated).length, 2,
    "display deduplication must not rewrite persisted settled activity");
});

test("nothing planned ahead is shown, and a Moment appears only once its time inside the activity has come", () => {
  const later = lunch({ id: "later", occurrenceKey: "later", startsAt: 20 * HOUR, endsAt: 21 * HOUR, moment: "Found a shortcut." });
  const now = lunch({ id: "now", occurrenceKey: "now", startsAt: 12 * HOUR, endsAt: 14 * HOUR, moment: "Heard a song." });
  const state = reconcileLifeActivities(undefined, [now, later], 12 * HOUR);

  const atStart = lifeTimeline(state, 12 * HOUR);
  assert.equal(atStart.current?.id, "now");
  assert.equal(atStart.current?.moment, undefined, "the Moment has not happened at the start");
  assert.deepEqual(Object.keys(atStart), ["current", "completed"]);
  assert.equal(JSON.stringify(atStart).includes("Found a shortcut."), false, "a later activity is not exposed at all");

  const reveal = lifeMomentRevealAt(now);
  assert.ok(reveal >= 12 * HOUR + 0.3 * 2 * HOUR - 1 && reveal <= 12 * HOUR + 0.7 * 2 * HOUR + 1);
  assert.equal(lifeMomentRevealAt(now), reveal, "stable for the occurrence");
  assert.equal(lifeTimeline(state, reveal - 1).current?.moment, undefined);
  assert.equal(lifeTimeline(state, reveal).current?.moment, "Heard a song.");
  assert.equal(lifeTimeline(state, 14 * HOUR).completed[0].moment, "Heard a song.", "stays once finished");
  assert.equal(state.activities.find((item) => item.id === "now")?.moment, "Heard a song.", "stored data is unchanged");
});

