import {
  BUILTIN_PRESET_ID, createBuiltinPreset, presetFingerprint, validatePreset, validatePresetDocument,
  type FeaturePrompt, type Preset, type PresetDocument, type PresetPrompt,
} from "./preset";
import { ALWAYS_ON_FEATURES, PRESET_FEATURES, type PresetFeature } from "./chat/feature-prompts";

function custom(document: PresetDocument, id: string) {
  const preset = document.presets.find((item) => item.id === id);
  if (!preset) throw new Error("This Preset no longer exists.");
  if (preset.builtIn) throw new Error("VEIL Default is read-only. Copy it to make changes.");
  return preset;
}

export function assertPresetUpdate(previous: Preset, next: Preset) {
  if (previous.builtIn || next.id !== previous.id || next.builtIn)
    throw new Error("Preset identity and built-in status cannot be changed.");
  for (const marker of previous.prompts.filter((entry) => entry.source === "marker")) {
    const updated = next.prompts.find((entry) => entry.identifier === marker.identifier);
    if (!updated || updated.source !== "marker" || updated.marker !== marker.marker)
      throw new Error("Existing marker identities must remain in the pipeline.");
  }
  for (const feature of previous.prompts.filter((entry) => entry.source === "feature")) {
    const updated = next.prompts.find((entry) => entry.identifier === feature.identifier);
    if (!updated || updated.source !== "feature" || updated.feature !== feature.feature ||
        (!updated.enabled && ALWAYS_ON_FEATURES.has(updated.feature)))
      throw new Error("Feature prompts keep their identity; only their wording and on/off state change.");
  }
}

export function updatePreset(document: PresetDocument, next: Preset, expected?: Preset): PresetDocument {
  const previous = custom(document, next.id);
  if (expected && presetFingerprint(previous) !== presetFingerprint(expected))
    throw new Error("This Preset changed elsewhere. Reload it before saving.");
  assertPresetUpdate(previous, next);
  return validatePresetDocument({ ...document, presets: document.presets.map((item) => item.id === next.id ? next : item) });
}

export function copyPreset(document: PresetDocument, sourceId = BUILTIN_PRESET_ID, name?: string, id: string = crypto.randomUUID()): PresetDocument {
  const source = document.presets.find((item) => item.id === sourceId);
  if (!source) throw new Error("This Preset no longer exists.");
  const copy = { ...structuredClone(source), id, builtIn: false, name: name ?? `${source.name} Copy` };
  return validatePresetDocument({ ...document, presets: [...document.presets, copy] });
}

export function deletePreset(document: PresetDocument, id: string): PresetDocument {
  custom(document, id);
  return validatePresetDocument({ ...document, presets: document.presets.filter((item) => item.id !== id),
    activePresetId: document.activePresetId === id ? BUILTIN_PRESET_ID : document.activePresetId });
}

export function setActivePreset(document: PresetDocument, id: string): PresetDocument {
  return validatePresetDocument({ ...document, activePresetId: id });
}

export function savePrompt(preset: Preset, previousIdentifier: string | undefined, next: PresetPrompt): Preset {
  if (preset.builtIn) throw new Error("VEIL Default is read-only.");
  const previous = preset.prompts.find((entry) => entry.identifier === previousIdentifier);
  if (previousIdentifier && !previous) throw new Error("This Prompt no longer exists.");
  if (preset.prompts.some((entry) => entry.identifier === next.identifier && entry !== previous))
    throw new Error("Prompt Identifier must be unique.");
  if (!previous && (next.source !== "prompt" || !next.content.trim()))
    throw new Error("Enter content for the new Prompt.");
  const updated = validatePreset({ ...preset,
    prompts: previous ? preset.prompts.map((entry) => entry === previous ? next : entry) : [...preset.prompts, next],
    promptOrder: previous ? preset.promptOrder.map((entry) => entry.identifier === previousIdentifier
      ? { ...entry, identifier: next.identifier } : entry) : [...preset.promptOrder, { identifier: next.identifier, enabled: true }],
  });
  assertPresetUpdate(preset, updated);
  return updated;
}

export function deletePrompt(preset: Preset, identifier: string): Preset {
  if (preset.builtIn) throw new Error("VEIL Default is read-only.");
  const entry = preset.prompts.find((item) => item.identifier === identifier);
  if (!entry || entry.source !== "prompt") throw new Error("Only ordinary Prompts can be deleted.");
  return validatePreset({ ...preset, prompts: preset.prompts.filter((item) => item.identifier !== identifier),
    promptOrder: preset.promptOrder.filter((item) => item.identifier !== identifier) });
}

export function buildDisplayedPrompts(preset: Preset): PresetPrompt[] {
  // Feature wording is not part of the ordered pipeline; it has its own list.
  const prompts = new Map(preset.prompts.filter((prompt) => prompt.source !== "feature").map((prompt) => [prompt.identifier, prompt]));
  const seen = new Set<string>();
  const displayed: PresetPrompt[] = [];
  const append = (prompt?: PresetPrompt) => {
    if (prompt && !seen.has(prompt.identifier)) {
      seen.add(prompt.identifier);
      displayed.push(prompt);
    }
  };
  for (const entry of preset.promptOrder) append(prompts.get(entry.identifier));
  for (const prompt of prompts.values()) append(prompt);
  return displayed;
}

/** Feature entries in their fixed order, as the Character's own chat features are listed. */
export function featurePrompts(preset: Preset): FeaturePrompt[] {
  return PRESET_FEATURES.flatMap((feature) => preset.prompts.filter((entry): entry is FeaturePrompt =>
    entry.source === "feature" && entry.feature === feature));
}

/** Only the wording and on/off state of a feature entry change; its identity is fixed. */
export function updateFeaturePrompt(preset: Preset, feature: PresetFeature, patch: { content?: string; enabled?: boolean }): Preset {
  if (preset.builtIn) throw new Error("VEIL Default is read-only.");
  if (patch.enabled === false && ALWAYS_ON_FEATURES.has(feature)) throw new Error("This feature prompt cannot be turned off.");
  return validatePreset({ ...preset, prompts: preset.prompts.map((entry) => entry.source === "feature" && entry.feature === feature
    ? { ...entry, ...(patch.content !== undefined ? { content: patch.content } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}) }
    : entry) });
}

export function promptEnabled(preset: Preset, identifier: string) {
  const prompt = preset.prompts.find((item) => item.identifier === identifier);
  if (!prompt) return false;
  if (prompt.source === "feature") return prompt.enabled;
  const order = preset.promptOrder.find((item) => item.identifier === identifier);
  return prompt.enabled && (order?.enabled ?? false);
}

export function setPromptEnabled(preset: Preset, identifier: string, enabled: boolean): Preset {
  if (preset.builtIn) throw new Error("VEIL Default is read-only.");
  const entry = preset.prompts.find((item) => item.identifier === identifier);
  if (!entry) throw new Error("This Prompt no longer exists.");
  if (entry.source === "feature") return updateFeaturePrompt(preset, entry.feature, { enabled });
  return validatePreset({ ...preset,
    prompts: preset.prompts.map((item) => item.identifier === identifier ? { ...item, enabled } : item),
    promptOrder: preset.promptOrder.some((item) => item.identifier === identifier)
      ? preset.promptOrder.map((item) => item.identifier === identifier ? { ...item, enabled } : item)
      : enabled ? [...preset.promptOrder, { identifier, enabled: true }] : preset.promptOrder,
  });
}

export function movePrompt(preset: Preset, identifier: string, direction: -1 | 1): Preset {
  if (preset.builtIn) throw new Error("VEIL Default is read-only.");
  const displayed = buildDisplayedPrompts(preset);
  const index = displayed.findIndex((entry) => entry.identifier === identifier), target = index + direction;
  if (index < 0 || target < 0 || target >= displayed.length) return structuredClone(preset);
  [displayed[index], displayed[target]] = [displayed[target], displayed[index]];
  const enabled = new Map(preset.promptOrder.map((entry) => [entry.identifier, entry.enabled]));
  const promptOrder = displayed.map((entry) => ({
    identifier: entry.identifier,
    enabled: enabled.get(entry.identifier) ?? false,
  }));
  return validatePreset({ ...preset, promptOrder });
}

export function importPreset(document: PresetDocument, json: string, id: string = crypto.randomUUID()): PresetDocument {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("This file is not valid Preset JSON."); }
  const imported = validatePreset(value);
  // Validate only new import identities; existing libraries remain untouched.
  const assertBindableId = (value: string) => {
    if (!value || value.length > 200 || value !== value.trim())
      throw new Error("Preset ID must be 1–200 characters with no leading or trailing whitespace. Nothing was imported.");
  };
  assertBindableId(imported.id);
  // Imports always create a custom copy, including exports of the official default.
  imported.builtIn = false;
  if (imported.id === BUILTIN_PRESET_ID || document.presets.some((item) => item.id === imported.id)) imported.id = id;
  assertBindableId(imported.id);
  if (document.presets.some((item) => item.id === imported.id))
    throw new Error("The new Preset ID already exists. Nothing was imported.");
  return validatePresetDocument({ ...document, presets: [...document.presets, imported] });
}

export function exportPreset(preset: Preset): string {
  return JSON.stringify(validatePreset(preset), null, 2);
}

export function newPreset(document: PresetDocument): PresetDocument {
  return copyPreset(document, createBuiltinPreset().id, "New Preset");
}

