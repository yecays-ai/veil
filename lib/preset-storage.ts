import {
  createPresetDocument,
  validatePresetDocument,
  type PresetDocument,
} from "./preset";
import type { StringStorage } from "./foundation-storage";

export interface PresetStorage {
  load(): Promise<PresetDocument>;
  save(document: PresetDocument): Promise<void>;
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
  return {
    async load() {
      const saved = read();
      if (saved) return saved;
      const document = createPresetDocument();
      getStorage().setItem(KEY, JSON.stringify(document));
      return document;
    },
    async save(document) {
      getStorage().setItem(KEY, JSON.stringify(validatePresetDocument(document)));
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
