import { browserPersistenceWriteGate, type PersistenceWriteGate } from "./backup/persistence-write-gate";

export class EditorSnapshotConflict extends Error {}

// The two library adapters share the same guarded-write contract without
// changing their formats, validators or feature-specific recovery messages.
export function createRegexWorldBookWriteGuard<D>(key: string, validate: (value: unknown) => D,
  messages: { busy: string; unsupported: string; conflict: string },
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate) {
  return {
    async exclusive<T>(operation: () => T, guarded: boolean): Promise<T> {
      return writeGate.withWrite(async () => {
        if (typeof navigator !== "undefined" && navigator.locks)
          return await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
            if (!lock) throw new Error(messages.busy);
            return operation();
          });
        if (guarded && typeof window !== "undefined") throw new Error(messages.unsupported);
        return operation();
      });
    },
    assertSnapshot(current: D, expected?: D) {
      if (expected && JSON.stringify(current) !== JSON.stringify(validate(expected)))
        throw new EditorSnapshotConflict(messages.conflict);
    },
  };
}
