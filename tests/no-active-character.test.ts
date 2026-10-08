import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCharacter, deleteCharacter } from "../lib/foundation";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";

function characters() {
  let foundation = createCharacter(defaultFoundation(), normalizeCharacterInput({ name: "A" }));
  foundation = createCharacter(foundation, normalizeCharacterInput({ name: "B" }));
  return foundation;
}

test("creating and deleting contacts never creates or maintains global active state", () => {
  createCharacter(defaultFoundation(), normalizeCharacterInput({ name: "First" }));
  const document = characters();
  assert.equal(document.characters.length, 2);
  assert.deepEqual(normalizeFoundation(document), document);
  const removed = deleteCharacter(document, document.characters[0].characterId);
  assert.equal(removed.characters[0].name, "B");
});

test("Character UI and widget runtime contain no global active controls or implicit selection", () => {
  const profile = readFileSync("components/profile-pages.tsx", "utf8");
  const binding = readFileSync("lib/here-there-binding.ts", "utf8");
  const widget = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.doesNotMatch(profile, /selectCharacter|selectedCharacterId|active-badge|Set as Active/);
  assert.doesNotMatch(binding, /selectedCharacterId|characters\[0\]/);
  assert.doesNotMatch(widget, /migrationAttempt|selectedCharacterId/);
  assert.match(profile, /setEditing\(true\)/);
  assert.match(profile, /deleteCharacterWithData\(\{\s*characterId: characterId!/);
});
