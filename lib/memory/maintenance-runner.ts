import type { ApiConfig } from "../api-config";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import type { ChatMessage, ChatSession } from "../chat/types";
import { isTruncatedReason } from "../chat/types";
import type { TextProvider } from "../chat/provider";
import { createCompletionRequestContext } from "../chat/request-diagnostics";
import { buildMaintenanceInput, MAINTENANCE_LIMITS, MaintenanceInputTooLarge, selectMaintenanceCandidates } from "./maintenance-input";
import { parseMaintenanceOperations } from "./maintenance-operations";
import { createMaintenanceDiagnostics } from "./maintenance-diagnostics";
import type { MemoryBatchTicket, MemoryProgressProtocol } from "./progress";
import { validMemoryProgress, type MemoryProgress } from "./progress-types";
import type { MemoryStorage } from "./storage";

export const MAINTENANCE_IDLE_MS = 5 * 60 * 1000;
export const MAINTENANCE_BATCH_SEQUENCES = 20;
export const MAINTENANCE_MESSAGE_CHARACTERS = 12_000;
// Two pre-dispatch claims allow one safe interrupted claim to recover. Failed/unknown requests never retry.
const MAX_SAFE_CLAIMS = 2;
export const MAINTENANCE_REQUEST_MS = 90_000;
export function maintenanceDue(sessions: readonly ChatSession[], characterId: string, now: number): number | null {
  const own = sessions.filter((s) => s.characterId === characterId && s.type !== "group");
  if (!own.length || own.some((s) => s.generation || !Number.isFinite(s.updatedAt))) return null;
  const activity = Math.max(...own.map((s) => s.updatedAt));
  return Math.max(0, activity + MAINTENANCE_IDLE_MS - now);
}
/** Failed/uncertain/too-large ranges remain holes. Later successes never advance across them. */
export function nextMaintenanceRange(nextSeq: number, progress?: MemoryProgress): [number, number] | null {
  if (!Number.isSafeInteger(nextSeq) || nextSeq < 1 || (progress && !validMemoryProgress(progress))) return null;
  let start = (progress?.throughSeq ?? 0) + 1;
  const covered = [...(progress?.completed ?? []), ...(progress?.batches.map((b): [number, number] => [b.fromSeq, b.toSeq]) ?? [])]
    .sort(([a], [b]) => a - b);
  for (const [from, to] of covered) {
    if (to < start) continue;
    if (from > start) return [start, Math.min(from - 1, start + MAINTENANCE_BATCH_SEQUENCES - 1, nextSeq - 1)];
    start = to + 1;
  }
  return start < nextSeq ? [start, Math.min(nextSeq - 1, start + MAINTENANCE_BATCH_SEQUENCES - 1)] : null;
}
export type MaintenanceRunnerDependencies = {
  protocol: MemoryProgressProtocol; memory: MemoryStorage;
  sessions(scope?: PersistenceWriteScope): Promise<ChatSession[]>;
  readChat(sessionId: string, scope: PersistenceWriteScope): Promise<{ session?: ChatSession; messages: ChatMessage[] }>;
  model(characterId: string, scope?: PersistenceWriteScope): Promise<{ config: ApiConfig; context: string }>;
  provider: TextProvider; enabled(): boolean; now(): number;
  diagnostics?: ReturnType<typeof createMaintenanceDiagnostics>;
  requestTimeoutMs?: number;
};
/** One bounded batch per invocation. Character owner spans network; backup lease never does. */
export async function runMaintenance(characterId: string, deps: MaintenanceRunnerDependencies, signal: AbortSignal): Promise<boolean | "busy"> {
  if (!deps.enabled() || signal.aborted) return false;
  const outcome = await deps.protocol.withOwner(characterId, async (owner) => {
    const sessions = await deps.sessions();
    // Recovery does not dispatch and can repair abandoned ownership even during new chat.
    const recovered: { ticket: MemoryBatchTicket; sessionId: string }[] = [];
    for (const session of sessions.filter((s) => s.characterId === characterId && s.type !== "group" && s.memorySequence))
      for (const ticket of await deps.protocol.recover(owner, session.id)) recovered.push({ ticket, sessionId: session.id });
    if (maintenanceDue(await deps.sessions(), characterId, deps.now()) !== 0 || !deps.enabled() || signal.aborted) return false;
    // Invalid binding is rejected before making a new batch, with no fallback and no paid call.
    const { config, context } = await deps.model(characterId);
    let ticket: MemoryBatchTicket | undefined;
    for (const saved of recovered) {
      const batch = await deps.protocol.describe(saved.ticket);
      if (batch.state === "ready" && batch.attempts < MAX_SAFE_CLAIMS) {
        ticket = await deps.protocol.refresh(saved.ticket, []); break;
      }
    }
    if (!ticket) {
      const cursors = await deps.memory.listCursors(characterId);
      for (const session of sessions.filter((s) => s.characterId === characterId && s.type !== "group" && s.memorySequence).sort((a, b) => a.id.localeCompare(b.id))) {
        const cursor = cursors.find((r) => r.sessionId === session.id);
        if (cursor?.clearRequestedAt !== undefined || (cursor?.extraction && cursor.extraction.epoch !== session.memorySequence!.epoch)) continue;
        const range = nextMaintenanceRange(session.memorySequence!.nextSeq, cursor?.extraction);
        if (range) {
          // Leave whole messages intact; reduce a new batch before it becomes a fixed durable snapshot.
          const view = await deps.memory.withExclusive((scope) => deps.readChat(session.id, scope));
          const messages = view.messages.filter((m) => m.memorySequence?.epoch === session.memorySequence!.epoch
            && m.memorySequence.seq !== undefined && m.memorySequence.seq >= range[0] && m.memorySequence.seq <= range[1])
            .sort((a, b) => a.memorySequence!.seq! - b.memorySequence!.seq!);
          let used = 0;
          for (const message of messages) {
            const size = JSON.stringify({ id: message.id, role: message.role, turnId: message.turnId, content: message.content }).length;
            if (used > 0 && used + size > MAINTENANCE_MESSAGE_CHARACTERS) { range[1] = message.memorySequence!.seq! - 1; break; }
            used += size; // An oversized single message is checked whole by the complete-input guard.
          }
          ticket = await deps.protocol.prepare(owner, session.id, ...range); break;
        }
      }
    }
    if (!ticket) return false;
    let snapshot = await deps.protocol.readInput(ticket);
    if (!snapshot.messages.length) {
      if ((await deps.protocol.describe(ticket)).attempts === 0) { await deps.protocol.completeEmpty(ticket); return true; }
      // completeEmpty intentionally forbids previously claimed work. Preserve that hole without starving new ranges.
      try { await deps.protocol.claim(ticket, MAX_SAFE_CLAIMS); await deps.protocol.transition(ticket, "failed"); }
      catch { /* A changed authority is never recreated or declared successful. */ }
      return false;
    }
    const started = performance.now(); let inputCharacters = 0;
    const record = (outcome: "committed" | "rejected" | "commit-failed", operationCount = 0, discarded = 0) => deps.diagnostics?.record({
      outcome, messageCount: snapshot.messages.length, candidateCount: snapshot.candidates.length, inputCharacters,
      operationCount, discarded, durationMs: performance.now() - started });
    let input;
    try {
      const selected = selectMaintenanceCandidates(characterId, await deps.memory.listMemories(characterId), snapshot.messages.map((m) => m.content).join("\n"));
      ticket = await deps.protocol.refresh(ticket, selected.ids);
      snapshot = await deps.protocol.readInput(ticket);
      input = buildMaintenanceInput(snapshot, { characterId, context });
    }
    catch (error) {
      if (error instanceof MaintenanceInputTooLarge) await deps.protocol.refresh(ticket, undefined, true);
      else if (deps.enabled() && !signal.aborted) {
        // A known preflight rejection is a retained failure hole, not an endlessly preferred ready head.
        // Existing claim/failed transitions reserve no model call and never advance the cursor.
        try { await deps.protocol.claim(ticket, MAX_SAFE_CLAIMS); await deps.protocol.transition(ticket, "failed"); }
        catch { /* Changed/deleted authority stays protected; never recreate the cursor. */ }
      }
      record("rejected"); return false;
    }
    inputCharacters = input.reduce((n, turn) => n + turn.content.length, 0);
    if (!deps.enabled() || signal.aborted) return false;
    await deps.protocol.claim(ticket, MAX_SAFE_CLAIMS);
    // This check and persisted in-flight transition share the exclusive backup lease.
    await deps.protocol.transition(ticket, "in-flight", async (scope) => {
      if (!deps.enabled() || signal.aborted || maintenanceDue(await deps.sessions(scope), characterId, deps.now()) !== 0) return false;
      const current = (await deps.model(characterId, scope)).config;
      return current.id === config.id && current.model === config.model && current.baseUrl === config.baseUrl && current.apiKey === config.apiKey;
    });
    const controller = new AbortController(), abort = () => controller.abort();
    const timeout = deps.requestTimeoutMs ?? MAINTENANCE_REQUEST_MS;
    const deadline = setTimeout(abort, Number.isSafeInteger(timeout) && timeout > 0 && timeout <= MAINTENANCE_REQUEST_MS ? timeout : MAINTENANCE_REQUEST_MS);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let text = "", finishReason: string | undefined;
    try {
      controller.signal.throwIfAborted();
      for await (const chunk of deps.provider(config, input, controller.signal,
        { maxTokens: MAINTENANCE_LIMITS.maxOutputTokens, temperature: 0, thinking: "disabled" },
        createCompletionRequestContext("memory-maintenance", snapshot.sessionId), (reason) => { finishReason = reason; })) {
        text += chunk;
        if (text.length > MAINTENANCE_LIMITS.outputCharacters) { controller.abort(); throw new Error("Maintenance output exceeded guard."); }
      }
      controller.signal.throwIfAborted();
    } catch {
      // A dispatched request may have been received even if fetch failed or the page closed.
      await deps.protocol.transition(ticket, "uncertain").catch(() => undefined);
      record("rejected"); return false;
    } finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); }
    let plan;
    try {
      if (finishReason && isTruncatedReason(finishReason)) throw new Error("Incomplete maintenance output.");
      plan = parseMaintenanceOperations(text, snapshot);
    } catch {
      await deps.protocol.transition(ticket, "failed").catch(() => undefined);
      record("rejected"); return false;
    }
    await deps.protocol.transition(ticket, "commit-pending");
    try {
      await deps.protocol.commitAutomatic(ticket, { put: plan.put }, signal);
      record("committed", plan.operationCount, plan.discarded); return true;
    } catch {
      // Keep result-unknown state for recovery, never invoke a repair model or resend.
      await deps.protocol.transition(ticket, "uncertain").catch(() => undefined);
      record("commit-failed", plan.operationCount, plan.discarded); return false;
    }
  });
  return outcome ?? "busy";
}
