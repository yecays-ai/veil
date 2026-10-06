import assert from "node:assert/strict";
import test from "node:test";
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  saveUser,
  saveUniverse,
  saveRelation,
  setNodePosition,
} from "../lib/foundation";
import {
  defaultFoundation,
  normalizeCharacterInput,
  normalizeFoundation,
  UNIVERSE_ID,
} from "../lib/foundation-types";
import { resolveBindings, normalizeBindings } from "../lib/bindings";

function pair() {
  let d = createCharacter(defaultFoundation(), {
    ...normalizeCharacterInput(null),
    name: "Character One",
  });
  d = createCharacter(d, {
    ...normalizeCharacterInput(null),
    name: "Character Two",
  });
  return d;
}
test("single User, independent birthday/age, separate narrative fields and required name", () => {
  const base = defaultFoundation();
  const d = saveUser(base, {
    ...base.user,
    name: "User One",
    gender: "Free text",
    birthday: "2020-02-29",
    age: 42,
    timezone: "Pacific/Auckland",
    appearance: "Physical description",
    aboutMe: "Background",
  });
  assert.equal(d.user.age, 42);
  assert.equal(d.user.birthday, "2020-02-29");
  assert.equal(d.user.timezone, "Pacific/Auckland");
  assert.equal(d.user.appearance, "Physical description");
  assert.equal(d.user.aboutMe, "Background");
  assert.throws(() => saveUser(d, { ...d.user, name: " " }), /required/);
  assert.throws(
    () => saveUser(d, { ...d.user, birthday: "2025-02-29" }),
    /birthday/,
  );
  assert.throws(
    () => saveUser(d, { ...d.user, timezone: "Invalid/Zone" }),
    /timezone/,
  );
  const clean = normalizeFoundation({
    ...d,
    users: [d.user],
    userIdentityId: "discard",
    universes: [{ id: "other" }],
    universe: { ...d.universe, id: "other" },
    user: { ...d.user, userIdentityId: "discard" },
  });
  assert.equal(clean.universe.id, UNIVERSE_ID);
  assert(!JSON.stringify(clean).includes("discard"));
  assert(!("users" in clean));
  assert(!("universes" in clean));
});
test("stable Character IDs, directional Universe relationships and cascade deletion", () => {
  let d = pair();
  const [a, b] = d.characters;
  d = updateCharacter(d, a.characterId, {
    ...a,
    name: "Renamed",
    backstory: "Past",
    personality: "Disposition",
    speakingStyle: "Voice",
    appearance: "Physical",
  });
  assert.equal(d.characters[0].characterId, a.characterId);
  assert.equal(d.characters[0].backstory, "Past");
  d = saveUniverse(d, "Our Universe", "World setting");
  const relation = {
    characterAId: a.characterId,
    characterBId: b.characterId,
    label: "Colleagues",
    aToBContext: "A knows B",
    bToAContext: "B knows A",
    sharedHistory: "Shared past",
  };
  d = saveRelation(d, relation);
  const id = d.universe.relations[0].id;
  d = saveRelation(d, { ...relation, label: "Friends" }, id);
  assert.equal(d.universe.relations[0].id, id);
  assert.equal(d.universe.relations[0].aToBContext, "A knows B");
  assert.equal(d.universe.relations[0].bToAContext, "B knows A");
  assert.throws(
    () =>
      saveRelation(d, {
        ...relation,
        characterAId: b.characterId,
        characterBId: a.characterId,
      }),
    /already/,
  );
  assert.throws(
    () => saveRelation(d, { ...relation, characterBId: a.characterId }),
    /different/,
  );
  d = setNodePosition(d, a.characterId, { x: 360, y: 240 });

  assert.deepEqual(normalizeFoundation(JSON.parse(JSON.stringify(d))), d);
  d = deleteCharacter(d, a.characterId);
  assert.equal(d.universe.relations.length, 0);
  assert(!Object.hasOwn(d.universe.nodePositions, a.characterId));
  assert(!Object.hasOwn(d, "bindings"));
  assert(!Object.hasOwn(d, "selectedCharacterId"));
  assert.equal(d.universe.id, UNIVERSE_ID);
  assert.equal(d.universe.worldSetting, "World setting");
  d = deleteCharacter(d, b.characterId);
  assert(!Object.hasOwn(d, "selectedCharacterId"));
});
test("node coordinates and imported records are normalized without prototype keys", () => {
  let d = pair();
  d = setNodePosition(d, d.characters[0].characterId, { x: -20, y: 100000 });
  assert.deepEqual(d.universe.nodePositions[d.characters[0].characterId], {
    x: 0,
    y: 5000,
  });
  const clean = normalizeFoundation({
    ...d,
    characters: [
      ...d.characters,
      { ...d.characters[0], characterId: "__proto__" },
    ],
  });
  assert.equal(clean.characters.length, 2);
});
test("bindings resolve global → Character → Character×App with explicit clears and registry filtering", () => {
  const bindings = normalizeBindings(
    {
      global: {
        apiConfigId: "global",
        presetId: "global-preset",
        worldBookIds: ["a"],
        regexIds: ["global"],
      },
      characters: {
        char: {
          defaults: { apiConfigId: "character", worldBookIds: ["b", "b"] },
          apps: {
            messages: { apiConfigId: "app", regexIds: [] },
            appearance: { presetId: "appearance" },
            oldBusinessApp: { apiConfigId: "old" },
          },
        },
        deleted: { defaults: { apiConfigId: "orphan" } },
      },
    },
    ["char"],
  );
  assert.deepEqual(resolveBindings(bindings, "char", "messages"), {
    apiConfigId: "app",
    presetId: "global-preset",
    worldBookIds: ["b"],
    regexIds: [],
  });
  assert.equal(
    resolveBindings(bindings, "char", "appearance").apiConfigId,
    "character",
  );
  assert.equal(
    resolveBindings(bindings, null, "messages").apiConfigId,
    "global",
  );
  assert(!JSON.stringify(bindings).includes("oldBusinessApp"));
  assert(!Object.hasOwn(bindings.characters, "deleted"));
});
