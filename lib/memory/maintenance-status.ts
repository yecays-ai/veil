import { summaryPossiblyDue } from "../chat/summary";
import type { ApiConfig, NamedApiConfig } from "../api-config";
import type { BindingDocument } from "../bindings";
import type { ChatSession } from "../chat/types";
import { MaintenanceModelError, resolveMaintenanceModel } from "./maintenance-binding";
import { maintenanceBacklog, maintenanceSettled, MAINTENANCE_TRIGGER_SEQUENCES } from "./maintenance-capacity";
import type { MemoryCursor } from "./types";

/** Read-only facts for Settings → Memory Maintenance. Never includes keys, URLs or message text. */
export type MaintenanceModelStatus = { state: "ready"; label: string }
  | { state: "disabled" | "missing" | "invalid" | "unreadable"; reason: string };

export async function maintenanceModelStatus(bindings: BindingDocument, characterId: string,
  read: (id: string) => Promise<NamedApiConfig | ApiConfig | null | undefined>): Promise<MaintenanceModelStatus> {
  try {
    const config = await resolveMaintenanceModel(bindings, characterId, read);
    return { state: "ready", label: config.name?.trim() ? `${config.name.trim()} · ${config.model}` : config.model };
  } catch (reason) {
    if (reason instanceof MaintenanceModelError) return { state: reason.code, reason: reason.message };
    return { state: "unreadable", reason: "Model settings could not be read." };
  }
}

export type MaintenanceProgressSummary = {
  /** New messages numbered for Memory since this device enabled maintenance (direct chats only). */
  tracked: number;
  /** Numbered messages whose batch completed (including a legal IGNORE). */
  processed: number;
  waiting: number; running: number; failed: number; uncertain: number; tooLarge: number;
  /** Numbered messages not yet batched (direct chats only). */
  pending: number;
  /** Messages that must be waiting before a check starts on its own. */
  trigger: number;
  /** True when a check may start now: enough messages (or a recoverable batch) are waiting and no reply is generating. */
  due: boolean;
};

export function summarizeMaintenanceProgress(characterId: string, sessions: readonly ChatSession[],
  cursors: readonly MemoryCursor[]): MaintenanceProgressSummary {
  const direct = sessions.filter((s) => s.characterId === characterId && s.type !== "group");
  const tracked = direct.reduce((total, s) => total + Math.max(0, (s.memorySequence?.nextSeq ?? 1) - 1), 0);
  const summary: MaintenanceProgressSummary = { tracked, processed: 0, waiting: 0, running: 0, failed: 0, uncertain: 0, tooLarge: 0, pending: 0, trigger: MAINTENANCE_TRIGGER_SEQUENCES, due: false };
  for (const cursor of cursors) {
    const progress = cursor.extraction;
    if (cursor.characterId !== characterId || !progress) continue;
    const done = progress.throughSeq + progress.completed.reduce((total, [from, to]) => total + to - from + 1, 0);
    summary.processed += done;
    for (const batch of progress.batches) {
      if (batch.state === "ready") summary.waiting++;
      else if (batch.state === "failed") summary.failed++;
      else if (batch.state === "uncertain") summary.uncertain++;
      else if (batch.state === "too-large") summary.tooLarge++;
      else summary.running++;
    }
  }
  const backlog = maintenanceBacklog(direct, cursors, characterId);
  summary.pending = backlog.fresh;
  summary.due = maintenanceSettled(direct, characterId) && (backlog.waiting > 0 || backlog.fresh >= summary.trigger);
  return summary;
}

export type RollingSummaryStatus = { chats: number; updatedAt: number | null; due: boolean };

/**
 * Technical state of the rolling chat summary for one Character, read from the sessions already loaded for this page.
 * An invalid summary is deleted when it is found, so there is no "was invalid" state to show; only what exists and
 * whether another summary is waiting to be written.
 */
export function summarizeRollingSummary(characterId: string, sessions: readonly ChatSession[]): RollingSummaryStatus {
  const direct = sessions.filter((s) => s.characterId === characterId && s.type !== "group");
  const written = direct.flatMap((s) => s.summary ? [s.summary.updatedAt] : []);
  return { chats: written.length, updatedAt: written.length ? Math.max(...written) : null, due: direct.some(summaryPossiblyDue) };
}
