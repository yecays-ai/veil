import type { ApiConfig, NamedApiConfig } from "../api-config";
import type { BindingDocument } from "../bindings";
import type { ChatSession } from "../chat/types";
import { MaintenanceModelError, resolveMaintenanceModel } from "./maintenance-binding";
import { maintenanceDue } from "./maintenance-runner";
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
  /** Earliest moment the next check may run; null when nothing is pending or a reply is generating. */
  dueAt: number | null;
};

export function summarizeMaintenanceProgress(characterId: string, sessions: readonly ChatSession[],
  cursors: readonly MemoryCursor[], now: number): MaintenanceProgressSummary {
  const direct = sessions.filter((s) => s.characterId === characterId && s.type !== "group");
  const tracked = direct.reduce((total, s) => total + Math.max(0, (s.memorySequence?.nextSeq ?? 1) - 1), 0);
  const summary: MaintenanceProgressSummary = { tracked, processed: 0, waiting: 0, running: 0, failed: 0, uncertain: 0, tooLarge: 0, dueAt: null };
  let covered = 0;
  for (const cursor of cursors) {
    const progress = cursor.extraction;
    if (cursor.characterId !== characterId || !progress) continue;
    const done = progress.throughSeq + progress.completed.reduce((total, [from, to]) => total + to - from + 1, 0);
    summary.processed += done; covered += done;
    for (const batch of progress.batches) {
      covered += batch.toSeq - batch.fromSeq + 1;
      if (batch.state === "ready") summary.waiting++;
      else if (batch.state === "failed") summary.failed++;
      else if (batch.state === "uncertain") summary.uncertain++;
      else if (batch.state === "too-large") summary.tooLarge++;
      else summary.running++;
    }
  }
  if (tracked > covered || summary.waiting) {
    const delay = maintenanceDue(direct, characterId, now);
    summary.dueAt = delay === null ? null : now + delay;
  }
  return summary;
}
