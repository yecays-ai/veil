import type { ChatSession } from "../chat/types";
import { maintenanceDue, MAINTENANCE_TRIGGER_SEQUENCES } from "./maintenance-capacity";
import type { MemoryCursor } from "./types";

export type MaintenanceSchedulerDependencies = {
  enabled(): boolean; runnable(): boolean;
  sessions(): Promise<ChatSession[]>;
  cursors(characterId: string): Promise<MemoryCursor[]>;
  /** Test seam only: production always uses MAINTENANCE_TRIGGER_SEQUENCES. */
  triggerSequences?: number;
  /** True when a direct session of the Character has a rolling summary worth writing. Reads no storage. */
  summaryDue?(sessions: ChatSession[], characterId: string): boolean;
  run(characterId: string, signal: AbortSignal, due: { memory: boolean; summary: boolean }): Promise<boolean | "busy">;
  setTimer(callback: () => void, delay: number): unknown; clearTimer(timer: unknown): void;
};
/**
 * Page-lifetime wakeups only. Durable Chat activity and M5a progress remain the authority.
 * A wakeup starts a run only when a full batch of messages (or a recoverable batch) is waiting: there is no idle timer.
 */
export function createMaintenanceScheduler(deps: MaintenanceSchedulerDependencies) {
  let stopped = false, reading = false, dirty = false, readRetries = 0, cursorRetries = 0, retryVersion = 0;
  let readRetry: unknown;
  const timers = new Map<string, unknown>(), running = new Map<string, AbortController>();
  const clear = () => {
    retryVersion++;
    if (readRetry !== undefined) { deps.clearTimer(readRetry); readRetry = undefined; }
    for (const timer of timers.values()) deps.clearTimer(timer); timers.clear();
  };
  /** At most two local read retries per failure streak; this re-reads durable state, never retries a dispatched model request. */
  const retryRead = (kind: "sessions" | "cursors") => {
    if (stopped || !deps.enabled() || !deps.runnable() || readRetry !== undefined) return;
    if ((kind === "sessions" ? readRetries : cursorRetries) >= 2) return;
    if (kind === "sessions") readRetries++; else cursorRetries++;
    const version = retryVersion;
    readRetry = deps.setTimer(() => {
      if (stopped || version !== retryVersion) return;
      readRetry = undefined;
      void wake().catch(() => undefined);
    }, 5_000);
  };
  const wake = async (): Promise<void> => {
    if (stopped) return;
    if (reading) { dirty = true; return; }
    reading = true;
    try {
      clear();
      if (!deps.enabled() || !deps.runnable()) return;
      let sessions: ChatSession[];
      try { sessions = await deps.sessions(); }
      catch {
        // Keep wakeups received during this read; finally consumes one pending recheck.
        retryRead("sessions");
        return;
      }
      readRetries = 0;
      if (stopped || !deps.enabled() || !deps.runnable()) return;
      const characters = new Set(sessions.filter((s) => s.type !== "group" && ((s.memorySequence && s.memorySequence.nextSeq > 1) || deps.summaryDue?.([s], s.characterId))).map((s) => s.characterId));
      let cursorReadFailed = false;
      for (const characterId of characters) {
        if (running.has(characterId)) { dirty = true; continue; }
        const summary = deps.summaryDue?.(sessions, characterId) ?? false;
        let memory = false;
        try { memory = maintenanceDue(sessions, await deps.cursors(characterId), characterId, deps.triggerSequences ?? MAINTENANCE_TRIGGER_SEQUENCES); }
        catch { cursorReadFailed = true; retryRead("cursors"); if (!summary) continue; } // Unreadable progress dispatches no maintenance.
        if (!(memory || summary) || stopped) continue;
        timers.set(characterId, deps.setTimer(() => {
          timers.delete(characterId);
          if (stopped || running.has(characterId) || !deps.enabled() || !deps.runnable()) return;
          const controller = new AbortController(); running.set(characterId, controller);
          void deps.run(characterId, controller.signal, { memory, summary }).then((more) => {
            if (more === "busy" && !stopped) {
              // Ownership contention is not a model retry. Re-read durable dispatch after lease release.
              timers.set(characterId, deps.setTimer(() => { void wake().catch(() => undefined); }, 5_000));
            } else if (more === true) dirty = true;
          }).catch(() => { /* No raw errors, cursor success or hidden resend. */ }).finally(() => {
            running.delete(characterId);
            if (dirty && !stopped) { dirty = false; void wake().catch(() => undefined); }
          });
        }, 0));
      }
      if (!cursorReadFailed) cursorRetries = 0;
    } finally {
      reading = false;
      if (dirty && !stopped && !running.size) { dirty = false; void wake().catch(() => undefined); }
    }
  };
  return { wake, stop() { stopped = true; clear(); for (const controller of running.values()) controller.abort(); } };
}
