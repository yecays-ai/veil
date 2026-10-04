import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";

export interface FoundationStorage {
  load(): Promise<FoundationDocument>;
  hasStoredDocument(): Promise<boolean>;
  replaceIfEmpty(document: FoundationDocument): Promise<FoundationDocument>;
  transact(
    update: (document: FoundationDocument) => FoundationDocument,
  ): Promise<FoundationDocument>;
}
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const KEY = "veil.foundation.v1";
export function createFoundationStorage(
  getStorage: () => StringStorage,
): FoundationStorage {
  let queue = Promise.resolve();
  const load = async () => {
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
    async hasStoredDocument() {
      return getStorage().getItem(KEY) !== null;
    },
    replaceIfEmpty(document) {
      const operation = queue.then(async () => {
        // Check the raw key at write time: a deliberately saved default is not
        // an empty installation and must never be replaced by a backup.
        if (getStorage().getItem(KEY) !== null)
          throw new Error("Profile data is no longer empty. Restore was not applied.");
        const next = normalizeFoundation(document);
        try {
          getStorage().setItem(KEY, JSON.stringify(next));
        } catch {
          throw new Error("Could not restore profile data. Browser storage may be unavailable.");
        }
        return next;
      });
      queue = operation.then(
        () => {},
        () => {},
      );
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
