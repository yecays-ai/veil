import type { ChatSession } from "../chat/types";
import { maintenanceDue } from "./maintenance-runner";

export type MaintenanceSchedulerDependencies = {
  enabled(): boolean; runnable(): boolean; now(): number;
  sessions(): Promise<ChatSession[]>;
  run(characterId: string, signal: AbortSignal): Promise<boolean | "busy">;
  setTimer(callback: () => void, delay: number): unknown; clearTimer(timer: unknown): void;
};
/** Page-lifetime wakeups only. Durable Chat activity and M5a progress remain the authority. */
export function createMaintenanceScheduler(deps: MaintenanceSchedulerDependencies) {
  let stopped = false, reading = false, dirty = false, readRetries = 0, retryVersion = 0;
  let readRetry: unknown;
  const timers = new Map<string, unknown>(), running = new Map<string, AbortController>();
  const clear = () => {
    retryVersion++;
    if (readRetry !== undefined) { deps.clearTimer(readRetry); readRetry = undefined; }
    for (const timer of timers.values()) deps.clearTimer(timer); timers.clear();
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
        // At most two local read retries per failure streak; lifecycle events may still recheck.
        // This re-reads durable activity, never retries a dispatched model request.
        // Keep wakeups received during this read; finally consumes one pending recheck.
        if (!stopped && deps.enabled() && deps.runnable() && readRetries < 2) {
          readRetries++;
          const version = retryVersion;
          readRetry = deps.setTimer(() => {
            if (stopped || version !== retryVersion) return;
            readRetry = undefined;
            void wake().catch(() => undefined);
          }, 5_000);
        }
        return;
      }
      readRetries = 0;
      if (stopped || !deps.enabled() || !deps.runnable()) return;
      const characters = new Set(sessions.filter((s) => s.type !== "group" && s.memorySequence && s.memorySequence.nextSeq > 1).map((s) => s.characterId));
      for (const characterId of characters) {
        if (running.has(characterId)) { dirty = true; continue; }
        const delay = maintenanceDue(sessions, characterId, deps.now());
        if (delay === null) continue;
        timers.set(characterId, deps.setTimer(() => {
          timers.delete(characterId);
          if (stopped || running.has(characterId) || !deps.enabled() || !deps.runnable()) return;
          const controller = new AbortController(); running.set(characterId, controller);
          void deps.run(characterId, controller.signal).then((more) => {
            if (more === "busy" && !stopped) {
              // Ownership contention is not a model retry. Re-read durable dispatch after lease release.
              timers.set(characterId, deps.setTimer(() => { void wake().catch(() => undefined); }, 5_000));
            } else if (more === true) dirty = true;
          }).catch(() => { /* No raw errors, cursor success or hidden resend. */ }).finally(() => {
            running.delete(characterId);
            if (dirty && !stopped) { dirty = false; void wake().catch(() => undefined); }
          });
        }, Math.min(delay, 2_147_483_647)));
      }
    } finally {
      reading = false;
      if (dirty && !stopped && !running.size) { dirty = false; void wake().catch(() => undefined); }
    }
  };
  return { wake, stop() { stopped = true; clear(); for (const controller of running.values()) controller.abort(); } };
}
