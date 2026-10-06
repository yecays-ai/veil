import { browserBindingStorage } from "./binding-storage";
import { BUILTIN_PRESET_ID } from "./preset";
import { browserPresetStorage } from "./preset-storage";
import type { BindingStorage } from "./binding-storage";
import type { PresetStorage } from "./preset-storage";
import { browserRegexStorage, ensureDefaultRegexGroup } from "./regex-storage";
import type { RegexStorage } from "./regex-storage";

export async function bootstrapCurrentProduct(
  presets: Pick<PresetStorage, "load"> = browserPresetStorage,
  bindings: Pick<BindingStorage, "transact"> = browserBindingStorage,
  regex: RegexStorage = browserRegexStorage,
): Promise<void> {
  const document = await presets.load();
  const builtin = document.presets.find((preset) => preset.id === BUILTIN_PRESET_ID && preset.builtIn);
  if (!builtin)
    throw new Error("VEIL Default Preset is unavailable.");
  await ensureDefaultRegexGroup(regex);
  const validPresetIds = new Set(document.presets.map((preset) => preset.id));
  await bindings.transact((current) => current.global.presetId === null ||
      (current.global.presetId !== undefined && validPresetIds.has(current.global.presetId))
    ? current
    : { ...current, global: { ...current.global, presetId: BUILTIN_PRESET_ID } });
}
