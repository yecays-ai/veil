import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import { cursorId, request, type MemoryStorage } from "./storage";
import type { Memory, MemoryCursor, MemoryOperation, MemorySource, Suppression } from "./types";


/** Delete every row a Character owns, in one transaction. */
export function deleteCharacterMemory(storage: MemoryStorage, characterId: string, scope?: PersistenceWriteScope): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    for (const name of ["memories", "suppressions", "operations", "cursors"] as const) {
      const store = tx.store(name);
      for (const key of await request<IDBValidKey[]>(store.index("characterId").getAllKeys(characterId)))
        await request(store.delete(key));
    }
  }, scope);
}

/** Step 1 of clearing session A: persist the intent so a crash or reload can finish it. */
export function recordClearIntent(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors");
    const id = cursorId(characterId, sessionId);
    const previous = await request<MemoryCursor | undefined>(store.get(id));
    const now = storage.now();
    const targets = new Set(previous?.clearMessageIds ?? []);
    const collect = (sources: readonly MemorySource[] = []) => { for (const item of sources) if (item.sessionId === sessionId) targets.add(item.messageId); };
    for (const name of ["memories", "suppressions"] as const)
      for (const row of await request<{ sources: MemorySource[] }[]>(tx.store(name).index("characterId").getAll(characterId))) collect(row.sources);
    for (const row of await request<MemoryOperation[]>(tx.store("operations").index("characterId").getAll(characterId))) {
      for (const change of row.changes) { collect(change.before?.sources); collect(change.after?.sources); }
      for (const change of row.suppressionChanges ?? []) { collect(change.before?.sources); collect(change.after.sources); }
    }
    await request(store.put({ failureCount: 0, ...previous, id, characterId, sessionId,
      clearRequestedAt: previous?.clearRequestedAt ?? now, clearMessageIds: [...targets].sort(), updatedAt: now } satisfies MemoryCursor));
  });
}

/** Withdraw an intent whose chat operation failed, so a later resume cannot erase memory for chat that still exists. */
export function cancelClearIntent(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors");
    const previous = await request<MemoryCursor | undefined>(store.get(cursorId(characterId, sessionId)));
    if (!previous || previous.clearRequestedAt === undefined) return;
    const { clearRequestedAt: _requested, clearMessageIds: _targets, ...rest } = previous;
    void [_requested, _targets];
    // An intent-only row carries nothing else worth keeping.
    if (rest.processedMessageId === undefined && rest.failureCount === 0 && rest.failureReason === undefined) await request(store.delete(previous.id));
    else await request(store.put({ ...rest, updatedAt: storage.now() } satisfies MemoryCursor));
  });
}

/**
 * Step 2: remove everything sourced from session A, then the cursor (and with it the intent), in one
 * transaction. Safe to run any number of times. No model calls: merged memories are unwound by lineage.
 * With `targets` (message ids recorded when the clear was requested), only sources pointing at those messages are
 * removed; sources of messages added afterwards are kept. Without it, every source of the session goes.
 */
export function completeClear(storage: MemoryStorage, characterId: string, sessionId: string, targets?: ReadonlySet<string>): Promise<void> {
  const hit = (item: MemorySource) => item.sessionId === sessionId && (!targets || targets.has(item.messageId));
  const touches = (sources: readonly MemorySource[]) => sources.some(hit);
  const withoutTargets = (sources: readonly MemorySource[]) => sources.filter((item) => !hit(item));
  return storage.transaction("readwrite", async (tx) => {
    const memoriesStore = tx.store("memories");
    const rows = new Map((await request<Memory[]>(memoriesStore.index("characterId").getAll(characterId))).map((row) => [row.id, row]));
    const deleted = new Set<string>();
    const changed = new Map<string, Memory>();
    const live = (id: string) => changed.get(id) ?? rows.get(id)!;

    const dropSource = (memory: Memory) => {
      if (!touches(memory.sources)) return;
      const sources = withoutTargets(memory.sources);
      // Manual memories survive with the source removed; auto memories left with no source are removed.
      if (memory.origin === "auto" && sources.length === 0) { deleted.add(memory.id); changed.delete(memory.id); }
      else changed.set(memory.id, { ...memory, sources, updatedAt: storage.now() });
    };

    // Merged memories first: unwind originals by lineage, then drop the merged record.
    for (const merged of rows.values()) {
      const originals = merged.lineage.mergedFrom;
      if (!originals?.length) continue;
      const originalRows = originals.map((id) => rows.get(id)).filter((row): row is Memory => !!row);
      if (!touches(merged.sources) && !originalRows.some((row) => touches(row.sources))) continue;
      for (const original of originalRows) {
        dropSource(live(original.id));
        if (deleted.has(original.id)) continue;
        const current = live(original.id);
        const { supersededBy, ...lineage } = current.lineage;
        if (supersededBy === merged.id) {
          // Do not revive an original whose text is already covered by another live memory.
          const covered = [...rows.keys()].map(live).some((row) => row.id !== original.id && row.id !== merged.id && !deleted.has(row.id)
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
      if (!touches(row.sources)) continue;
      const sources = withoutTargets(row.sources);
      if (sources.length === 0) await request(suppressions.delete(row.id));
      else await request(suppressions.put({ ...row, sources }));
    }

    // Undo records could restore A-sourced memories, so any that reference A are dropped.
    const operations = tx.store("operations");
    for (const row of await request<MemoryOperation[]>(operations.index("characterId").getAll(characterId)))
      if (row.changes.some((c) => touches(c.before?.sources ?? []) || touches(c.after?.sources ?? []))
        || row.suppressionChanges?.some((c) => touches(c.before?.sources ?? []) || touches(c.after.sources)))
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
  for (const row of pending) await completeClear(storage, characterId, row.sessionId, row.clearMessageIds && new Set(row.clearMessageIds));
  return pending.map((row) => row.sessionId);
}
