import {
  normalizeSnapshot,
  type ThemeDocument,
  type ThemeSnapshot,
} from "./theme-types";

export function savePreset(
  document: ThemeDocument,
  name: string,
  snapshot: ThemeSnapshot,
): ThemeDocument {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("Enter a preset name.");
  if (document.presets.length >= 10)
    throw new Error("You can save up to 10 presets. Delete one first.");
  return {
    ...document,
    presets: [
      ...document.presets,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        snapshot: normalizeSnapshot(snapshot),
      },
    ],
  };
}

export function applyPreset(
  document: ThemeDocument,
  id: string,
): ThemeDocument {
  const preset = document.presets.find((item) => item.id === id);
  if (!preset) throw new Error("Preset not found.");
  return { ...document, current: normalizeSnapshot(preset.snapshot) };
}

export function deletePreset(
  document: ThemeDocument,
  id: string,
): ThemeDocument {
  return {
    ...document,
    presets: document.presets.filter((item) => item.id !== id),
  };
}
