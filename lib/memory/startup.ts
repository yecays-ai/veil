import { completeClear, cancelClearIntent, deleteCharacterMemory } from "./lifecycle";
import { request, type MemoryStorage } from "./storage";
import type { MemoryCursor } from "./types";

/** A pending clear that keeps failing is left in place after this many startups instead of being retried forever. */
export const MAX_CLEAR_FAILURES = 5;

/** What the startup pass may read from the rest of the app. Every read is a single list/count call. */
export type StartupClearDeps = {
  /** Existing Characters, or null when Foundation could not be read or is empty (nothing is then proven). */
  aliveCharacters(): Promise<ReadonlySet<string> | null>;
  sessionIds(): Promise<ReadonlySet<string>>;
  countMessages(sessionId: string): Promise<number>;
};
export type StartupClearReport = { completed: number; cancelled: number; deferred: number; failed: number };

/**
 * Finishes clear intents that an earlier run recorded but did not complete. It only looks at existing cursors with
 * `clearRequestedAt`, and never starts a new deletion. Each intent is checked against the chat data first:
 * - Character gone: its Memory is removed with the Character.
 * - session gone, or kept with no messages: the chat operation happened, so the cleanup is completed. Rows created
 *   after the intent are left alone.
 * - session still has messages: the chat operation did not happen (or the id was reused), so the intent is withdrawn.
 * A failure keeps the record and counts toward MAX_CLEAR_FAILURES; unreadable chat data changes nothing.
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
    if (signal?.aborted || row.failureCount >= MAX_CLEAR_FAILURES) { report.deferred++; continue; }
    try {
      if (!alive.has(row.characterId)) { await deleteCharacterMemory(storage, row.characterId); report.completed++; continue; }
      if (sessions.has(row.sessionId) && await deps.countMessages(row.sessionId) > 0) {
        await cancelClearIntent(storage, row.characterId, row.sessionId); report.cancelled++; continue;
      }
      await completeClear(storage, row.characterId, row.sessionId, row.clearRequestedAt);
      report.completed++;
    } catch {
      report.failed++;
      try { await storage.saveCursor(row.characterId, row.sessionId, { failureCount: row.failureCount + 1, failureReason: "clear-cleanup-failed" }); }
      catch { /* the intent itself is still persisted; the next startup retries */ }
    }
  }
  return report;
}
