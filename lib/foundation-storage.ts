import { BackupValidationError } from "./backup/format";
import { browserMemoryStorage } from "./memory/instance";
import type { MemoryStorage } from "./memory/storage";
import { synchronizeBackground } from "./memory/state-runtime";
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
  load(scope?: PersistenceWriteScope): Promise<FoundationDocument>;
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
  memory?: MemoryStorage,
): FoundationStorage {
  const readRaw = (scope?: PersistenceWriteScope) => documents.read(KEY, scope);
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
    async load(scope) {
      const read = async (owned?: PersistenceWriteScope) => {
        const raw = await readRaw(owned);
        const current = raw === null ? defaultFoundation() : normalizeFoundation(JSON.parse(raw));
        // Repair an interrupted second database write from saved authority, never from an unsaved draft.
        if (memory && owned && raw !== null) {
          let exclusive = true; try { memory.assertExclusive(owned); } catch { exclusive = false; }
          if (exclusive) for (const character of current.characters) await synchronizeBackground(memory, character, owned);
        }
        return current;
      };
      if (!memory || scope) return read(scope);
      try { return await memory.withExclusive(read); }
      catch (error) {
        // Ordinary read-only Foundation remains available without Web Locks; State stays unavailable.
        if (error instanceof BackupValidationError && error.code === "coordination-unavailable") return read();
        throw error;
      }
    },
    async transact(update, scope) {
      if (memory && !scope) {
        try { return await memory.withExclusive((owned) => this.transact(update, owned)); }
        catch (error) {
          if (error instanceof BackupValidationError && error.code === "coordination-unavailable")
            return memory.withShared((owned) => this.transact(update, owned));
          throw error;
        }
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const before = await readRaw(scope);
        const current = before === null
          ? defaultFoundation()
          : normalizeFoundation(JSON.parse(before));
        const next = normalizeFoundation(update(structuredClone(current)));
        let coordinated = false;
        if (memory && scope) {
          try { memory.assertExclusive(scope); coordinated = true; } catch {
            // Never upgrade a caller's shared lease; existing scoped status/signature/deletion writes stay valid.
            if (next.characters.some((row) => current.characters.find((old) => old.characterId === row.characterId)?.backstory !== row.backstory))
              throw new Error("Background saving requires storage coordination. Nothing was changed.");
          }
        }
        // Preserve the original saved Background before replacing Foundation. Each database commits separately.
        if (memory && scope && coordinated) for (const character of current.characters)
          if (next.characters.some((row) => row.characterId === character.characterId)) await synchronizeBackground(memory, character, scope);
        const raw = JSON.stringify(next);
        if (await documents.replaceIfCurrent(KEY, before, raw, scope)) {
          // A failure here leaves a detectable text mismatch. load()/retry appends the saved authority;
          // Prompt and State readers treat the mismatch as pending in the meantime.
          try { if (memory && scope && coordinated) for (const character of next.characters) await synchronizeBackground(memory, character, scope); }
          finally { notify(); }
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
  browserDocumentStorage, browserMemoryStorage,
);
