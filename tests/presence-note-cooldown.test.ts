import assert from "node:assert/strict";
import test from "node:test";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { actionAllowance, NOTE_COOLDOWN_MS } from "../lib/presence/actions";
import type { PresenceRecord } from "../lib/presence/storage";

const at = Date.parse("2026-10-14T00:00:00Z"), minute = 60_000;
const character = { characterId: "a", timezone: "UTC", statusMessage: null };
const record: PresenceRecord = { characterId: "a", routine: null, situations: [], signature: null,
  lastOnlineAt: null, lastMessageAt: null, userNote: { text: "Honey", source: "character:reply", changedAt: at } };

test("the note cooldown hint follows the same clock and deadline as action eligibility", () => {
  for (const [elapsed, remaining] of [[3 * 60 * minute, "9 小时"], [NOTE_COOLDOWN_MS - 30 * minute, "30 分钟"],
    [NOTE_COOLDOWN_MS - 1, "1 分钟"]] as const) {
    const now = at + elapsed;
    assert.equal(actionAllowance(record, now).note, false);
    const state = selfState(character, undefined, record, now);
    assert.equal(state.canChange?.note, false);
    assert.ok(selfStateContent(state)?.includes(`你已经使用过本次修改备注的机会，请在 ${remaining}后再试。`));
    assert.doesNotMatch(selfStateContent(state)!, /"userNote": what you now call/);
  }
  const ready = selfState(character, undefined, record, at + NOTE_COOLDOWN_MS);
  assert.equal(actionAllowance(record, at + NOTE_COOLDOWN_MS).note, true);
  assert.equal(ready.canChange?.note, true);
  assert.doesNotMatch(selfStateContent(ready)!, /已经使用过/);
  assert.match(selfStateContent(ready)!, /"userNote": what you now call/);
});

test("user edits do not start the Character cooldown, and Continue does not invite actions", () => {
  const edited = { ...record, userNote: { ...record.userNote!, source: "user" } };
  assert.equal(actionAllowance(edited, at).note, true);
  assert.doesNotMatch(selfStateContent(selfState(character, undefined, edited, at))!, /已经使用过/);
  const continuing = selfState(character, undefined, record, at, null, false, false);
  assert.equal(continuing.canChange, null);
  assert.doesNotMatch(selfStateContent(continuing)!, /已经使用过|"userNote": what you now call/);
});
