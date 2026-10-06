import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCharacter, deleteCharacter } from "../lib/foundation";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";
import { migrateLegacyWidgetCharacters } from "../lib/legacy-widget-character";
import { normalizeDocument } from "../lib/theme-types";
import { browserThemeStorage } from "../lib/theme-storage";
import { resolveHereThereCharacter } from "../lib/here-there-binding";
import { exportBackup } from "../lib/backup/export";
import { createPresetDocument } from "../lib/preset";
import { defaultRegexGroup } from "../lib/regex-defaults";
import { emptyWorldBookDocument } from "../lib/worldbook";

function characters() {
  let foundation = createCharacter(defaultFoundation(), normalizeCharacterInput({ name: "A" }));
  foundation = createCharacter(foundation, normalizeCharacterInput({ name: "B" }));
  return foundation;
}

test("creating and deleting contacts never creates or maintains global active state", () => {
  const first = createCharacter(defaultFoundation(), normalizeCharacterInput({ name: "First" }));
  assert(!Object.hasOwn(first, "selectedCharacterId"));
  const document = characters();
  assert.equal(document.characters.length, 2);
  assert(!Object.hasOwn(document, "selectedCharacterId"));
  const normalized = normalizeFoundation({ ...document, selectedCharacterId: document.characters[0].characterId });
  assert.deepEqual(normalized, document);
  const removed = deleteCharacter(document, document.characters[0].characterId);
  assert(!Object.hasOwn(removed, "selectedCharacterId"));
  assert.equal(removed.characters[0].name, "B");
});

test("legacy widget migration uses valid old selection or a unique contact, never guesses among several", () => {
  const foundation = characters();
  const theme = normalizeDocument(null);
  assert.equal(migrateLegacyWidgetCharacters(theme, foundation), theme);
  assert.equal(migrateLegacyWidgetCharacters(theme, { ...foundation, selectedCharacterId: "deleted" }), theme);
  const legacy = { ...foundation, selectedCharacterId: foundation.characters[1].characterId };
  const migrated = migrateLegacyWidgetCharacters(theme, legacy);
  assert.equal(migrated.current.widgets[0].config.characterId, foundation.characters[1].characterId);
  assert.equal(migrateLegacyWidgetCharacters(migrated, { ...legacy,
    selectedCharacterId: foundation.characters[0].characterId }), migrated);
  const single = { ...foundation, characters: foundation.characters.slice(0, 1) };
  assert.equal(migrateLegacyWidgetCharacters(theme, single).current.widgets[0].config.characterId,
    single.characters[0].characterId);
  assert.equal(migrateLegacyWidgetCharacters(theme, { ...foundation, characters: [] }), theme);
  const invalid = normalizeDocument({ current: { ...theme.current,
    widgets: [{ ...theme.current.widgets[0], config: { characterId: "deleted" } }] } });
  assert.equal(migrateLegacyWidgetCharacters(invalid, single), invalid);
  assert.equal(resolveHereThereCharacter(invalid.current.widgets[0].config, single), undefined);
});

test("Theme loading persists legacy widget binding so later Foundation changes cannot switch it", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const foundation = characters();
  const firstId = foundation.characters[0].characterId;
  const saved = new Map<string, string>([
    ["veil.foundation.v1", JSON.stringify({ ...foundation, selectedCharacterId: firstId })],
    ["companion-phone.appearance.v1", JSON.stringify(normalizeDocument(null))],
  ]);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  } } });
  try {
    const migrated = await browserThemeStorage.load();
    assert.equal(migrated.current.widgets[0].config.characterId, firstId);
    assert.equal(JSON.parse(saved.get("companion-phone.appearance.v1")!).current.widgets[0].config.characterId, firstId);
    saved.set("veil.foundation.v1", JSON.stringify({ ...foundation,
      selectedCharacterId: foundation.characters[1].characterId }));
    const reloaded = await browserThemeStorage.load();
    assert.equal(resolveHereThereCharacter(reloaded.current.widgets[0].config, foundation)?.characterId, firstId);
    assert.equal(resolveHereThereCharacter(reloaded.current.widgets[0].config,
      deleteCharacter(foundation, firstId)), undefined);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("current backup exports no global active Character", async () => {
  const foundation = characters();
  const { backup } = await exportBackup({
    foundation: { load: async () => foundation }, theme: { load: async () => normalizeDocument(null) },
    bindings: { load: async () => ({ global: {}, characters: {} }) },
    preset: { load: async () => createPresetDocument() },
    regex: { load: async () => ({ version: 1, groups: [defaultRegexGroup()] }) },
    worldBooks: { load: async () => emptyWorldBookDocument() },
    chat: { exportBackup: async () => ({ version: 1, sessions: [], messages: [] }) },
  });
  assert(!Object.hasOwn(backup.foundation, "selectedCharacterId"));
});

test("Character UI and widget runtime contain no global active controls or implicit selection", () => {
  const profile = readFileSync("components/profile-pages.tsx", "utf8");
  const binding = readFileSync("lib/here-there-binding.ts", "utf8");
  const widget = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.doesNotMatch(profile, /selectCharacter|selectedCharacterId|active-badge|Set as Active/);
  assert.doesNotMatch(binding, /selectedCharacterId|characters\[0\]/);
  assert.doesNotMatch(widget, /migrationAttempt|selectedCharacterId/);
  assert.match(profile, /setEditing\(true\)/);
  assert.match(profile, /deleteCharacter\(d, characterId!/);
});
