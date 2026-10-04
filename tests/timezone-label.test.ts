import assert from "node:assert/strict";
import test from "node:test";
import { TIMEZONE_OFFSET_OPTIONS, timezoneLabel } from "../lib/timezone-label";
import { createCharacter, saveUser, updateCharacter } from "../lib/foundation";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";
import { resolveTimezone } from "../lib/participant-config";

test("offset selector values remain valid zones with the advertised offset year-round", () => {
  for (const { timezone, label } of TIMEZONE_OFFSET_OPTIONS) {
    assert.match(label, /^UTC(?:[+−]\d+(?::\d{2})?)?$/);
    assert.equal(resolveTimezone(timezone, null).state, "configured");
    for (const date of ["2026-01-01", "2026-07-01"]) {
      assert.equal(timezoneLabel(timezone, new Date(date)), label);
    }
  }
  for (const label of ["UTC−8", "UTC−5", "UTC", "UTC+1", "UTC+5:30", "UTC+8", "UTC+9"]) {
    assert(TIMEZONE_OFFSET_OPTIONS.some((option) => option.label === label));
  }
});

test("timezone labels show offsets without representative cities or IDs", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  assert.equal(timezoneLabel("Asia/Shanghai", now), "UTC+8");
  assert.equal(timezoneLabel("Asia/Baghdad", now), "UTC+3");
  assert.equal(timezoneLabel("Asia/Kathmandu", now), "UTC+5:45");
  assert.equal(timezoneLabel("UTC", now), "UTC");
  assert.equal(timezoneLabel("US/Pacific", now), "UTC−7");
});

test("offset labels respect daylight saving rather than replacing zone rules", () => {
  assert.equal(timezoneLabel("America/New_York", new Date("2026-07-01")), "UTC−4");
  assert.equal(timezoneLabel("America/New_York", new Date("2026-01-01")), "UTC−5");
});

test("an unavailable label does not claim UTC was detected", () => {
  assert.equal(timezoneLabel("Invalid/Zone"), "Timezone unavailable");
});

test("labels leave User and Character timezone IDs and Location unchanged on round-trip", () => {
  let document = defaultFoundation();
  document = saveUser(document, {
    ...document.user,
    location: { label: "Chengdu", coordinates: null },
    timezone: "Asia/Shanghai",
  });
  document = createCharacter(document, {
    ...normalizeCharacterInput(null),
    timezone: "US/Pacific",
  });
  timezoneLabel(document.user.timezone!);
  timezoneLabel(document.characters[0].timezone!);
  const loaded = normalizeFoundation(JSON.parse(JSON.stringify(document)));
  assert.equal(loaded.user.timezone, "Asia/Shanghai");
  assert.equal(loaded.user.location?.label, "Chengdu");
  assert.equal(loaded.characters[0].timezone, "US/Pacific");
  const cleared = saveUser(loaded, { ...loaded.user, timezone: null });
  const character = cleared.characters[0];
  const bothCleared = updateCharacter(cleared, character.characterId, {
    ...character, timezone: null,
  });
  assert.equal(bothCleared.user.timezone, null);
  assert.equal(bothCleared.characters[0].timezone, null);
  assert.deepEqual(resolveTimezone(loaded.user.timezone, "Europe/London"), {
    timezone: "Asia/Shanghai", state: "configured",
  });
  assert.deepEqual(resolveTimezone(bothCleared.user.timezone, "Europe/London"), {
    timezone: "Europe/London", state: "device",
  });
  assert.deepEqual(resolveTimezone(bothCleared.characters[0].timezone, null), {
    timezone: "UTC", state: "fallback",
  });
});
