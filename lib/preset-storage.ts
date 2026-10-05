import type { BindingStorage } from "./binding-storage";
import {
  createPresetDocument,
  validatePresetDocument,
  type PresetDocument,
} from "./preset";
import type { StringStorage } from "./foundation-storage";
import { assertPresetUpdate, deletePreset } from "./preset-library";
import { presetFingerprint } from "./preset";
import { withoutPresetBinding } from "./bindings";

export interface PresetStorage {
  load(): Promise<PresetDocument>;
  save(document: PresetDocument): Promise<void>;
  transact(update: (document: PresetDocument) => PresetDocument): Promise<PresetDocument>;
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: PresetDocument): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
}

const KEY = "veil.preset.v1";
export function createPresetStorage(getStorage: () => StringStorage): PresetStorage {
  const read = () => {
    const raw = getStorage().getItem(KEY);
    if (raw === null) return null;
    try {
      const document = validatePresetDocument(JSON.parse(raw));
      const migrated = JSON.stringify(document);
      if (migrated !== raw) getStorage().setItem(KEY, migrated);
      return document;
    }
    catch { throw new Error("Saved Preset data could not be read. Restore a valid backup to repair it."); }
  };
  const write = (document: PresetDocument, previous: PresetDocument | null) => {
    const next = validatePresetDocument(document);
    for (const preset of previous?.presets ?? []) {
      const updated = next.presets.find((item) => item.id === preset.id);
      if (updated && presetFingerprint(preset) !== presetFingerprint(updated)) assertPresetUpdate(preset, updated);
    }
    getStorage().setItem(KEY, JSON.stringify(next));
    return next;
  };
  return {
    async load() {
      const saved = read();
      if (saved) return saved;
      const document = createPresetDocument();
      getStorage().setItem(KEY, JSON.stringify(document));
      return document;
    },
    async save(document) {
      write(document, read());
    },
    async transact(update) {
      const previous = read() ?? createPresetDocument();
      return write(update(structuredClone(previous)), previous);
    },
    async readRaw() { return getStorage().getItem(KEY); },
    async replaceIfCurrent(expected, document) {
      if (getStorage().getItem(KEY) !== expected)
        throw new Error("Preset data changed while restore was being prepared.");
      const raw = JSON.stringify(validatePresetDocument(document));
      getStorage().setItem(KEY, raw);
      return raw;
    },
    async rollbackIfCurrent(expected, previous) {
      if (getStorage().getItem(KEY) !== expected) return false;
      if (previous === null) getStorage().removeItem?.(KEY);
      else getStorage().setItem(KEY, previous);
      return true;
    },
  };
}

export const browserPresetStorage = createPresetStorage(() => window.localStorage);

export async function deletePresetAndBindings(
  id: string, presets: PresetStorage, bindings: Pick<BindingStorage, "transact">,
): Promise<PresetDocument> {
  await presets.load();
  const before = await presets.readRaw();
  const next = await presets.transact((current) => deletePreset(current, id));
  const after = await presets.readRaw();
  try {
    await bindings.transact((current) => withoutPresetBinding(current, id));
  } catch (reason) {
    if (after === null || !await presets.rollbackIfCurrent(after, before))
      throw new Error("Preset changed while Binding cleanup failed. Review the Preset and Bindings.");
    throw reason;
  }
  return next;
}
