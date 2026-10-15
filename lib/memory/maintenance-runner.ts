import type { ApiConfig } from "../api-config";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import type { ChatMessage, ChatSession } from "../chat/types";
import { isTruncatedReason } from "../chat/types";
import type { TextProvider } from "../chat/provider";
import { historyTimestamp } from "../chat/time-context";
import { createCompletionRequestContext } from "../chat/request-diagnostics";
import { maintenanceDue, maintenanceSettled, MAINTENANCE_MAX_SAFE_CLAIMS, MAINTENANCE_TRIGGER_SEQUENCES } from "./maintenance-capacity";
import { MAINTENANCE_LIMITS, MaintenanceInputTooLarge, maintenanceCandidateText, planMaintenanceInput, selectMaintenanceCandidates, type MaintenancePlan, type MaintenanceStats } from "./maintenance-input";
import { MaintenanceParseError, parseMaintenanceOperations } from "./maintenance-operations";
import { createMaintenanceDiagnostics, responseShape, type MaintenanceCounts, type MaintenanceShape, type MaintenanceStage } from "./maintenance-diagnostics";
import type { MemoryBatchTicket, MemoryProgressProtocol } from "./progress";
import { validMemoryProgress, type MemoryProgress } from "./progress-types";
import type { MemoryStorage } from "./storage";

export const MAINTENANCE_BATCH_SEQUENCES = 20;
/** Message share of one request. The request guard (MAINTENANCE_LIMITS.inputCharacters) still decides what is too large. */
export const MAINTENANCE_MESSAGE_CHARACTERS = 10_000;
/** Consecutive too-large evaluations after which automatic attempts pause until the budget inputs change. */
export const MAINTENANCE_SIZE_ATTEMPTS = 2;
const hash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); };
const MAX_SAFE_CLAIMS = MAINTENANCE_MAX_SAFE_CLAIMS;
export const MAINTENANCE_REQUEST_MS = 90_000;
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
  /** `budget` is a digest of everything that decides how much fits (Character text, Backstory, profile); never the text itself. */
  model(characterId: string, scope?: PersistenceWriteScope): Promise<{ config: ApiConfig; context: string; timezone?: string; budget?: string }>;
  provider: TextProvider; enabled(): boolean; now(): number;
  diagnostics?: ReturnType<typeof createMaintenanceDiagnostics>;
  requestTimeoutMs?: number;
  /** Test seam only: production always uses MAINTENANCE_TRIGGER_SEQUENCES. */
  triggerSequences?: number;
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
    if (!maintenanceDue(await deps.sessions(), await deps.memory.listCursors(characterId), characterId, deps.triggerSequences ?? MAINTENANCE_TRIGGER_SEQUENCES)
      || !deps.enabled() || signal.aborted) return false;
    // Invalid binding is rejected before making a new batch, with no fallback and no paid call.
    const { config, context, timezone, budget } = await deps.model(characterId);
    const character = { characterId, context, timezone };
    // Everything that decides how much fits: when it changes, a paused too-large range is evaluated again.
    const budgetKey = `${MAINTENANCE_LIMITS.inputCharacters}:${hash(`${config.model}\0${budget ?? ""}\0${context}`)}`;
    let ticket: MemoryBatchTicket | undefined;
    const sizeFits = async (candidate: MemoryBatchTicket): Promise<boolean> => {
      try { planMaintenanceInput(await deps.protocol.readInput(candidate), character, undefined, deps.now()); return true; }
      catch (error) {
        if (!(error instanceof MaintenanceInputTooLarge)) throw error;
        await markTooLarge(candidate); return false;
      }
    };
    const markTooLarge = async (target: MemoryBatchTicket): Promise<number> => {
      const previous = await deps.protocol.describe(target);
      const attempts = (previous.budgetKey === budgetKey ? previous.sizeAttempts ?? 0 : 0) + 1;
      await deps.protocol.refresh(target, undefined, true, { attempts, budgetKey });
      return attempts;
    };
    for (const saved of recovered) {
      const batch = await deps.protocol.describe(saved.ticket);
      if (batch.state === "ready" && batch.attempts < MAX_SAFE_CLAIMS) {
        ticket = await deps.protocol.refresh(saved.ticket, []); break;
      }
      // A range whose request is known to have failed is retried once, as the same range with the same sources (refresh re-reads
      // exactly its own messages). The persisted attempt count caps it at MAX_SAFE_CLAIMS requests; uncertain ranges are never retried.
      if (batch.state === "failed" && batch.attempts < MAX_SAFE_CLAIMS) {
        ticket = await deps.protocol.refresh(saved.ticket, []); break;
      }
      // A too-large range is looked at again on a normal trigger, a limited number of times per budget; never counted as done.
      if (batch.state === "too-large" && !((batch.sizeAttempts ?? 0) >= MAINTENANCE_SIZE_ATTEMPTS && batch.budgetKey === budgetKey)) {
        const candidate = await deps.protocol.refresh(saved.ticket, [], false);
        if (await sizeFits(candidate)) { ticket = candidate; break; }
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
            // Measured as the request will carry it: id, role, turn, time and content.
            const size = JSON.stringify({ id: message.id, role: message.role, turnId: message.turnId, time: historyTimestamp(message.createdAt, timezone || "UTC"),
              content: message.content, explicitRequest: true }).length;
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
    // One reading of the clock for this maintenance request: what is due, and the review times it may set.
    const clock = deps.now();
    const started = performance.now(); let inputCharacters = 0, sizeAttempts = 0; const stats: Partial<MaintenanceStats> = {};
    const seqs = snapshot.messages.flatMap((m) => m.memorySequence?.seq !== undefined ? [m.memorySequence.seq] : []);
    const attempt = (await deps.protocol.describe(ticket)).attempts + 1;
    const record = (outcome: "committed" | "rejected" | "commit-failed", stage: MaintenanceStage,
      parsed?: { operationCount: number; discarded: number; counts: MaintenanceCounts }, shape?: MaintenanceShape) => deps.diagnostics?.record({
      outcome, stage, attempt, ...(shape ? { shape } : {}), at: clock, messageCount: snapshot.messages.length, candidateCount: snapshot.candidates.length, inputCharacters,
      operationCount: parsed?.operationCount ?? 0, discarded: parsed?.discarded ?? 0, durationMs: performance.now() - started, sizeAttempts, ...stats,
      ...(seqs.length ? { fromSeq: Math.min(...seqs), toSeq: Math.max(...seqs) } : {}), ...(parsed ? { counts: parsed.counts } : {}) });
    let plan: MaintenancePlan | undefined;
    // Only the synchronous planner defines unacceptable input. Storage reads and refreshes stay outside the guard, so an
    // infrastructure failure leaves the ready range retryable, without spending a claim.
    const guard = async (build: () => MaintenancePlan | undefined): Promise<boolean> => {
      try { plan = build(); return true; }
      catch (error) {
        if (error instanceof MaintenanceInputTooLarge) sizeAttempts = await markTooLarge(ticket!);
        else if (deps.enabled() && !signal.aborted) {
          // A known preflight rejection is a retained failure hole, not an endlessly preferred ready head.
          // Existing claim/failed transitions reserve no model call and never advance the cursor.
          try { await deps.protocol.claim(ticket!, MAX_SAFE_CLAIMS); await deps.protocol.transition(ticket!, "failed"); }
          catch { /* Changed/deleted authority stays protected; never recreate the cursor. */ }
        }
        record("rejected", error instanceof MaintenanceInputTooLarge ? "too-large" : "preflight"); return false;
      }
    };
    let room = 0;
    if (!await guard(() => { room = planMaintenanceInput(snapshot, character, undefined, clock).candidateRoom; return undefined; })) return false;
    const selected = selectMaintenanceCandidates(characterId, await deps.memory.listMemories(characterId), maintenanceCandidateText(snapshot.messages), room, clock);
    ticket = await deps.protocol.refresh(ticket, selected.ids);
    snapshot = await deps.protocol.readInput(ticket);
    if (!await guard(() => planMaintenanceInput(snapshot, character, undefined, clock)) || !plan) return false;
    Object.assign(stats, plan.stats);
    if (!plan.messages.length) {
      // Every message held a secret: nothing to extract, so no request. The range stays a retained hole, as before.
      try { await deps.protocol.claim(ticket, MAX_SAFE_CLAIMS); await deps.protocol.transition(ticket, "failed"); }
      catch { /* Changed authority is never recreated or declared successful. */ }
      record("rejected", "all-redacted"); return false;
    }
    const input = plan.input;
    // The model may only cite messages it was actually shown.
    const visible = { ...snapshot, messages: plan.messages };
    inputCharacters = input.reduce((n, turn) => n + turn.content.length, 0);
    if (!deps.enabled() || signal.aborted) return false;
    await deps.protocol.claim(ticket, MAX_SAFE_CLAIMS);
    // This check and persisted in-flight transition share the exclusive backup lease.
    await deps.protocol.transition(ticket, "in-flight", async (scope) => {
      if (!deps.enabled() || signal.aborted || !maintenanceSettled(await deps.sessions(scope), characterId)) return false;
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
      record("rejected", "provider-error"); return false;
    } finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); }
    let operations;
    try {
      if (finishReason && isTruncatedReason(finishReason)) throw new Error("Incomplete maintenance output.");
      operations = parseMaintenanceOperations(text, visible, undefined, clock);
    } catch (error) {
      await deps.protocol.transition(ticket, "failed").catch(() => undefined);
      const truncated = !!finishReason && isTruncatedReason(finishReason);
      record("rejected", error instanceof MaintenanceParseError ? error.stage : truncated ? "truncated" : "format", undefined,
        responseShape(text, truncated ? "length" : finishReason === "stop" ? "stop" : finishReason ? "other" : "none")); return false;
    }
    await deps.protocol.transition(ticket, "commit-pending");
    try {
      await deps.protocol.commitAutomatic(ticket, { put: operations.put, stateOperations: operations.stateOperations }, signal);
      record("committed", "ok", operations); return true;
    } catch {
      // Keep result-unknown state for recovery, never invoke a repair model or resend.
      await deps.protocol.transition(ticket, "uncertain").catch(() => undefined);
      record("commit-failed", "commit-failed", operations); return false;
    }
  });
  return outcome ?? "busy";
}
