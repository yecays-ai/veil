import { completeClear, cancelClearIntent, deleteCharacterMemory } from "./lifecycle";
import { request, type MemoryStorage } from "./storage";
import type { MemoryCursor } from "./types";

/** What the startup pass may read from the rest of the app. Every read is a single list/count/lookup call. */
export type StartupClearDeps = {
  /** Existing Characters (possibly an empty set), or null when that is not proven: nothing is then changed. */
  aliveCharacters(): Promise<ReadonlySet<string> | null>;
  sessionIds(): Promise<ReadonlySet<string>>;
  countMessages(sessionId: string): Promise<number>;
  /** Which of these messages still exist in the session. */
  existingMessageIds(sessionId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
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
  let alive: ReadonlySet<string> | null, sessions: ReadonlySet<string>;
  try { [alive, sessions] = await Promise.all([deps.aliveCharacters(), deps.sessionIds()]); }
  catch { report.deferred = pending.length; return report; }
  if (!alive) { report.deferred = pending.length; return report; }
  for (const row of pending) {
    if (signal?.aborted) { report.deferred++; continue; }
    try {
      if (!alive.has(row.characterId)) { await deleteCharacterMemory(storage, row.characterId); report.completed++; continue; }
      const targetIds = row.clearMessageIds;
      const targets = targetIds && new Set(targetIds);
      if (sessions.has(row.sessionId) && await deps.countMessages(row.sessionId) > 0) {
        if (!targetIds) { await cancelClearIntent(storage, row.characterId, row.sessionId); report.cancelled++; continue; }
        if (targetIds.length && (await deps.existingMessageIds(row.sessionId, targetIds)).size > 0) {
          await cancelClearIntent(storage, row.characterId, row.sessionId); report.cancelled++; continue;
        }
      }
      await completeClear(storage, row.characterId, row.sessionId, targets);
      report.completed++;
    } catch {
      report.failed++;
      try { await storage.saveCursor(row.characterId, row.sessionId, { failureCount: row.failureCount + 1, failureReason: "clear-cleanup-failed" }); }
      catch { /* the intent itself is still persisted; the next startup retries */ }
    }
  }
  return report;
}
