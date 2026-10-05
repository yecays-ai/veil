import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";
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
const KEY = "veil.foundation.v1";
export function createFoundationStorage(
  getStorage: () => StringStorage,
): FoundationStorage {
  let queue = Promise.resolve();
  const load = async () => {
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
export const browserFoundationStorage = createFoundationStorage(
  () => window.localStorage,
);
