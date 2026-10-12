import { cursorId, request, type MemoryStorage } from "./storage";
import type { Memory, MemoryCursor, MemoryOperation, MemorySource, Suppression } from "./types";

const withoutSession = (sources: readonly MemorySource[], sessionId: string) => sources.filter((item) => item.sessionId !== sessionId);
const touches = (sources: readonly MemorySource[], sessionId: string) => sources.some((item) => item.sessionId === sessionId);

/** Delete every row a Character owns, in one transaction. */
export function deleteCharacterMemory(storage: MemoryStorage, characterId: string): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    for (const name of ["memories", "suppressions", "operations", "cursors"] as const) {
      const store = tx.store(name);
      for (const key of await request<IDBValidKey[]>(store.index("characterId").getAllKeys(characterId)))
        await request(store.delete(key));
    }
  });
}

/** Step 1 of clearing session A: persist the intent so a crash or reload can finish it. */
export function recordClearIntent(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors");
    const id = cursorId(characterId, sessionId);
    const previous = await request<MemoryCursor | undefined>(store.get(id));
    const now = storage.now();
    await request(store.put({ failureCount: 0, ...previous, id, characterId, sessionId,
      clearRequestedAt: previous?.clearRequestedAt ?? now, updatedAt: now } satisfies MemoryCursor));
  });
}

/**
 * Step 2: remove everything sourced from session A, then the cursor (and with it the intent), in one
 * transaction. Safe to run any number of times. No model calls: merged memories are unwound by lineage.
 */
export function completeClear(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const memoriesStore = tx.store("memories");
    const rows = new Map((await request<Memory[]>(memoriesStore.index("characterId").getAll(characterId))).map((row) => [row.id, row]));
    const deleted = new Set<string>();
    const changed = new Map<string, Memory>();
    const live = (id: string) => changed.get(id) ?? rows.get(id)!;

    const dropSource = (memory: Memory) => {
      if (!touches(memory.sources, sessionId)) return;
      const sources = withoutSession(memory.sources, sessionId);
      // Manual memories survive with the source removed; auto memories left with no source are removed.
      if (memory.origin === "auto" && sources.length === 0) { deleted.add(memory.id); changed.delete(memory.id); }
      else changed.set(memory.id, { ...memory, sources, updatedAt: storage.now() });
    };

    // Merged memories first: unwind originals by lineage, then drop the merged record.
    for (const merged of rows.values()) {
      const originals = merged.lineage.mergedFrom;
      if (!originals?.length) continue;
      const originalRows = originals.map((id) => rows.get(id)).filter((row): row is Memory => !!row);
      if (!touches(merged.sources, sessionId) && !originalRows.some((row) => touches(row.sources, sessionId))) continue;
      for (const original of originalRows) {
        dropSource(live(original.id));
        if (deleted.has(original.id)) continue;
        const current = live(original.id);
        const { supersededBy, ...lineage } = current.lineage;
        if (supersededBy === merged.id) {
          // Do not revive an original whose text is already covered by another live memory.
          const covered = [...rows.keys()].map(live).some((row) => row.id !== original.id && !deleted.has(row.id)
            && (row.status === "active" || row.status === "flagged") && row.fingerprint === current.fingerprint);
          changed.set(original.id, { ...current, status: covered ? current.status : "active", lineage, updatedAt: storage.now() });
        }
      }
      deleted.add(merged.id);
      changed.delete(merged.id);
    }
    for (const memory of rows.values())
      if (!deleted.has(memory.id) && !memory.lineage.mergedFrom?.length) dropSource(live(memory.id));

    for (const id of deleted) await request(memoriesStore.delete(id));
    for (const row of changed.values()) await request(memoriesStore.put(row));

    const suppressions = tx.store("suppressions");
    for (const row of await request<Suppression[]>(suppressions.index("characterId").getAll(characterId))) {
      if (!touches(row.sources, sessionId)) continue;
      const sources = withoutSession(row.sources, sessionId);
      if (sources.length === 0) await request(suppressions.delete(row.id));
      else await request(suppressions.put({ ...row, sources }));
    }

    // Undo records could restore A-sourced memories, so any that reference A are dropped.
    const operations = tx.store("operations");
    for (const row of await request<MemoryOperation[]>(operations.index("characterId").getAll(characterId)))
      if (row.changes.some((c) => touches(c.before?.sources ?? [], sessionId) || touches(c.after?.sources ?? [], sessionId))
        || row.suppressionChanges?.some((c) => touches(c.before?.sources ?? [], sessionId) || touches(c.after.sources, sessionId)))
        await request(operations.delete(row.id));

    await request(tx.store("cursors").delete(cursorId(characterId, sessionId)));
  });
}

export async function clearSession(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  await recordClearIntent(storage, characterId, sessionId);
  await completeClear(storage, characterId, sessionId);
}

/** Finish every persisted clear intent of a Character (for example after a reload). Returns the session ids redone. */
export async function resumePendingClears(storage: MemoryStorage, characterId: string): Promise<string[]> {
  const pending = (await storage.listCursors(characterId)).filter((row) => row.clearRequestedAt !== undefined);
  for (const row of pending) await completeClear(storage, characterId, row.sessionId);
  return pending.map((row) => row.sessionId);
}
