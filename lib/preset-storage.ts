import type { BindingStorage } from "./binding-storage";
import {
  BUILTIN_PRESET_ID,
  createBuiltinPreset,
  createPresetDocument,
  validatePresetDocument,
  type PresetDocument,
} from "./preset";
import type { StringStorage } from "./storage-types";
import { assertPresetUpdate, deletePreset } from "./preset-library";
import { presetFingerprint } from "./preset";
import { withoutPresetBinding } from "./bindings";

export interface PresetStorage {
  load(): Promise<PresetDocument>;
  save(document: PresetDocument): Promise<void>;
  transact(update: (document: PresetDocument) => PresetDocument): Promise<PresetDocument>;
  readRaw(): Promise<string | null>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
}

const KEY = "veil.preset.v1";
function withCanonicalBuiltin(document: PresetDocument): PresetDocument {
  return validatePresetDocument({ ...document, presets: document.presets.map((preset) =>
    preset.id === BUILTIN_PRESET_ID ? createBuiltinPreset() : preset) });
}
export function createPresetStorage(getStorage: () => StringStorage): PresetStorage {
  // All cooperating tabs share one mutation boundary, including rollback.
  // Calls on this instance queue first; the browser lock is only for other tabs and clients, so
  // two reads in the same tab never see each other as "another tab".
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => T): Promise<T> => {
    const run = async (): Promise<T> => {
      if (typeof navigator !== "undefined" && navigator.locks)
        return await navigator.locks.request(KEY, { ifAvailable: true }, async (lock) => {
          if (!lock) throw new Error("Presets are busy in another tab. Try again.");
          return operation();
        });
      return operation();
    };
    const result = queue.then(run, run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const parse = (raw: string): PresetDocument => {
    try {
      const validated = validatePresetDocument(JSON.parse(raw));
      const builtin = validated.presets.find((preset) => preset.id === BUILTIN_PRESET_ID)!;
      return builtin.builtIn ? withCanonicalBuiltin(validated) : validated;
    } catch { throw new Error("Saved Preset data could not be read. Existing data was preserved; restore a valid Preset document before making changes."); }
  };
  const read = () => {
    const raw = getStorage().getItem(KEY);
    if (raw === null) return null;
    return parse(raw);
  };
  const write = (document: PresetDocument, previous: PresetDocument | null) => {
    const validated = validatePresetDocument(document);
    const builtin = validated.presets.find((preset) => preset.id === BUILTIN_PRESET_ID)!;
    if (!builtin.builtIn || presetFingerprint(builtin) !== presetFingerprint(createBuiltinPreset()))
      throw new Error("VEIL Default is read-only. Copy it to make changes.");
    const next = validated;
    for (const preset of previous?.presets ?? []) {
      const updated = next.presets.find((item) => item.id === preset.id);
      if (updated && presetFingerprint(preset) !== presetFingerprint(updated)) assertPresetUpdate(preset, updated);
    }
    getStorage().setItem(KEY, JSON.stringify(next));
    return next;
  };
  return {
    load() { return exclusive(() => {
      const storage = getStorage();
      const raw = storage.getItem(KEY);
      if (raw === null) {
        const document = createPresetDocument();
        storage.setItem(KEY, JSON.stringify(document));
        return document;
      }
      // Unreadable data remains the authority. Do not replace an entire user
      // library with defaults, including when only one entry is malformed.
      const document = parse(raw);
      const canonical = JSON.stringify(document);
      if (canonical !== raw) storage.setItem(KEY, canonical);
      return document;
    }); },
    save(document) { return exclusive(() => {
      write(document, read());
    }); },
    transact(update) { return exclusive(() => {
      const expected = getStorage().getItem(KEY);
      const previous = read() ?? createPresetDocument();
      const next = update(structuredClone(previous));
      if (getStorage().getItem(KEY) !== expected)
        throw new Error("Preset changed elsewhere. Reload it before saving.");
      return write(next, previous);
    }); },
    async readRaw() { return getStorage().getItem(KEY); },
    rollbackIfCurrent(expected, previous) { return exclusive(() => {
      // Without an origin-wide lock a browser cannot atomically compare and
      // replace localStorage across tabs. Keep the deletion instead of risking
      // somebody else's update; the caller reports the cleanup conflict.
      if (typeof window !== "undefined" && !window.navigator.locks) return false;
      if (getStorage().getItem(KEY) !== expected) return false;
      if (previous === null) getStorage().removeItem?.(KEY);
      else getStorage().setItem(KEY, previous);
      return true;
    }); },
  };
}

export const browserPresetStorage = createPresetStorage(() => window.localStorage);

export async function deletePresetAndBindings(
  id: string, presets: PresetStorage, bindings: Pick<BindingStorage, "transact">,
): Promise<PresetDocument> {
  await presets.load();
  // Capture both sides of this mutation inside the transaction. A later read
  // may already contain somebody else's completed update and is not our token.
  let before = "";
  const next = await presets.transact((current) => {
    before = JSON.stringify(current);
    return deletePreset(current, id);
  });
  const after = JSON.stringify(next);
  try {
    await bindings.transact((current) => withoutPresetBinding(current, id));
  } catch (reason) {
    if (!await presets.rollbackIfCurrent(after, before))
      throw new Error("Preset changed while Binding cleanup failed. Review the Preset and Bindings.");
    throw reason;
  }
  return next;
}
