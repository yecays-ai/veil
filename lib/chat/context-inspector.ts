/**
 * M6 P5 development-only Context Inspector store.
 *
 * It keeps the redacted summaries that request-diagnostics.ts already logs for real model calls, grouped by request,
 * in memory only. Fields are copied through allowlists so prompt text, keywords and keys never enter it, it never
 * persists, never sends anything and never touches prompts or provider calls. Production builds do not record.
 */

export type InspectorSection = { identifier: string; role: string; characterLength: number };
export type InspectorRecord = {
  requestId: string;
  source: string;
  sessionIdHash?: string;
  model?: string;
  timestamp?: string;
  start?: { messageCount: number; roleCounts: Record<string, number>; totalCharacters: number;
    estimatedInputTokens: number; stream: boolean };
  prompt?: { sections: InspectorSection[]; totalMessageCount: number; totalCharacters: number;
    memory?: { ids: string[]; characterLength: number; outcome: string } };
  usage?: Record<"prompt_tokens" | "completion_tokens" | "total_tokens" | "prompt_cache_hit_tokens"
    | "prompt_cache_miss_tokens", number | null>;
  terminal?: { outcome: string; finishReason?: string; errorCategory?: string; httpStatus?: number;
    timeoutPhase?: string; durationMs: number };
};
export type InspectorKind = "start" | "prompt" | "usage" | "terminal";

export const CONTEXT_INSPECTOR_LIMIT = 20;
const USAGE_KEYS = ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
  "prompt_cache_miss_tokens"] as const;

export function contextInspectorEnabled() {
  return process.env.NODE_ENV === "development";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const nullableCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

function pick(kind: InspectorKind, data: Record<string, unknown>): Partial<InspectorRecord> {
  if (kind === "start") {
    const roles: Record<string, number> = {};
    if (isRecord(data.roleCounts)) for (const [role, value] of Object.entries(data.roleCounts)) roles[role] = count(value);
    return { start: { messageCount: count(data.messageCount), roleCounts: roles, totalCharacters: count(data.totalCharacters),
      estimatedInputTokens: count(data.estimatedInputTokens), stream: data.stream === true } };
  }
  if (kind === "prompt") {
    const sections = Array.isArray(data.sections) ? data.sections.filter(isRecord).map((section) => ({
      identifier: text(section.identifier) ?? "", role: text(section.role) ?? "",
      characterLength: count(section.characterLength) })) : [];
    const memory = isRecord(data.memory) ? { ids: Array.isArray(data.memory.ids)
      ? data.memory.ids.filter((id): id is string => typeof id === "string") : [],
    characterLength: count(data.memory.characterLength), outcome: text(data.memory.outcome) ?? "" } : undefined;
    return { prompt: { sections, totalMessageCount: count(data.totalMessageCount),
      totalCharacters: count(data.totalCharacters), ...(memory ? { memory } : {}) } };
  }
  if (kind === "usage") {
    return { usage: Object.fromEntries(USAGE_KEYS.map((key) => [key, nullableCount(data[key])])) as InspectorRecord["usage"] };
  }
  const httpStatus = typeof data.httpStatus === "number" ? data.httpStatus : undefined;
  return { terminal: { outcome: text(data.outcome) ?? "",
    ...(text(data.finishReason) ? { finishReason: text(data.finishReason) } : {}),
    ...(text(data.errorCategory) ? { errorCategory: text(data.errorCategory) } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(text(data.timeoutPhase) ? { timeoutPhase: text(data.timeoutPhase) } : {}),
    durationMs: count(data.durationMs) } };
}

export function createContextInspector(limit = CONTEXT_INSPECTOR_LIMIT) {
  const records = new Map<string, InspectorRecord>();
  const listeners = new Set<() => void>();
  let snapshot: readonly InspectorRecord[] = [];
  const publish = () => {
    snapshot = [...records.values()].reverse();
    for (const listener of listeners) {
      try { listener(); } catch { /* A panel failure must never affect generation. */ }
    }
  };
  return {
    record(kind: InspectorKind, data: unknown) {
      if (!isRecord(data) || typeof data.requestId !== "string") return;
      const previous = records.get(data.requestId);
      const next: InspectorRecord = { ...(previous ?? { requestId: data.requestId, source: text(data.source) ?? "unclassified" }),
        ...pick(kind, data) };
      if (!next.sessionIdHash && text(data.sessionIdHash)) next.sessionIdHash = text(data.sessionIdHash);
      if (!next.model && text(data.model)) next.model = text(data.model);
      if (!next.timestamp && text(data.timestamp)) next.timestamp = text(data.timestamp);
      records.delete(data.requestId);
      records.set(data.requestId, next);
      while (records.size > limit) records.delete(records.keys().next().value as string);
      publish();
    },
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    clear() {
      records.clear();
      publish();
    },
  };
}

export const contextInspector = createContextInspector();

/** Called only from request-diagnostics' development branches; production returns before touching the store. */
export function recordContextInspector(kind: InspectorKind, data: unknown) {
  if (!contextInspectorEnabled()) return;
  try { contextInspector.record(kind, data); } catch { /* Diagnostics must never affect generation. */ }
}
