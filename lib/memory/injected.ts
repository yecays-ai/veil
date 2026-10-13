import type { MemoryRef } from "../chat/types";
import { memoryEntryHash } from "./context";
import type { Memory, MemoryOperation } from "./types";

/**
 * What one reply's Memory panel can say about an entry that was injected into it. A reply stores only the row id and
 * a hash of the injected content, so the panel shows text only when it can prove the text is what was injected:
 * the stored row still matches, or a recent undo record still holds that version of a row that still exists.
 * Anything else is "unavailable". The current text is never substituted, and a deleted memory shows nothing.
 */
export type InjectedMemory =
  | { state: "current"; ref: MemoryRef; row: Memory }
  | { state: "earlier"; ref: MemoryRef; row: Memory; kind: string; text: string }
  | { state: "deleted"; ref: MemoryRef }
  | { state: "unavailable"; ref: MemoryRef };

export async function resolveInjected(refs: readonly MemoryRef[], rows: readonly Memory[], operations: readonly MemoryOperation[]): Promise<InjectedMemory[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const versions = operations.flatMap((operation) => operation.changes.flatMap((change) => [change.before, change.after]))
    .filter((row): row is Memory => row !== null);
  return Promise.all(refs.map(async (ref): Promise<InjectedMemory> => {
    const row = byId.get(ref.id);
    if (!row) return { state: "deleted", ref };
    if (await memoryEntryHash(row) === ref.hash) return { state: "current", ref, row };
    for (const version of versions) if (version.id === ref.id && await memoryEntryHash(version) === ref.hash)
      return { state: "earlier", ref, row, kind: version.kind, text: version.text };
    return { state: "unavailable", ref };
  }));
}
