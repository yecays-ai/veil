import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";

export interface FoundationStorage {
  load(): Promise<FoundationDocument>;
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
