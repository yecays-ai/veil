import {
  defaultFoundation,
  normalizeFoundation,
  type FoundationDocument,
} from "./foundation-types";
import type { PersistenceWriteScope } from "./backup/persistence-write-gate";
import {
  browserDocumentStorage,
  type DocumentStorage,
} from "./core-document-storage";

export interface FoundationStorage {
  load(): Promise<FoundationDocument>;
  transact(
    update: (document: FoundationDocument) => FoundationDocument,
    scope?: PersistenceWriteScope,
  ): Promise<FoundationDocument>;
  subscribe(listener: () => void): () => void;
}
export const FOUNDATION_STORAGE_KEY = "veil.foundation.v1";
export const FOUNDATION_CHANNEL_NAME = "veil-foundation-v1";
const KEY = FOUNDATION_STORAGE_KEY;
export function createIndexedDBFoundationStorage(
  documents: DocumentStorage,
): FoundationStorage {
  const readRaw = () => documents.read(KEY);
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | undefined;
  const publish = () => listeners.forEach((listener) => {
    try { listener(); } catch { /* Persistence has already succeeded. */ }
  });
  const notify = () => {
    publish();
    try { channel?.postMessage({ type: "foundation-changed" }); } catch { /* A closed observer channel. */ }
  };
  return {
    async load() {
      const raw = await readRaw();
      return raw === null ? defaultFoundation() : normalizeFoundation(JSON.parse(raw));
    },
    async transact(update, scope) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const before = await readRaw();
        const current = before === null
          ? defaultFoundation()
          : normalizeFoundation(JSON.parse(before));
        const next = normalizeFoundation(update(structuredClone(current)));
        const raw = JSON.stringify(next);
        if (await documents.replaceIfCurrent(KEY, before, raw, scope)) {
          notify();
          return next;
        }
      }
      throw new Error("Profile data changed repeatedly while saving. Try again.");
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(FOUNDATION_CHANNEL_NAME);
        channel.onmessage = (event) => {
          if (event.data && typeof event.data === "object" &&
            event.data.type === "foundation-changed") publish();
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          channel?.close();
          channel = undefined;
        }
      };
    },
  };
}

export const browserFoundationStorage = createIndexedDBFoundationStorage(
  browserDocumentStorage,
);
