import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import { buildDisplayedPrompts, importPreset, promptEnabled } from "../lib/preset-library";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createPresetStorage } from "../lib/preset-storage";
import { movePrompt, setPromptEnabled, updatePreset } from "../lib/preset-library";

function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

test("an imported enabled Prompt omitted from promptOrder is displayed as disabled and excluded from generation", () => {
  const imported = { ...createBuiltinPreset(), id: "d7-orphan", name: "D7", builtIn: false };
  imported.prompts = [...imported.prompts, { identifier: "orphan", name: "Orphan", role: "system" as const,
    enabled: true, source: "prompt" as const, content: "D7_ORPHAN_SENTINEL" }];
  const source = JSON.stringify(imported);
  const preset = importPreset(createPresetDocument(), source).presets.at(-1)!;
  assert.equal(preset.promptOrder.some((entry) => entry.identifier === "orphan"), false);
  assert.equal(buildDisplayedPrompts(preset).some((entry) => entry.identifier === "orphan"), true);
  assert.equal(promptEnabled(preset, "orphan"), false);
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  const character = { characterId: "d7", ...normalizeCharacterInput({ name: "D7" }) };
  const output = assembleChatPrompt(foundation, character, [], [], undefined, preset);
  assert.doesNotMatch(JSON.stringify(output.messages), /D7_ORPHAN_SENTINEL/);
});

test("enabling an orphan adds it to order; disable, sorting, save/reload and runtime stay consistent", async () => {
  const imported = { ...createBuiltinPreset(), id: "d7-roundtrip", name: "D7", builtIn: false };
  imported.prompts = [...imported.prompts, { identifier: "orphan", name: "Orphan", role: "system" as const,
    enabled: true, source: "prompt" as const, content: "D7_ORPHAN_ROUNDTRIP" }];
  const library = importPreset(createPresetDocument(), JSON.stringify(imported));
  const source = library.presets.at(-1)!;
  const originalOrder = structuredClone(source.promptOrder);
  let edited = setPromptEnabled(source, "orphan", true);
  assert.equal(promptEnabled(edited, "orphan"), true);
  assert.equal(edited.promptOrder.at(-1)?.identifier, "orphan");
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  const character = { characterId: "d7", ...normalizeCharacterInput({ name: "D7" }) };
  assert.match(JSON.stringify(assembleChatPrompt(foundation, character, [], [], undefined, edited).messages),
    /D7_ORPHAN_ROUNDTRIP/);
  edited = movePrompt(edited, "orphan", -1);
  assert.equal(edited.promptOrder.at(-2)?.identifier, "orphan");
  assert.deepEqual(edited.promptOrder.filter((entry) => entry.identifier !== "orphan"), originalOrder);
  edited = setPromptEnabled(edited, "orphan", false);
  assert.equal(promptEnabled(edited, "orphan"), false);
  assert.equal(edited.promptOrder.find((entry) => entry.identifier === "orphan")?.enabled, false);
  assert.doesNotMatch(JSON.stringify(assembleChatPrompt(foundation, character, [], [], undefined, edited).messages),
    /D7_ORPHAN_ROUNDTRIP/);

  const raw = memory(), storage = createPresetStorage(() => raw);
  await storage.save(library);
  await storage.transact((current) => updatePreset(current, edited, source));
  const reloaded = (await storage.load()).presets.find((preset) => preset.id === source.id)!;
  assert.deepEqual(buildDisplayedPrompts(reloaded).map((prompt) => prompt.identifier),
    reloaded.promptOrder.map((entry) => entry.identifier));
  assert.deepEqual(reloaded.promptOrder.filter((entry) => entry.identifier !== "orphan"), originalOrder);
  assert.equal(promptEnabled(reloaded, "orphan"), false);
  assert.doesNotMatch(JSON.stringify(assembleChatPrompt(foundation, character, [], [], undefined, reloaded).messages),
    /D7_ORPHAN_ROUNDTRIP/);
  const reenabled = setPromptEnabled(reloaded, "orphan", true);
  await storage.transact((current) => updatePreset(current, reenabled, reloaded));
  const final = (await storage.load()).presets.find((preset) => preset.id === source.id)!;
  assert.match(JSON.stringify(assembleChatPrompt(foundation, character, [], [], undefined, final).messages),
    /D7_ORPHAN_ROUNDTRIP/);
});
