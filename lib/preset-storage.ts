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
import { browserPersistenceWriteGate, runPersistenceWrite, withPersistenceWriteScope,
  type PersistenceWriteGate, type PersistenceWriteScope } from "./backup/persistence-write-gate";

export interface PresetStorage {
  load(scope?: PersistenceWriteScope): Promise<PresetDocument>;
  save(document: PresetDocument): Promise<void>;
  transact(update: (document: PresetDocument) => PresetDocument, scope?: PersistenceWriteScope): Promise<PresetDocument>;
  readRaw(): Promise<string | null>;
  /**
   * Restores `previous` only while storage still equals `expected`. Resolves false when the stored
   * document is a different (newer) one. Rejects when rollback cannot run at all: another tab holds
   * the lock, the browser has no Web Locks, or storage fails.
   */
  rollbackIfCurrent(expected: string, previous: string | null, scope?: PersistenceWriteScope): Promise<boolean>;
}

const KEY = "veil.preset.v1";
function withCanonicalBuiltin(document: PresetDocument): PresetDocument {
  return validatePresetDocument({ ...document, presets: document.presets.map((preset) =>
    preset.id === BUILTIN_PRESET_ID ? createBuiltinPreset() : preset) });
}
export function createPresetStorage(getStorage: () => StringStorage,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate): PresetStorage {
  // All cooperating tabs share one mutation boundary, including rollback.
  // Acquire the backup lease before joining this instance's queue, then take the domain lock, so
  // a scoped owner never waits for an unscoped call blocked behind a queued snapshot.
  // The domain lock is only for other tabs and clients, so
  // two reads in the same tab never see each other as "another tab".
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(operation: () => T, scope?: PersistenceWriteScope): Promise<T> =>
    runPersistenceWrite(writeGate, async () => {
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
    }, scope);
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
    load(scope) { return exclusive(() => {
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
    }, scope); },
    save(document) { return exclusive(() => {
      write(document, read());
    }); },
    transact(update, scope) { return exclusive(() => {
      const expected = getStorage().getItem(KEY);
      const previous = read() ?? createPresetDocument();
      const next = update(structuredClone(previous));
      if (getStorage().getItem(KEY) !== expected)
        throw new Error("Preset changed elsewhere. Reload it before saving.");
      return write(next, previous);
    }, scope); },
    async readRaw() { return getStorage().getItem(KEY); },
    rollbackIfCurrent(expected, previous, scope) { return exclusive(() => {
      // Without an origin-wide lock a browser cannot atomically compare and
      // replace localStorage across tabs. Keep the deletion instead of risking
      // somebody else's update; the caller reports that rollback was unavailable.
      if (typeof window !== "undefined" && !window.navigator.locks)
        throw new Error("Safe Preset rollback requires browser Web Locks.");
      if (getStorage().getItem(KEY) !== expected) return false;
      if (previous === null) getStorage().removeItem?.(KEY);
      else getStorage().setItem(KEY, previous);
      return true;
    }, scope); },
  };
}

export const browserPresetStorage = createPresetStorage(() => window.localStorage);

// Deleting is idempotent: if the Preset is already gone, only the Binding cleanup runs. That is the
// retry path after a failed cleanup whose rollback could not run, and it never rewrites other data.
export async function deletePresetAndBindings(
  id: string, presets: PresetStorage, bindings: Pick<BindingStorage, "transact">,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate,
): Promise<PresetDocument> {
  return withPersistenceWriteScope(writeGate, (scope) => deletePresetWithScope(id, presets, bindings, scope));
}

async function deletePresetWithScope(id: string, presets: PresetStorage,
  bindings: Pick<BindingStorage, "transact">, scope: PersistenceWriteScope): Promise<PresetDocument> {
  await presets.load(scope);
  // Capture both sides of this mutation inside the transaction. A later read
  // may already contain somebody else's completed update and is not our token.
  let before = "";
  let deleted = false;
  const next = await presets.transact((current) => {
    before = JSON.stringify(current);
    if (!current.presets.some((preset) => preset.id === id)) return current;
    deleted = true;
    return deletePreset(current, id);
  }, scope);
  const after = JSON.stringify(next);
  try {
    await bindings.transact((current) => withoutPresetBinding(current, id), scope);
  } catch (reason) {
    // Nothing of ours to restore when the Preset was already deleted elsewhere.
    if (!deleted) throw reason;
    let restored: boolean;
    try { restored = await presets.rollbackIfCurrent(after, before, scope); }
    catch (rollback) {
      throw new Error(`Binding cleanup failed and the Preset could not be restored (${rollback instanceof Error ? rollback.message : String(rollback)}). `
        + "The Preset stays deleted; delete it again to finish removing its Bindings.", { cause: reason });
    }
    if (!restored)
      throw new Error("Preset changed while Binding cleanup failed. Newer data was kept; review the Preset and Bindings. "
        + "Delete the Preset again to finish removing its Bindings.", { cause: reason });
    throw reason;
  }
  return next;
}
