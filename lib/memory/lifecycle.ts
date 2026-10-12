import { cleanMemoryLineage } from "./lineage";
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
export function recordClearIntent(storage: MemoryStorage, characterId: string, sessionId: string, scope?: PersistenceWriteScope): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors");
    const id = cursorId(characterId, sessionId);
    const previous = await request<MemoryCursor | undefined>(store.get(id));
    const now = storage.now();
    const targets = new Set(previous?.clearMessageIds ?? []);
    for (const batch of previous?.extraction?.batches ?? []) for (const source of batch.sources) targets.add(source.messageId);
    const collect = (sources: readonly MemorySource[] = []) => { for (const item of sources) if (item.sessionId === sessionId) targets.add(item.messageId); };
    for (const name of ["memories", "suppressions"] as const)
      for (const row of await request<{ sources: MemorySource[] }[]>(tx.store(name).index("characterId").getAll(characterId))) collect(row.sources);
    for (const row of await request<MemoryOperation[]>(tx.store("operations").index("characterId").getAll(characterId))) {
      for (const change of row.changes) { collect(change.before?.sources); collect(change.after?.sources); }
      for (const change of row.suppressionChanges ?? []) { collect(change.before?.sources); collect(change.after.sources); }
    }
    await request(store.put({ failureCount: 0, ...previous, id, characterId, sessionId,
      clearRequestedAt: previous?.clearRequestedAt ?? now, clearToken: previous?.clearToken ?? crypto.randomUUID(),
      clearMessageIds: [...targets].sort(), updatedAt: now } satisfies MemoryCursor));
  }, scope);
}

/** Withdraw an intent whose chat operation failed, so a later resume cannot erase memory for chat that still exists. */
export function cancelClearIntent(storage: MemoryStorage, characterId: string, sessionId: string, scope?: PersistenceWriteScope): Promise<void> {
  return storage.transaction("readwrite", async (tx) => {
    const store = tx.store("cursors");
    const previous = await request<MemoryCursor | undefined>(store.get(cursorId(characterId, sessionId)));
    if (!previous || previous.clearRequestedAt === undefined) return;
    const { clearRequestedAt: _requested, clearToken: _token, clearMessageIds: _targets, clearLineageIds: _isolated, ...rest } = previous;
    void [_requested, _targets, _isolated, _token];
    // An intent-only row carries nothing else worth keeping.
    if (rest.extraction === undefined && rest.processedMessageId === undefined && rest.failureCount === 0 && rest.failureReason === undefined) await request(store.delete(previous.id));
    else await request(store.put({ ...rest, updatedAt: storage.now() } satisfies MemoryCursor));
  }, scope);
}

/**
 * Step 2: remove everything sourced from session A, then the cursor (and with it the intent), in one
 * transaction. Safe to run any number of times. No model calls: merged memories are unwound by lineage.
 * With `targets` (message ids recorded when the clear was requested), only sources pointing at those messages are
 * removed; sources of messages added afterwards are kept. Without it, every source of the session goes.
 */
export function completeClear(storage: MemoryStorage, characterId: string, sessionId: string, targets?: ReadonlySet<string>, scope?: PersistenceWriteScope): Promise<void> {
  const hit = (item: MemorySource) => item.sessionId === sessionId && (!targets || targets.has(item.messageId));
  const touches = (sources: readonly MemorySource[]) => sources.some(hit);
  const withoutTargets = (sources: readonly MemorySource[]) => sources.filter((item) => !hit(item));
  return storage.transaction("readwrite", async (tx) => {
    const memoriesStore = tx.store("memories");
    const rows = await request<Memory[]>(memoriesStore.index("characterId").getAll(characterId));
    const suppressionRows = await request<Suppression[]>(tx.store("suppressions").index("characterId").getAll(characterId));
    const cursor = await request<MemoryCursor | undefined>(tx.store("cursors").get(cursorId(characterId, sessionId)));
    const cleaned = cleanMemoryLineage(rows, suppressionRows, hit, storage.now(), cursor?.clearLineageIds);
    for (const id of cleaned.deleted) await request(memoriesStore.delete(id));
    for (const row of cleaned.rows) await request(memoriesStore.put(row));

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

    if (!cleaned.incomplete) await request(tx.store("cursors").delete(cursorId(characterId, sessionId)));
    else await request(tx.store("cursors").put({ failureCount: 0, ...cursor, id: cursorId(characterId, sessionId), characterId, sessionId,
      clearRequestedAt: cursor?.clearRequestedAt ?? storage.now(), clearToken: cursor?.clearToken ?? crypto.randomUUID(), clearLineageIds: cleaned.isolated, updatedAt: storage.now() } satisfies MemoryCursor));
    return cleaned.incomplete;
  }, scope).then((incomplete) => { if (incomplete) throw new Error("Memory lineage cleanup deferred: damaged chain."); });
}

export async function clearSession(storage: MemoryStorage, characterId: string, sessionId: string): Promise<void> {
  await storage.withShared(async (scope) => {
    await recordClearIntent(storage, characterId, sessionId, scope);
    await completeClear(storage, characterId, sessionId, undefined, scope);
  });
}

/** Finish every persisted clear intent of a Character (for example after a reload). Returns the session ids redone. */
export async function resumePendingClears(storage: MemoryStorage, characterId: string): Promise<string[]> {
  const pending = (await storage.listCursors(characterId)).filter((row) => row.clearRequestedAt !== undefined);
  const completed: string[] = [];
  for (const row of pending) {
    let completedSessionId: string | undefined;
    try {
      await storage.withExclusive(async (scope) => {
        const current = (await storage.listCursors(characterId, scope)).find((cursor) => cursor.id === row.id);
        if (current?.clearRequestedAt === undefined) return;
        await completeClear(storage, characterId, current.sessionId, current.clearMessageIds && new Set(current.clearMessageIds), scope);
        completedSessionId = current.sessionId;
      });
      if (completedSessionId !== undefined) completed.push(completedSessionId);
    } catch {
      // Keep the failed intent for recovery without blocking other sessions.
    }
  }
  return completed;
}
