import { completeClear, cancelClearIntent, deleteCharacterMemory } from "./lifecycle";
import { request, type MemoryStorage } from "./storage";
import type { MemoryCursor } from "./types";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import { BackupValidationError } from "../backup/format";

/** What the startup pass may read from the rest of the app. Every read is a single list/count/lookup call. */
export type StartupClearDeps = {
  /** Existing Characters (possibly an empty set), or null when that is not proven: nothing is then changed. */
  aliveCharacters(scope?: PersistenceWriteScope): Promise<ReadonlySet<string> | null>;
  sessionIds(scope?: PersistenceWriteScope): Promise<ReadonlySet<string>>;
  countMessages(sessionId: string, scope?: PersistenceWriteScope): Promise<number>;
  /** Which of these messages still exist in the session. */
  existingMessageIds(sessionId: string, ids: readonly string[], scope?: PersistenceWriteScope): Promise<ReadonlySet<string>>;
};
export type StartupClearReport = { completed: number; cancelled: number; deferred: number; failed: number };

/**
 * Finishes clear intents that an earlier run recorded but did not complete. It only looks at existing cursors with
 * `clearRequestedAt`, never starts a new deletion, and runs once per page load. Each intent is checked first:
 * - Character gone (proven by a successful Foundation read, even an empty list): its Memory is removed.
 * - session gone or empty: the clear happened; sources of the recorded messages are removed.
 * - session has messages and the intent recorded its target messages:
 *     any target still exists  -> the chat clear failed: the intent is withdrawn, Memory kept;
 *     no target exists         -> the clear happened and messages were added afterwards: only the recorded
 *                                 targets' sources are removed, sources of newer messages stay.
 * - session has messages and the intent has no recorded targets (an older intent): the two cases cannot be told
 *   apart, so the data-preserving choice is made and the intent is withdrawn.
 * A failure keeps the record, increments failureCount for diagnostics, and is retried at the next startup.
 */
export async function resumeStartupClears(storage: MemoryStorage, deps: StartupClearDeps, signal?: AbortSignal): Promise<StartupClearReport> {
  const report: StartupClearReport = { completed: 0, cancelled: 0, deferred: 0, failed: 0 };
  const cursors = await storage.transaction("readonly", (tx) => request<MemoryCursor[]>(tx.store("cursors").getAll()));
  const pending = cursors.filter((row) => row.clearRequestedAt !== undefined);
  if (!pending.length || signal?.aborted) return report;
  for (const row of pending) {
    if (signal?.aborted) { report.deferred++; continue; }
    try {
      await storage.withExclusive(async (scope) => {
        const current = (await storage.listCursors(row.characterId, scope)).find((cursor) => cursor.id === row.id);
        if (!current || current.clearRequestedAt === undefined || current.clearToken !== row.clearToken) { report.deferred++; return; }
        let alive: ReadonlySet<string> | null, sessions: ReadonlySet<string>;
        try { [alive, sessions] = await Promise.all([deps.aliveCharacters(scope), deps.sessionIds(scope)]); }
        catch { report.deferred++; return; }
        if (!alive || signal?.aborted) { report.deferred++; return; }
        if (!alive.has(current.characterId)) { await deleteCharacterMemory(storage, current.characterId, scope); report.completed++; return; }
        const targetIds = current.clearMessageIds;
        const targets = targetIds && new Set(targetIds);
        if (sessions.has(current.sessionId) && await deps.countMessages(current.sessionId, scope) > 0) {
          if (!targetIds) { await cancelClearIntent(storage, current.characterId, current.sessionId, scope); report.cancelled++; return; }
          if (targetIds.length && (await deps.existingMessageIds(current.sessionId, targetIds, scope)).size > 0) {
            await cancelClearIntent(storage, current.characterId, current.sessionId, scope); report.cancelled++; return;
          }
        }
        await completeClear(storage, current.characterId, current.sessionId, targets, scope);
        report.completed++;
      }, { signal });
    } catch (error) {
      if (error instanceof BackupValidationError || signal?.aborted) { report.deferred++; continue; }
      report.failed++;
      try { await storage.withExclusive((scope) => storage.transaction("readwrite", async (tx) => {
        const store = tx.store("cursors"), current = await request<MemoryCursor | undefined>(store.get(row.id));
        if (current?.clearRequestedAt !== undefined && current.clearRequestedAt === row.clearRequestedAt && current.clearToken === row.clearToken)
          await request(store.put({ ...current, failureCount: current.failureCount + 1, failureReason: "clear-cleanup-failed", updatedAt: storage.now() }));
      }, scope), { signal }); }
      catch { /* the intent itself is still persisted; the next startup retries */ }
    }
  }
  return report;
}
