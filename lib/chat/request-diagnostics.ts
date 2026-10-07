import type { PromptTurn } from "./types";
import type { PromptDiagnosticSection } from "./prompt";

export type CompletionSource = "manual-reply" | "keyboard-auto-reply" | "regenerate" | "continue"
  | "test-connection" | "here-there-comment" | "unclassified";
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
  sections: readonly PromptDiagnosticSection[], messages: readonly PromptTurn[]) {
  return {
    requestId: context.requestId,
    source: context.source,
    ...(context.sessionId ? { sessionIdHash: sessionHash(context.sessionId) } : {}),
    model,
    sections: sections.map((section) => ({ ...section })),
    totalMessageCount: messages.length,
    totalCharacters: messages.reduce((total, message) => total + message.content.length, 0),
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
  try { console.info("[VEIL completion:start]", completionStartSummary(context, model, messages, stream)); }
  catch { /* Diagnostics must never affect generation. */ }
}

export function logPromptSummary(context: CompletionRequestContext, model: string,
  sections: readonly PromptDiagnosticSection[], messages: readonly PromptTurn[]) {
  if (process.env.NODE_ENV !== "development") return;
  try { console.info("[VEIL prompt:summary]", promptSummary(context, model, sections, messages)); }
  catch { /* Diagnostics must never affect generation. */ }
}

export function logCompletionUsage(context: CompletionRequestContext, usage: CompletionUsage | null) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    console.info("[VEIL completion:usage]", {
      requestId: context.requestId,
      source: context.source,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      prompt_cache_hit_tokens: usage?.prompt_cache_hit_tokens ?? null,
      prompt_cache_miss_tokens: usage?.prompt_cache_miss_tokens ?? null,
    });
  } catch { /* Diagnostics must never affect generation. */ }
}
