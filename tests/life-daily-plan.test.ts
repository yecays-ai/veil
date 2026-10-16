import assert from "node:assert/strict";
import test from "node:test";
import { projectDailyLife, reconcileProjectedLife } from "../lib/life/plan";
import { reconcileLifeActivities } from "../lib/life/activity";
import type { PresenceInputs } from "../lib/presence/compute";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const mondayNoon = Date.UTC(2026, 9, 12, 12);

const presence = (overrides: Partial<PresenceInputs> = {}): PresenceInputs => ({
  characterId: "peter",
  timezone: "UTC",
  routine: {
    defaultStatus: "online",
    jitterMinutes: 0,
    blocks: [
      { days: [0, 1, 2, 3, 4, 5, 6], startMinute: 0, endMinute: 8 * 60, status: "offline" },
      { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" },
    ],
  },
  situations: [],
  ...overrides,
});

test("daily projection is stable across repeated wakeups and makes no duplicate activity", () => {
  const first = projectDailyLife(presence(), mondayNoon);
  const second = projectDailyLife(presence(), mondayNoon + 10 * 60_000);
  assert.deepEqual(second, first);
  const once = reconcileLifeActivities(undefined, first, mondayNoon);
  const twice = reconcileLifeActivities(once, second, mondayNoon + 10 * 60_000);
  assert.deepEqual(twice.activities, once.activities);
});

test("routine status becomes a coarse plan and an active situation supplies its own title", () => {
  const inputs = presence({ situations: [{ status: "busy", reason: "Patrol", startsAt: mondayNoon,
    endsAt: mondayNoon + 2 * HOUR }] });
  const activities = projectDailyLife(inputs, mondayNoon);
  assert.ok(activities.some((item) => item.kind === "sleep" && item.title === "Sleeping"));
  assert.ok(activities.some((item) => item.kind === "work" && item.title === "Patrol"
    && item.startsAt === mondayNoon && item.endsAt === mondayNoon + 2 * HOUR));
  assert.equal(activities.some((item, index) => index > 0 && item.startsAt < activities[index - 1].endsAt), false);
});

test("a Character without a Routine records only explicit Situations, not invented all-day sleep", () => {
  const inputs = presence({ routine: null, situations: [{ status: "busy", reason: "Patrol", startsAt: mondayNoon,
    endsAt: mondayNoon + 2 * HOUR }] });
  assert.deepEqual(projectDailyLife(inputs, mondayNoon).map(({ kind, title, startsAt, endsAt }) =>
    ({ kind, title, startsAt, endsAt })), [{ kind: "work", title: "Patrol", startsAt: mondayNoon,
    endsAt: mondayNoon + 2 * HOUR }]);
});

test("the planner covers yesterday through tomorrow without inventing a model catch-up call", () => {
  const activities = projectDailyLife(presence(), mondayNoon);
  assert.ok(activities[0].startsAt >= mondayNoon - DAY - 12 * HOUR);
  assert.ok(activities.at(-1)!.endsAt <= mondayNoon + 2 * DAY);
  assert.ok(activities.length <= 36, "at most twelve coarse segments per local day");
  assert.ok(activities.every((item) => !item.moment || item.kind !== "sleep"));
});

test("planned anecdotes are unique within the projection and avoid recent settled wording", () => {
  const avoid = "Found something unexpectedly funny.";
  const first = projectDailyLife(presence(), mondayNoon, [avoid]);
  const second = projectDailyLife(presence(), mondayNoon, [avoid]);
  const details = first.flatMap((item) => item.moment ? [item.moment] : []);

  assert.deepEqual(second, first);
  assert.equal(details.includes(avoid), false);
  assert.equal(new Set(details).size, details.length);
});

test("reconciliation forwards retained moments and ignores activities outside the retention window", () => {
  const now = mondayNoon + DAY;
  const candidate = projectDailyLife(presence(), now).find((item) => item.moment);
  assert.ok(candidate?.moment, "fixture must select a moment to exercise the guard");

  const retainedAt = now - 6 * DAY;
  const retained = reconcileLifeActivities(undefined, [{ ...candidate, id: "stored-recent", occurrenceKey: "stored-recent",
    startsAt: retainedAt, endsAt: retainedAt + HOUR }], retainedAt);
  const planned = reconcileProjectedLife(retained, presence(), now);
  assert.notEqual(planned.activities.find((item) => item.occurrenceKey === candidate.occurrenceKey)?.moment, candidate.moment,
    "a retained activity's moment must be passed to the new projection");

  const expiredAt = now - 10 * DAY;
  const expired = reconcileLifeActivities(undefined, [{ ...candidate, id: "stored-expired", occurrenceKey: "stored-expired",
    startsAt: expiredAt, endsAt: expiredAt + HOUR }], expiredAt);
  const plannedAfterExpiry = reconcileProjectedLife(expired, presence(), now);
  assert.equal(plannedAfterExpiry.activities.find((item) => item.occurrenceKey === candidate.occurrenceKey)?.moment, candidate.moment,
    "a moment whose activity will be pruned must not suppress the replacement plan");
});

test("local-day windows remain non-overlapping across a daylight-saving transition", () => {
  const now = Date.UTC(2026, 2, 8, 12);
  const activities = projectDailyLife(presence({ timezone: "America/New_York" }), now);
  assert.equal(activities.some((item, index) => index > 0 && item.startsAt < activities[index - 1].endsAt), false);
  assert.ok(activities.every((item) => item.endsAt > item.startsAt));
});

test("a later Routine edit keeps what has begun and lets the rest follow the new status", () => {
  const now = mondayNoon + HOUR;   // 13:00, inside the 09:00–17:00 busy block
  const original = reconcileProjectedLife(undefined, presence(), mondayNoon);
  const changed = presence({ routine: { defaultStatus: "away", jitterMinutes: 0, blocks: [] } });
  const next = reconcileProjectedLife(original, changed, now);
  const finished = original.activities.filter((item) => item.endsAt <= now);
  assert.ok(finished.length > 0);
  assert.deepEqual(next.activities.slice(0, finished.length), finished, "finished activities are never rewritten");
  const running = original.activities.find((item) => item.startsAt <= now && now < item.endsAt)!;
  const cut = next.activities.find((item) => item.id === running.id)!;
  assert.equal(cut.startsAt, running.startsAt);
  assert.equal(cut.endsAt, now, "the running activity is cut where the edit happened");
  const here = next.activities.find((item) => item.startsAt <= now && now < item.endsAt)!;
  assert.equal(here.title, "Out and about", "the current activity agrees with the new status");
  assert.equal(next.activities.some((item) => item.title === "Working" && item.startsAt >= now), false, "the old plan is gone");
  assert.equal(next.activities.some((item, index) => index > 0 && item.startsAt < next.activities[index - 1].endsAt), false);
  assert.deepEqual(reconcileProjectedLife(next, changed, now + 60_000).activities, next.activities, "settling again changes nothing");
});

test("an unrevealed Moment of a cut activity is dropped and a revealed one stays", () => {
  const changed = presence({ routine: { defaultStatus: "away", jitterMinutes: 0, blocks: [] } });
  let original = reconcileProjectedLife(undefined, presence(), mondayNoon);
  for (let day = 1; day < 40 && !original.activities.some((item) => item.moment && item.startsAt > mondayNoon); day++)
    original = reconcileProjectedLife(undefined, presence(), mondayNoon + day * DAY);
  const withMoment = original.activities.filter((item) => item.moment && item.startsAt > original.reconciledAt - DAY);
  assert.ok(withMoment.length > 0, "fixture needs a Moment");
  for (const item of withMoment) {
    const before = reconcileProjectedLife(original, changed, item.startsAt + 1000);
    assert.equal(before.activities.find((row) => row.id === item.id)?.moment, undefined, "not yet happened, so it is not kept");
    const after = reconcileProjectedLife(original, changed, item.endsAt - 1000);
    assert.equal(after.activities.find((row) => row.id === item.id)?.moment, item.moment, "already revealed, so it stays");
  }
});

test("a Situation set after the day was settled replaces the rest of it without rewriting the past", () => {
  const now = mondayNoon + HOUR;
  const original = reconcileProjectedLife(undefined, presence(), now);
  const withSituation = presence({ situations: [{ status: "away", reason: "Hospital visit", startsAt: now, endsAt: now + 3 * HOUR }] });
  const next = reconcileProjectedLife(original, withSituation, now + 60_000);
  const finished = original.activities.filter((item) => item.endsAt <= now);
  assert.deepEqual(next.activities.slice(0, finished.length), finished);
  const here = next.activities.find((item) => item.startsAt <= now + 60_000 && now + 60_000 < item.endsAt)!;
  assert.equal(here.title, "Hospital visit");
  assert.equal(next.activities.some((item, index) => index > 0 && item.startsAt < next.activities[index - 1].endsAt), false);
});
