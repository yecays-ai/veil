import type { ChatSession } from "../chat/types";
import type { MemoryCursor } from "./types";

/**
 * Maintenance is capacity-triggered, not timed: it becomes due once one full batch of numbered messages is waiting.
 * The value is the existing batch size (`MAINTENANCE_BATCH_SEQUENCES`), so a trigger never starts a smaller batch than
 * the runner would otherwise build. Fewer messages simply wait; there is no idle timer and no low-frequency top-up.
 */
export const MAINTENANCE_TRIGGER_SEQUENCES = 20;
/** Two pre-dispatch claims allow one safe interrupted claim to recover. Failed/unknown requests never retry. */
export const MAINTENANCE_MAX_SAFE_CLAIMS = 2;

/** A reply generating (or unreadable session time) blocks any new maintenance request. */
export function maintenanceSettled(sessions: readonly ChatSession[], characterId: string): boolean {
  const own = sessions.filter((s) => s.characterId === characterId && s.type !== "group");
  return own.length > 0 && own.every((s) => !s.generation && Number.isFinite(s.updatedAt));
}

export type MaintenanceBacklog = {
  /** Numbered messages no batch has been made for yet. */
  fresh: number;
  /** Batches interrupted before dispatch that recovery may still re-offer. Failed/uncertain/too-large ranges stay holes. */
  waiting: number;
};

/** Mirrors the runner's per-session rules: a pending clear or a stale epoch contributes nothing. */
export function maintenanceBacklog(sessions: readonly ChatSession[], cursors: readonly MemoryCursor[], characterId: string): MaintenanceBacklog {
  const backlog: MaintenanceBacklog = { fresh: 0, waiting: 0 };
  for (const session of sessions) {
    if (session.characterId !== characterId || session.type === "group" || !session.memorySequence) continue;
    const cursor = cursors.find((row) => row.characterId === characterId && row.sessionId === session.id);
    if (cursor?.clearRequestedAt !== undefined) continue;
    const progress = cursor?.extraction;
    if (progress && progress.epoch !== session.memorySequence.epoch) continue;
    let covered = progress?.throughSeq ?? 0;
    for (const [from, to] of progress?.completed ?? []) covered += to - from + 1;
    for (const batch of progress?.batches ?? []) {
      covered += batch.toSeq - batch.fromSeq + 1;
      if (batch.state === "ready" && batch.attempts < MAINTENANCE_MAX_SAFE_CLAIMS) backlog.waiting++;
    }
    backlog.fresh += Math.max(0, session.memorySequence.nextSeq - 1 - covered);
  }
  return backlog;
}

export function maintenanceDue(sessions: readonly ChatSession[], cursors: readonly MemoryCursor[], characterId: string,
  trigger = MAINTENANCE_TRIGGER_SEQUENCES): boolean {
  if (!maintenanceSettled(sessions, characterId)) return false;
  const backlog = maintenanceBacklog(sessions, cursors, characterId);
  return backlog.waiting > 0 || backlog.fresh >= trigger;
}
