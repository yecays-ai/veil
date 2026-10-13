import { isTruncatedReason, type PromptTurn } from "./types";
import type { PromptDiagnosticSection } from "./prompt";
import { appendUsageBaseline, buildUsageBaselineRecord, type UsageBaselineMeta } from "./usage-baseline";
import type { MemoryContext } from "../memory/context";
import { recordContextInspector } from "./context-inspector";

type MemorySummary = Pick<MemoryContext, "ids" | "characterLength" | "outcome">;

export type CompletionSource = "manual-reply" | "keyboard-auto-reply" | "regenerate" | "continue"
  | "test-connection" | "here-there-comment" | "presence-routine" | "memory-maintenance" | "memory-summary" | "unclassified";
export type CompletionRequestContext = { requestId: string; source: CompletionSource; sessionId?: string };
export type CompletionUsage = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  prompt_cache_hit_tokens: number | null;
  prompt_cache_miss_tokens: number | null;
};

export function createCompletionRequestContext(source: CompletionSource, sessionId?: string): CompletionRequestContext {
  const requestId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return { requestId, source, ...(sessionId ? { sessionId } : {}) };
}

function sessionHash(sessionId?: string) {
  if (!sessionId) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < sessionId.length; index++) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function completionStartSummary(context: CompletionRequestContext, model: string,
  messages: readonly PromptTurn[], stream: boolean, timestamp = new Date().toISOString()) {
  const roles: Record<string, number> = {};
  let totalCharacters = 0;
  for (const message of messages) {
    roles[message.role] = (roles[message.role] ?? 0) + 1;
    totalCharacters += message.content.length;
  }
  return {
    timestamp,
    requestId: context.requestId,
    source: context.source,
    ...(context.sessionId ? { sessionIdHash: sessionHash(context.sessionId) } : {}),
    model,
    messageCount: messages.length,
    roleCounts: roles,
    totalCharacters,
    estimatedInputTokens: Math.ceil(totalCharacters / 4),
    stream,
  };
}

export function promptSummary(context: CompletionRequestContext, model: string,
  sections: readonly PromptDiagnosticSection[], messages: readonly PromptTurn[], memory?: MemorySummary) {
  return {
    requestId: context.requestId,
    source: context.source,
    ...(context.sessionId ? { sessionIdHash: sessionHash(context.sessionId) } : {}),
    model,
    sections: sections.map((section) => ({ ...section })),
    totalMessageCount: messages.length,
    totalCharacters: messages.reduce((total, message) => total + message.content.length, 0),
    ...(memory ? { memory: { ids: [...memory.ids], characterLength: memory.characterLength, outcome: memory.outcome } } : {}),
  };
}

export function parseCompletionUsage(value: unknown): CompletionUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const data = usage as Record<string, unknown>;
  const details = data.prompt_tokens_details && typeof data.prompt_tokens_details === "object"
    ? data.prompt_tokens_details as Record<string, unknown> : {};
  const numberOrNull = (item: unknown) => typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : null;
  return {
    prompt_tokens: numberOrNull(data.prompt_tokens),
    completion_tokens: numberOrNull(data.completion_tokens),
    total_tokens: numberOrNull(data.total_tokens),
    prompt_cache_hit_tokens: numberOrNull(data.prompt_cache_hit_tokens)
      ?? numberOrNull(details.cached_tokens),
    prompt_cache_miss_tokens: numberOrNull(data.prompt_cache_miss_tokens),
  };
}

export function logCompletionStart(context: CompletionRequestContext, model: string,
  messages: readonly PromptTurn[], stream: boolean) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const summary = completionStartSummary(context, model, messages, stream);
    console.info("[VEIL completion:start]", summary);
    recordContextInspector("start", summary);
  } catch { /* Diagnostics must never affect generation. */ }
}

export function logPromptSummary(context: CompletionRequestContext, model: string,
  sections: readonly PromptDiagnosticSection[], messages: readonly PromptTurn[], memory?: MemorySummary) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const summary = promptSummary(context, model, sections, messages, memory);
    console.info("[VEIL prompt:summary]", summary);
    recordContextInspector("prompt", summary);
  } catch { /* Diagnostics must never affect generation. */ }
}

export function logCompletionUsage(context: CompletionRequestContext, usage: CompletionUsage | null) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const summary = {
      requestId: context.requestId,
      source: context.source,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      prompt_cache_hit_tokens: usage?.prompt_cache_hit_tokens ?? null,
      prompt_cache_miss_tokens: usage?.prompt_cache_miss_tokens ?? null,
    };
    console.info("[VEIL completion:usage]", summary);
    recordContextInspector("usage", summary);
  } catch { /* Diagnostics must never affect generation. */ }
}

/**
 * How one model call ended. `cancelled` means the caller's signal was aborted; the reason is deliberately not
 * guessed (Stop, leaving the page and losing ownership all abort). `abandoned` means the caller stopped reading.
 */
export type CompletionOutcome = "completed" | "truncated" | "error" | "timeout" | "cancelled" | "abandoned";
export type CompletionErrorCategory = "network" | "http" | "invalid-reply" | "invalid-stream" | "no-stream"
  | "stream-ended" | "stream-error" | "no-completion";
export type CompletionTerminal = {
  outcome: CompletionOutcome;
  finishReason?: string;
  errorCategory?: CompletionErrorCategory;
  httpStatus?: number;
  timeoutPhase?: "connect" | "idle";
};

const KNOWN_FINISH_REASONS = ["stop", "length", "max_tokens", "max_output_tokens", "content_filter", "tool_calls",
  "function_call", "end_turn", "eos"];
/** Provider text is never logged as-is: anything outside the usual finish reasons becomes "other". */
function controlledFinishReason(reason?: string) {
  return reason === undefined ? undefined : KNOWN_FINISH_REASONS.includes(reason) ? reason : "other";
}

export function completionTerminalOutcome(finishReason?: string): "completed" | "truncated" {
  return isTruncatedReason(finishReason) ? "truncated" : "completed";
}

export function completionTerminalSummary(context: CompletionRequestContext, terminal: CompletionTerminal,
  durationMs: number) {
  const finishReason = controlledFinishReason(terminal.finishReason);
  return {
    requestId: context.requestId,
    source: context.source,
    outcome: terminal.outcome,
    ...(finishReason ? { finishReason } : {}),
    ...(terminal.errorCategory ? { errorCategory: terminal.errorCategory } : {}),
    ...(terminal.httpStatus !== undefined ? { httpStatus: terminal.httpStatus } : {}),
    ...(terminal.timeoutPhase ? { timeoutPhase: terminal.timeoutPhase } : {}),
    durationMs,
  };
}

/**
 * Starts the clock for one model call. The returned function records the first outcome and ignores any later one.
 * With `meta` it also appends exactly one content-free usage record (usage-baseline.ts) in every environment.
 */
export function startCompletionTerminal(context: CompletionRequestContext, meta?: UsageBaselineMeta):
  (terminal: CompletionTerminal, usage?: CompletionUsage | null) => void {
  const started = Date.now();
  let recorded = false;
  return (terminal, usage = null) => {
    if (recorded) return;
    recorded = true;
    if (meta) {
      try { appendUsageBaseline(buildUsageBaselineRecord(meta, context.source, terminal.outcome, Date.now() - started, usage)); }
      catch { /* Diagnostics must never affect generation. */ }
    }
    if (process.env.NODE_ENV !== "development") return;
    try {
      const summary = completionTerminalSummary(context, terminal, Date.now() - started);
      console.info("[VEIL completion:terminal]", summary);
      recordContextInspector("terminal", summary);
    } catch { /* Diagnostics must never affect generation. */ }
  };
}
