import assert from "node:assert/strict";
import test from "node:test";
import type { PresenceRoutine } from "../lib/presence/compute";
import type { PresenceRecord } from "../lib/presence/storage";
import { presenceText, presenceView, relativeAge } from "../lib/presence/view";

const HOUR = 3_600_000, MINUTE = 60_000, NOW = Date.UTC(2026, 9, 12, 12, 0);
const character = { characterId: "a", timezone: "UTC" };
const onlineRoutine: PresenceRoutine = { blocks: [], defaultStatus: "online", jitterMinutes: 0 };
const record = (patch: Partial<PresenceRecord>): PresenceRecord => ({ characterId: "a", routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null, ...patch });
const busy = (startsAt: number, endsAt: number) => ({ status: "busy" as const, reason: null, startsAt, endsAt, changedAt: startsAt, source: null });

test("a Character with no stored data is offline with no Last Seen", () => {
  for (const stored of [undefined, record({})]) {
    const view = presenceView(character, stored, NOW);
    assert.deepEqual([view.status, view.lastSeenAt, view.derivedOnlineAt, view.nextChangeAt], ["offline", null, null, null]);
    assert.equal(presenceText(view, NOW), "Offline");
  }
});

test("an online Character shows Online without a Last Seen", () => {
  const view = presenceView(character, record({ routine: { routine: onlineRoutine, changedAt: 1, source: null } }), NOW);
  assert.equal(view.status, "online");
  assert.equal(presenceText(view, NOW), "Online");
});

test("a busy Character shows when it was last online, taking the latest of derived and stored times", () => {
  const routine = { routine: onlineRoutine, changedAt: 1, source: null };
  const situations = [busy(NOW - HOUR, NOW + HOUR)];
  const derived = presenceView(character, record({ routine, situations }), NOW);
  assert.deepEqual([derived.status, derived.lastSeenAt, derived.derivedOnlineAt, derived.nextChangeAt], ["busy", NOW - HOUR, NOW - HOUR, NOW + HOUR]);
  assert.equal(presenceText(derived, NOW), "Busy · Last seen 1h ago");
  // A later stored Character message wins; an earlier stored online time and one from the future do not.
  assert.equal(presenceView(character, record({ routine, situations, lastMessageAt: NOW - 5 * MINUTE }), NOW).lastSeenAt, NOW - 5 * MINUTE);
  assert.equal(presenceView(character, record({ routine, situations, lastOnlineAt: NOW - 3 * HOUR }), NOW).lastSeenAt, NOW - HOUR);
  assert.equal(presenceView(character, record({ routine, situations, lastOnlineAt: NOW + HOUR }), NOW).lastSeenAt, NOW - HOUR);
});

test("stored Last Seen outlives a routine that no longer shows the online time", () => {
  const view = presenceView(character, record({ lastOnlineAt: NOW - 9 * 24 * HOUR }), NOW);
  assert.deepEqual([view.status, view.derivedOnlineAt, view.lastSeenAt], ["offline", null, NOW - 9 * 24 * HOUR]);
  assert.equal(presenceText(view, NOW), "Offline · Last seen 9d ago");
});

test("the same inputs give the same answer", () => {
  const stored = record({ routine: { routine: onlineRoutine, changedAt: 1, source: null }, situations: [busy(NOW - HOUR, NOW + HOUR)] });
  assert.deepEqual(presenceView(character, stored, NOW), presenceView(character, stored, NOW));
});

test("relative ages round down and never go negative", () => {
  assert.deepEqual([0, 59_999, MINUTE, 59 * MINUTE, HOUR, 23 * HOUR + 59 * MINUTE, 24 * HOUR, 50 * HOUR].map((age) => relativeAge(NOW - age, NOW)),
    ["just now", "just now", "1m ago", "59m ago", "1h ago", "23h ago", "1d ago", "2d ago"]);
  assert.equal(relativeAge(NOW + HOUR, NOW), "just now");
});
