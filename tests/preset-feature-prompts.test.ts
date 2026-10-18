import assert from "node:assert/strict";
import test from "node:test";
import { createBuiltinPreset, createPresetDocument, presetFeatureTexts, validatePreset, validatePresetDocument, type Preset } from "../lib/preset";
import { buildDisplayedPrompts, copyPreset, featurePrompts, importPreset, setPromptEnabled, updateFeaturePrompt, updatePreset } from "../lib/preset-library";
import { FEATURE_DEFAULTS, PRESET_FEATURES, featureIdentifier, type FeaturePromptTexts } from "../lib/chat/feature-prompts";
import { selfStateContent, withFeaturePrompts, withoutDisabledActions, type SelfState } from "../lib/chat/self-context";
import { proactiveInstruction, PROACTIVE_INSTRUCTION, SILENCE_TAG } from "../lib/chat/proactive";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

const custom = () => {
  const document = copyPreset(createPresetDocument(), undefined, "Mine", "mine");
  return { document, preset: document.presets[1] };
};
/** A Preset as it was saved before feature entries existed. */
const legacy = (): Preset => {
  const preset = createBuiltinPreset();
  return { ...preset, id: "old", builtIn: false, prompts: preset.prompts.filter((entry) => entry.source !== "feature") };
};
const offeredAll: SelfState = { remark: null, remarkChange: null, status: null, situation: null, signature: null, userNote: null,
  canChange: { situation: true, signature: true, note: true }, canReact: true, canTransfer: true, canGift: true, canKeepsake: true,
  canVoice: true, canImage: true, stickers: [{ code: "S01", packId: "p", stickerId: "s", label: "Cats｜wave" }],
  recallCandidates: [{ id: "message-0001", content: "oops" }] };

test("VEIL Default lists every feature with its default wording, outside the ordered pipeline", () => {
  const preset = createBuiltinPreset();
  assert.deepEqual(featurePrompts(preset).map((entry) => entry.feature), [...PRESET_FEATURES]);
  for (const entry of featurePrompts(preset)) assert.equal(entry.content, FEATURE_DEFAULTS[entry.feature]);
  assert.equal(preset.promptOrder.some((entry) => entry.identifier.startsWith("feature-")), false);
  assert.equal(buildDisplayedPrompts(preset).some((entry) => entry.source === "feature"), false);
  assert.deepEqual(presetFeatureTexts(preset), FEATURE_DEFAULTS);
});

test("a Preset saved before feature entries gets each one with its default wording, on reading and on import", () => {
  const filled = validatePreset(legacy());
  assert.deepEqual(featurePrompts(filled).map((entry) => [entry.feature, entry.enabled, entry.content]),
    PRESET_FEATURES.map((feature) => [feature, true, FEATURE_DEFAULTS[feature]]));
  const document = validatePresetDocument({ ...createPresetDocument(), presets: [createBuiltinPreset(), legacy()] });
  assert.equal(featurePrompts(document.presets[1]).length, PRESET_FEATURES.length);
  const imported = importPreset(createPresetDocument(), JSON.stringify(legacy()), "imported");
  assert.equal(featurePrompts(imported.presets.at(-1)!).length, PRESET_FEATURES.length);
  // Ordinary entries and their order are untouched.
  assert.deepEqual(filled.promptOrder, legacy().promptOrder);
});

test("an ordinary prompt that already uses a feature's identifier keeps it, and the feature takes another", () => {
  const old = legacy();
  old.prompts.push({ identifier: "feature-voice", name: "My voice notes", role: "system", enabled: true, source: "prompt", content: "Mine" });
  old.promptOrder.push({ identifier: "feature-voice", enabled: true });
  const preset = validatePresetDocument({ ...createPresetDocument(), presets: [createBuiltinPreset(), old] }).presets[1];
  assert.equal(preset.prompts.find((entry) => entry.identifier === "feature-voice")?.source, "prompt");
  assert.equal(preset.promptOrder.at(-1)?.identifier, "feature-voice");
  const voice = featurePrompts(preset).find((entry) => entry.feature === "voice")!;
  assert.equal(voice.identifier, "feature-voice-2");
  assert.equal(validatePreset(preset).prompts.length, preset.prompts.length);
});

test("feature entries change only in wording and on/off state, and never join the pipeline", () => {
  const { document, preset } = custom();
  const edited = updateFeaturePrompt(updateFeaturePrompt(preset, "sticker", { content: "Send stickers often." }), "transfer", { enabled: false });
  const saved = updatePreset(document, edited).presets[1];
  assert.equal(featurePrompts(saved).find((entry) => entry.feature === "sticker")?.content, "Send stickers often.");
  assert.equal(presetFeatureTexts(saved).sticker, "Send stickers often.");
  assert.equal("transfer" in presetFeatureTexts(saved), false);
  assert.equal(setPromptEnabled(saved, featureIdentifier("transfer"), true).promptOrder.length, saved.promptOrder.length);
  assert.throws(() => updateFeaturePrompt(preset, "proactive", { enabled: false }), /cannot be turned off/);
  assert.throws(() => updateFeaturePrompt(createBuiltinPreset(), "sticker", { content: "x" }), /read-only/);
  assert.throws(() => validatePreset({ ...preset, promptOrder: [...preset.promptOrder, { identifier: "feature-voice", enabled: true }] }), /prompt order/);
  assert.throws(() => validatePreset({ ...preset, prompts: [...preset.prompts, { ...featurePrompts(preset)[0] }] }), /duplicate|feature/);
  // Other Presets keep their own wording.
  assert.equal(presetFeatureTexts(createBuiltinPreset()).sticker, FEATURE_DEFAULTS.sticker);
});

test("the Character reads the Preset's wording, and the protocol and lists VEIL needs stay around it", () => {
  const defaults = selfStateContent(withFeaturePrompts(offeredAll, FEATURE_DEFAULTS))!;
  assert.equal(defaults, selfStateContent(offeredAll));
  assert.ok(defaults.includes(`${FEATURE_DEFAULTS.sticker} Each entry is pack name｜sticker name`));
  assert.match(defaults, /You may change your own signature, note on the user and situation\.\nChange them only when/);
  const text = selfStateContent(withFeaturePrompts(offeredAll, { ...FEATURE_DEFAULTS, sticker: "Stickers are how you talk.\nUse one in most replies." }))!;
  assert.match(text, /Stickers are how you talk\.\nUse one in most replies\. Each entry is pack name｜sticker name/);
  assert.match(text, /S01 = Cats｜wave/);
  assert.match(text, /"sticker": exactly one code/);
  // Emptied wording keeps the feature itself.
  assert.match(selfStateContent(withFeaturePrompts(offeredAll, { ...FEATURE_DEFAULTS, voice: "" }))!, /"voice": exactly what you say aloud/);
});

test("a feature turned off is neither offered nor applied", () => {
  const texts: FeaturePromptTexts = { ...FEATURE_DEFAULTS };
  delete texts.sticker; delete texts.transfer; delete texts.self;
  const state = withFeaturePrompts(offeredAll, texts);
  assert.equal(state.stickers, undefined);
  assert.equal(state.canTransfer, undefined);
  assert.equal(state.canChange, null);
  const text = selfStateContent(state)!;
  assert.doesNotMatch(text, /"sticker"|"transfer"|"signature"|S01|You may change your own/);
  assert.match(text, /"gift"/);
  assert.deepEqual(withoutDisabledActions({ sticker: "S01", transfer: { amount: 1, note: "" }, signature: "x", gift: { icon: "🎁", content: "hi" } }, texts),
    { gift: { icon: "🎁", content: "hi" } });
  assert.equal(withoutDisabledActions({ sticker: "S01" }, texts), null);
});

test("proactive wording is editable while the way to decline stays", () => {
  assert.equal(PROACTIVE_INSTRUCTION, proactiveInstruction(FEATURE_DEFAULTS.proactive));
  assert.ok(PROACTIVE_INSTRUCTION.includes(SILENCE_TAG));
  assert.equal(proactiveInstruction("Write to them whenever you miss them."),
    `Write to them whenever you miss them. If you would not, reply with exactly ${SILENCE_TAG} and nothing else.`);
  assert.ok(proactiveInstruction("").includes(SILENCE_TAG));
});

test("feature entries are not sent as Preset sections", () => {
  const character = { characterId: "a", ...normalizeCharacterInput({ name: "A" }) };
  const prompt = assembleChatPrompt(defaultFoundation(), character, [], [], undefined, createBuiltinPreset(), new Date("2026-10-18T00:00:00Z"));
  assert.equal(prompt.sections.some((section) => section.identifier.startsWith("feature-")), false);
  assert.equal(prompt.messages.some((message) => message.content.includes(FEATURE_DEFAULTS.gift)), false);
});
