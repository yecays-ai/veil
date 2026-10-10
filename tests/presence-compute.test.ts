import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_ONLINE_LOOKBACK_MS, SITUATION_DEFAULT_MS, SITUATION_MAX_MS, effectivePresence, lastOnlineAt,
  nextPresenceChange, normalizeSituation,
  type PresenceInputs, type PresenceRoutine, type PresenceSituation,
} from "../lib/presence/compute";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
// 09:00–17:00 busy, 22:00–07:00 offline (overnight), online otherwise; no jitter unless a test adds it.
const routine: PresenceRoutine = { defaultStatus: "online", jitterMinutes: 0, blocks: [
  { days: EVERY_DAY, startMinute: 9 * 60, endMinute: 17 * 60, status: "busy" },
  { days: EVERY_DAY, startMinute: 22 * 60, endMinute: 7 * 60, status: "offline" },
] };
const inputs = (patch: Partial<PresenceInputs> = {}): PresenceInputs =>
  ({ characterId: "character-a", timezone: "UTC", routine, situations: [], ...patch });
const at = (iso: string) => Date.parse(iso);
const situation = (status: PresenceSituation["status"], startsAt: string, endsAt: string): PresenceSituation =>
  ({ status, reason: null, startsAt: at(startsAt), endsAt: at(endsAt) });

test("the routine decides status in the Character's own timezone, including overnight blocks", () => {
  assert.equal(effectivePresence(inputs(), at("2026-10-12T10:00:00Z")).status, "busy");
  assert.equal(effectivePresence(inputs(), at("2026-10-12T18:00:00Z")).status, "online");
  assert.equal(effectivePresence(inputs(), at("2026-10-12T23:30:00Z")).status, "offline");
  assert.equal(effectivePresence(inputs(), at("2026-10-13T03:00:00Z")).status, "offline");
  assert.equal(effectivePresence(inputs(), at("2026-10-13T07:00:00Z")).status, "online");
  // 10:00 UTC is 18:00 in Shanghai: free time there, not work.
  const shanghai = inputs({ timezone: "Asia/Shanghai" });
  assert.equal(effectivePresence(shanghai, at("2026-10-12T10:00:00Z")).status, "online");
  assert.equal(effectivePresence(shanghai, at("2026-10-12T02:00:00Z")).status, "busy");
  // Invalid timezones fall back to UTC instead of throwing.
  assert.equal(effectivePresence(inputs({ timezone: "Not/AZone" }), at("2026-10-12T10:00:00Z")).status, "busy");
});

test("routine edges follow daylight saving changes in the Character's timezone", () => {
  const ny = inputs({ timezone: "America/New_York" });
  // 09:00 local is 14:00Z before the 2026-03-08 switch and 13:00Z after it.
  assert.equal(effectivePresence(ny, at("2026-03-06T13:30:00Z")).status, "online");
  assert.equal(effectivePresence(ny, at("2026-03-06T14:00:00Z")).status, "busy");
  assert.equal(effectivePresence(ny, at("2026-03-09T13:00:00Z")).status, "busy");
  assert.equal(effectivePresence(ny, at("2026-03-09T12:59:00Z")).status, "online");
  // A block ending inside the skipped hour (02:00–03:00 does not exist on 2026-03-08) keeps its order:
  // 01:50 EST is 06:50Z and the skipped 02:10 moves forward to 03:10 EDT, 07:10Z.
  const gap = inputs({ timezone: "America/New_York", routine: { defaultStatus: "online", jitterMinutes: 0,
    blocks: [{ days: EVERY_DAY, startMinute: 110, endMinute: 130, status: "busy" }] } });
  assert.equal(effectivePresence(gap, at("2026-03-08T06:55:00Z")).status, "busy");
  assert.equal(nextPresenceChange(gap, at("2026-03-08T06:00:00Z")), at("2026-03-08T06:50:00Z"));
  assert.equal(nextPresenceChange(gap, at("2026-03-08T06:50:00Z")), at("2026-03-08T07:10:00Z"));
  // A repeated hour (01:00–02:00 happens twice on 2026-11-01) resolves to its first occurrence.
  const repeat = inputs({ timezone: "America/New_York", routine: { defaultStatus: "online", jitterMinutes: 0,
    blocks: [{ days: EVERY_DAY, startMinute: 90, endMinute: 180, status: "busy" }] } });
  assert.equal(nextPresenceChange(repeat, at("2026-11-01T04:00:00Z")), at("2026-11-01T05:30:00Z"));
});

test("without a routine the Character reads offline, and a later block wins an overlap", () => {
  assert.equal(effectivePresence(inputs({ routine: null }), at("2026-10-12T10:00:00Z")).status, "offline");
  const overlapping: PresenceRoutine = { ...routine, blocks: [...routine.blocks,
    { days: EVERY_DAY, startMinute: 12 * 60, endMinute: 13 * 60, status: "away" }] };
  assert.equal(effectivePresence(inputs({ routine: overlapping }), at("2026-10-12T12:30:00Z")).status, "away");
  assert.equal(effectivePresence(inputs({ routine: overlapping }), at("2026-10-12T13:00:00Z")).status, "busy");
});

test("an active situation wins over the routine and the routine resumes when it ends", () => {
  const mission = situation("offline", "2026-10-12T08:00:00Z", "2026-10-15T08:00:00Z");
  const withMission = inputs({ situations: [mission] });
  assert.deepEqual(effectivePresence(withMission, at("2026-10-12T08:00:00Z")),
    { status: "offline", source: "situation", situation: mission });
  assert.equal(effectivePresence(withMission, at("2026-10-13T18:00:00Z")).status, "offline");
  // End is exclusive: at that instant the routine is back without anyone clearing the situation.
  assert.deepEqual(effectivePresence(withMission, at("2026-10-15T08:00:00Z")),
    { status: "online", source: "routine", situation: null });
  // An upcoming situation does nothing until it starts.
  assert.deepEqual(effectivePresence(withMission, at("2026-10-12T07:59:00Z")),
    { status: "online", source: "routine", situation: null });
});

test("of overlapping situations, the most recently started one wins", () => {
  const trip = situation("away", "2026-10-12T00:00:00Z", "2026-10-14T00:00:00Z");
  const call = situation("busy", "2026-10-12T18:00:00Z", "2026-10-12T19:00:00Z");
  assert.equal(effectivePresence(inputs({ situations: [call, trip] }), at("2026-10-12T18:30:00Z")).status, "busy");
  assert.equal(effectivePresence(inputs({ situations: [call, trip] }), at("2026-10-12T19:00:00Z")).status, "away");
});

test("normalizeSituation stores absolute times that never start in the past, always end and are capped", () => {
  const now = at("2026-10-12T12:00:00Z");
  assert.deepEqual(normalizeSituation({ status: "busy", reason: "  Emergency  ",
    startsAt: now - HOUR, endsAt: now + 20 * MINUTE }, now),
  { status: "busy", reason: "Emergency", startsAt: now, endsAt: now + 20 * MINUTE });
  assert.deepEqual(normalizeSituation({ status: "away" }, now),
    { status: "away", reason: null, startsAt: now, endsAt: now + SITUATION_DEFAULT_MS });
  const tomorrow = now + DAY;
  assert.equal(normalizeSituation({ status: "offline", startsAt: tomorrow, endsAt: tomorrow + 60 * DAY }, now)?.endsAt,
    tomorrow + SITUATION_MAX_MS);
  assert.equal(normalizeSituation({ status: "busy", startsAt: tomorrow, endsAt: tomorrow }, now), null);
  assert.equal(normalizeSituation({ status: "busy", endsAt: now - HOUR }, now), null);
  assert.equal(normalizeSituation({ status: "sleeping" }, now), null);
  assert.equal(normalizeSituation({ status: "busy", endsAt: Number.NaN }, now)?.endsAt, now + SITUATION_DEFAULT_MS);
  assert.equal(normalizeSituation({ status: "busy", reason: "x".repeat(500) }, now)?.reason?.length, 200);
});

test("jitter moves routine edges by a stable, bounded amount that differs by day and Character", () => {
  const jittered: PresenceRoutine = { ...routine, jitterMinutes: 30 };
  const nominalBusyStart = (day: string) => at(`${day}T09:00:00Z`);
  const busyStart = (characterId: string, day: string) =>
    nextPresenceChange(inputs({ characterId, routine: jittered }), at(`${day}T08:00:00Z`), 3 * HOUR)!;
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
  const starts = days.map((day) => busyStart("character-a", day));
  starts.forEach((start, index) => {
    assert.ok(Math.abs(start - nominalBusyStart(days[index])) <= 30 * MINUTE);
    // Same inputs, same answer: a reopen never moves a past edge.
    assert.equal(busyStart("character-a", days[index]), start);
  });
  assert.ok(new Set(starts.map((start, index) => start - nominalBusyStart(days[index]))).size > 1, "edges vary by day");
  assert.ok(days.some((day, index) => busyStart("character-b", day) !== starts[index]), "edges vary by Character");
  // A short block's edges move at most a quarter of its length, so it can never invert.
  const short: PresenceRoutine = { defaultStatus: "online", jitterMinutes: 120,
    blocks: [{ days: EVERY_DAY, startMinute: 600, endMinute: 640, status: "busy" }] };
  for (const day of days) {
    const edge = nextPresenceChange(inputs({ routine: short }), at(`${day}T09:00:00Z`), 3 * HOUR)!;
    assert.ok(Math.abs(edge - at(`${day}T10:00:00Z`)) <= 10 * MINUTE);
    const back = nextPresenceChange(inputs({ routine: short }), edge, 3 * HOUR)!;
    assert.ok(back > edge);
  }
});

test("nextPresenceChange finds the next real status change, skipping edges that change nothing", () => {
  assert.equal(nextPresenceChange(inputs(), at("2026-10-12T08:00:00Z")), at("2026-10-12T09:00:00Z"));
  // A busy situation ending inside the busy block is not a visible change.
  const meeting = situation("busy", "2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z");
  assert.equal(nextPresenceChange(inputs({ situations: [meeting] }), at("2026-10-12T10:30:00Z")), at("2026-10-12T17:00:00Z"));
  assert.equal(nextPresenceChange(inputs({ routine: null }), at("2026-10-12T08:00:00Z")), null);
});

test("lastOnlineAt is now while online, otherwise the end of the newest online stretch in a bounded window", () => {
  assert.equal(lastOnlineAt(inputs(), at("2026-10-12T18:00:00Z")), at("2026-10-12T18:00:00Z"));
  assert.equal(lastOnlineAt(inputs(), at("2026-10-12T10:00:00Z")), at("2026-10-12T09:00:00Z"));
  assert.equal(lastOnlineAt(inputs(), at("2026-10-13T03:00:00Z")), at("2026-10-12T22:00:00Z"));
  // A mission that started at 18:00 hides the evening: he was last online when he left.
  const mission = situation("offline", "2026-10-12T18:00:00Z", "2026-10-16T18:00:00Z");
  assert.equal(lastOnlineAt(inputs({ situations: [mission] }), at("2026-10-14T12:00:00Z")), at("2026-10-12T18:00:00Z"));
  // Nothing online inside the lookback window gives null rather than an invented time.
  assert.equal(lastOnlineAt(inputs({ routine: null }), at("2026-10-12T10:00:00Z")), null);
  const long = situation("offline", "2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z");
  assert.equal(lastOnlineAt(inputs({ situations: [long] }), at("2026-10-14T00:00:00Z")), null);
  assert.equal(LAST_ONLINE_LOOKBACK_MS, 7 * DAY);
});

test("lastOnlineAt never moves backwards as time passes with unchanged inputs", () => {
  const jittered = inputs({ routine: { ...routine, jitterMinutes: 45 } });
  let previous = -Infinity;
  for (let now = at("2026-10-12T00:00:00Z"); now <= at("2026-10-15T00:00:00Z"); now += 17 * MINUTE) {
    const seen = lastOnlineAt(jittered, now);
    assert.ok(seen !== null && seen >= previous && seen <= now);
    previous = seen;
  }
});
