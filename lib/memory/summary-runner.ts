import type { ApiConfig } from "../api-config";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import { createCompletionRequestContext } from "../chat/request-diagnostics";
import type { TextProvider } from "../chat/provider";
import { planSummary, summaryPossiblyDue, type SummaryPlan } from "../chat/summary";
import { isTruncatedReason, type ChatMessage, type ChatSession, type ChatSummary } from "../chat/types";
import { MAINTENANCE_LIMITS } from "./maintenance-input";
import { MAINTENANCE_REQUEST_MS } from "./maintenance-runner";
import type { MemoryProgressProtocol } from "./progress";
import type { MemoryStorage } from "./storage";
import { buildSummaryInput, parseSummaryOutput } from "./summary-input";

export type SummaryOutcome = "none" | "failed" | "written" | "discarded";
export type SummaryRunnerDependencies = {
  protocol: MemoryProgressProtocol; memory: MemoryStorage;
  sessions(scope?: PersistenceWriteScope): Promise<ChatSession[]>;
  readChat(sessionId: string, scope: PersistenceWriteScope): Promise<{ session?: ChatSession; messages: ChatMessage[] }>;
  /** Same Memory model and Character context as Memory Maintenance; an unusable binding throws and nothing is sent. */
  model(characterId: string): Promise<{ config: ApiConfig; context: string; timezone?: string }>;
  commit(sessionId: string, expectedDigest: string | undefined, next: ChatSummary | null, scope: PersistenceWriteScope): Promise<boolean>;
  provider: TextProvider; enabled(): boolean; now(): number; requestTimeoutMs?: number;
  /** The page remembers what it already looked at so a wakeup never re-reads or re-sends the same thing. */
  settle?(session: ChatSession, outcome: SummaryOutcome): void;
};

/**
 * One summary request at most per call, under the Character owner lock shared with Memory Maintenance, so two tabs
 * never both pay for the same range. The write is compare-and-set against the stored summary and the covered text.
 * Returns true when a summary was written (more may be due), "busy" when another tab owns the Character.
 */
export async function runSummary(characterId: string, deps: SummaryRunnerDependencies, signal: AbortSignal): Promise<boolean | "busy"> {
  if (!deps.enabled() || signal.aborted) return false;
  const outcome = await deps.protocol.withOwner(characterId, async () => {
    const listed = (await deps.sessions()).filter((s) => s.characterId === characterId && s.type !== "group" && summaryPossiblyDue(s));
    for (const entry of listed) {
      const read = () => deps.memory.withExclusive((scope) => deps.readChat(entry.id, scope));
      let view = await read();
      if (!view.session) continue;
      let plan: SummaryPlan = planSummary(view.session, view.messages);
      if (plan.kind === "invalid") {
        // Something under the summary changed (restore, another writer): its text is no longer trustworthy.
        const stored = view.session.summary!;
        if (!await deps.memory.withExclusive((scope) => deps.commit(entry.id, stored.digest, null, scope))) return false;
        deps.settle?.(view.session, "discarded");
        view = await read();
        if (!view.session) continue;
        plan = planSummary(view.session, view.messages);
      }
      if (plan.kind !== "due") { deps.settle?.(view.session, "none"); continue; }
      const session = view.session;
      if (!deps.enabled() || signal.aborted) return false;
      // An invalid binding is rejected before any request, with no fallback.
      const { config, context, timezone } = await deps.model(characterId);
      const input = buildSummaryInput(plan, { context, timezone });
      const controller = new AbortController(), abort = () => controller.abort();
      const timeout = deps.requestTimeoutMs;
      const deadline = setTimeout(abort, Number.isSafeInteger(timeout) && timeout! > 0 && timeout! <= MAINTENANCE_REQUEST_MS ? timeout : MAINTENANCE_REQUEST_MS);
      signal.addEventListener("abort", abort, { once: true });
      let text = "", finishReason: string | undefined;
      try {
        controller.signal.throwIfAborted();
        for await (const chunk of deps.provider(config, input, controller.signal, { maxTokens: MAINTENANCE_LIMITS.maxOutputTokens, temperature: 0, thinking: "disabled" },
          createCompletionRequestContext("memory-summary", session.id), (reason) => { finishReason = reason; })) {
          text += chunk;
          if (text.length > MAINTENANCE_LIMITS.outputCharacters) { controller.abort(); throw new Error("Summary output exceeded guard."); }
        }
        controller.signal.throwIfAborted();
      } catch { deps.settle?.(session, "failed"); return false; }
      finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); }
      const summary = finishReason && isTruncatedReason(finishReason) ? null : parseSummaryOutput(text);
      if (!summary) { deps.settle?.(session, "failed"); return false; }
      const next: ChatSummary = { text: summary, throughOrder: plan.throughOrder, digest: plan.digest, updatedAt: deps.now() };
      const written = await deps.memory.withExclusive((scope) => deps.commit(session.id, plan.expectedDigest, next, scope));
      if (!written) return false; // The chat changed while the request ran; the next wakeup plans again from what is stored.
      return true;
    }
    return false;
  });
  return outcome ?? "busy";
}
