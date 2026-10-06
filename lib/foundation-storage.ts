import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";
import {
  browserDocumentStorage,
  type DocumentStorage,
} from "./core-document-storage";

export interface FoundationStorage {
  load(): Promise<FoundationDocument>;
  transact(
    update: (document: FoundationDocument) => FoundationDocument,
  ): Promise<FoundationDocument>;
}
export const FOUNDATION_STORAGE_KEY = "veil.foundation.v1";
const KEY = FOUNDATION_STORAGE_KEY;
export function createIndexedDBFoundationStorage(
  documents: DocumentStorage,
): FoundationStorage {
  const readRaw = () => documents.read(KEY);
  return {
    async load() {
      const raw = await readRaw();
      return raw === null ? defaultFoundation() : normalizeFoundation(JSON.parse(raw));
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
);
