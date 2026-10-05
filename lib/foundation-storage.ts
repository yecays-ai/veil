import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";
import {
  browserDocumentStorage,
  type DocumentStorage,
} from "./core-document-storage";
import { migrateLegacyBindings } from "./binding-storage";

export interface FoundationStorage {
  load(): Promise<FoundationDocument>;
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: FoundationDocument): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
  transact(
    update: (document: FoundationDocument) => FoundationDocument,
  ): Promise<FoundationDocument>;
}
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export const FOUNDATION_STORAGE_KEY = "veil.foundation.v1";
const KEY = FOUNDATION_STORAGE_KEY;
export function createFoundationStorage(
  getStorage: () => StringStorage,
): FoundationStorage {
  let queue = Promise.resolve();
  const load = async () => {
    migrateLegacyBindings(getStorage());
    migrateLegacyBindings(getStorage());
    const value = getStorage().getItem(KEY);
    if (!value) return defaultFoundation();
    try {
      return normalizeFoundation(JSON.parse(value));
    } catch {
      throw new Error(
        "Saved profile data could not be read. Keep a backup before repairing browser storage.",
      );
    }
  };
  return {
    load,
    async readRaw() {
      migrateLegacyBindings(getStorage());
      migrateLegacyBindings(getStorage());
      return getStorage().getItem(KEY);
    },
    replaceIfCurrent(expected, document) {
      const operation = queue.then(async () => {
        if (getStorage().getItem(KEY) !== expected)
          throw new Error("Profile data changed while restore was being prepared.");
        const raw = JSON.stringify(normalizeFoundation(document));
        getStorage().setItem(KEY, raw);
        return raw;
      });
      queue = operation.then(() => {}, () => {});
      return operation;
    },
    rollbackIfCurrent(expected, previous) {
      const operation = queue.then(async () => {
        if (getStorage().getItem(KEY) !== expected) return false;
        if (previous === null) {
          const storage = getStorage();
          if (!storage.removeItem)
            throw new Error("Profile rollback is unavailable for this storage.");
          storage.removeItem(KEY);
        } else getStorage().setItem(KEY, previous);
        return true;
      });
      queue = operation.then(() => {}, () => {});
      return operation;
    },
    transact(update) {
      const operation = queue.then(async () => {
        const next = normalizeFoundation(update(await load()));
        try {
          getStorage().setItem(KEY, JSON.stringify(next));
        } catch {
          throw new Error(
            "Could not save profile data. Browser storage may be full or unavailable. Try a smaller avatar.",
          );
        }
        return next;
      });
      queue = operation.then(
        () => {},
        () => {},
      );
      return operation;
    },
  };
}
export function createIndexedDBFoundationStorage(
  documents: DocumentStorage,
  legacy: () => StringStorage,
): FoundationStorage {
  const normalizeRaw = (raw: string): string => {
    try {
      return JSON.stringify(normalizeFoundation(JSON.parse(raw)));
    } catch {
      throw new Error(
        "Saved profile data could not be read. Keep a backup before repairing browser storage.",
      );
    }
  };
  const readRaw = async () => {
    const current = await documents.read(KEY);
    if (current !== null) return current;
    const legacyStorage = legacy();
    const previous = legacyStorage.getItem(KEY);
    if (previous === null) return null;
    // Validate before migration, then let the bindings migration split its own
    // document from the legacy Foundation payload. The original local copy is
    // retained for rollback to older builds.
    normalizeRaw(previous);
    migrateLegacyBindings(legacyStorage);
    return documents.putIfAbsent(KEY, normalizeRaw(legacyStorage.getItem(KEY) ?? previous));
  };
  return {
    async load() {
      const raw = await readRaw();
      return raw === null ? defaultFoundation() : normalizeFoundation(JSON.parse(raw));
    },
    readRaw,
    async replaceIfCurrent(expected, document) {
      const raw = JSON.stringify(normalizeFoundation(document));
      if (!(await documents.replaceIfCurrent(KEY, expected, raw)))
        throw new Error("Profile data changed while restore was being prepared.");
      return raw;
    },
    rollbackIfCurrent(expected, previous) {
      return documents.rollbackIfCurrent(KEY, expected, previous);
    },
    async transact(update) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const before = await readRaw();
        const current = before === null
          ? defaultFoundation()
          : normalizeFoundation(JSON.parse(before));
        const next = normalizeFoundation(update(structuredClone(current)));
        const raw = JSON.stringify(next);
        if (await documents.replaceIfCurrent(KEY, before, raw)) return next;
      }
      throw new Error("Profile data changed repeatedly while saving. Try again.");
    },
  };
}

export const browserFoundationStorage = createIndexedDBFoundationStorage(
  browserDocumentStorage,
  () => window.localStorage,
);
