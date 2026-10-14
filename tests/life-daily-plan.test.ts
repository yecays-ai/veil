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

test("local-day windows remain non-overlapping across a daylight-saving transition", () => {
  const now = Date.UTC(2026, 2, 8, 12);
  const activities = projectDailyLife(presence({ timezone: "America/New_York" }), now);
  assert.equal(activities.some((item, index) => index > 0 && item.startsAt < activities[index - 1].endsAt), false);
  assert.ok(activities.every((item) => item.endsAt > item.startsAt));
});

test("a later Routine edit does not rewrite an already projected stretch", () => {
  const original = reconcileProjectedLife(undefined, presence(), mondayNoon);
  const changed = presence({ routine: { defaultStatus: "away", jitterMinutes: 0, blocks: [] } });
  const next = reconcileProjectedLife(original, changed, mondayNoon + HOUR);
  assert.deepEqual(next.activities.filter((item) => item.startsAt < mondayNoon + DAY),
    original.activities.filter((item) => item.startsAt < mondayNoon + DAY));
});

