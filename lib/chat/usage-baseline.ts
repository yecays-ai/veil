import type { CompletionOutcome, CompletionSource, CompletionUsage } from "./request-diagnostics";

/**
 * M0 cost baseline: at most one content-free numeric record per real model request, in a small bounded
 * localStorage list. NON-AUTHORITATIVE diagnostics: not user data, not part of backup export/restore (the key is
 * deliberately absent from BACKUP_LOCAL_KEYS), safe to delete at any time. Unknown values stay null: tokens are
 * never estimated and no price or cost is stored. Stores no prompt, reply, URL, API key or Character/session name.
 */
export const USAGE_BASELINE_KEY = "veil.usage-baseline.v1";
/** Newest records kept; the oldest are dropped on write. */
export const USAGE_BASELINE_MAX_RECORDS = 300;
const MAX_MODEL_LENGTH = 80;
const VALID_SOURCES: ReadonlySet<string> = new Set<CompletionSource>([
  "manual-reply", "keyboard-auto-reply", "regenerate", "continue",
  "test-connection", "here-there-comment", "presence-routine", "memory-maintenance", "memory-summary", "unclassified",
]);
const VALID_OUTCOMES: ReadonlySet<string> = new Set<CompletionOutcome>([
  "completed", "truncated", "error", "timeout", "cancelled", "abandoned",
]);

export type UsageBaselineRecord = {
  at: number; // epoch ms when the call ended
  source: CompletionSource;
  outcome: CompletionOutcome;
  durationMs: number;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  messageCount: number; // turns sent, a session-length count only
  totalCharacters: number;
};
export type UsageBaselineMeta = { model: string; messages: readonly { content: string }[] };
type Store = Pick<Storage, "getItem" | "setItem">;

export function buildUsageBaselineRecord(meta: UsageBaselineMeta, source: CompletionSource, outcome: CompletionOutcome,
  durationMs: number, usage: CompletionUsage | null, at = Date.now()): UsageBaselineRecord {
  return {
    at, source, outcome, durationMs: Math.max(0, Math.round(durationMs)),
    model: meta.model.trim().slice(0, MAX_MODEL_LENGTH),
    promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null, cacheHitTokens: usage?.prompt_cache_hit_tokens ?? null,
    cacheMissTokens: usage?.prompt_cache_miss_tokens ?? null,
    messageCount: meta.messages.length,
    totalCharacters: meta.messages.reduce((total, message) => total + message.content.length, 0),
  };
}

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function defaultStore(): (Store & Pick<Storage, "removeItem">) | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}

/** Tolerant read: anything malformed is dropped, so a damaged value can never break a request or the summary. */
export function readUsageBaseline(store: Pick<Storage, "getItem"> | undefined = defaultStore()): UsageBaselineRecord[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(USAGE_BASELINE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): UsageBaselineRecord[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.at !== "number" || !Number.isFinite(row.at)
        || typeof row.source !== "string" || !VALID_SOURCES.has(row.source)
        || typeof row.outcome !== "string" || !VALID_OUTCOMES.has(row.outcome)
        || typeof row.model !== "string") return [];
      return [{
        at: row.at, source: row.source as CompletionSource, outcome: row.outcome as CompletionOutcome,
        durationMs: numberOrNull(row.durationMs) ?? 0, model: row.model.slice(0, MAX_MODEL_LENGTH),
        promptTokens: numberOrNull(row.promptTokens), completionTokens: numberOrNull(row.completionTokens),
        totalTokens: numberOrNull(row.totalTokens), cacheHitTokens: numberOrNull(row.cacheHitTokens),
        cacheMissTokens: numberOrNull(row.cacheMissTokens), messageCount: numberOrNull(row.messageCount) ?? 0,
        totalCharacters: numberOrNull(row.totalCharacters) ?? 0,
      }];
    });
  } catch { return []; }
}

/** Appends one record and trims to the capacity. Never throws: a full or unavailable store loses the record only. */
export function appendUsageBaseline(record: UsageBaselineRecord, store: Store | undefined = defaultStore()) {
  try {
    if (!store) return;
    const next = [...readUsageBaseline(store), record].slice(-USAGE_BASELINE_MAX_RECORDS);
    store.setItem(USAGE_BASELINE_KEY, JSON.stringify(next));
  } catch { /* Diagnostics must never affect generation. */ }
}

/** Redoable cleanup: removes only this diagnostic key. */
export function clearUsageBaseline(store: Pick<Storage, "removeItem"> | undefined = defaultStore()) {
  try { store?.removeItem(USAGE_BASELINE_KEY); } catch { /* nothing else to do */ }
}

export type UsageBaselineGroup = {
  requests: number; completed: number; failed: number; cancelled: number;
  promptTokens: number; completionTokens: number; totalTokens: number;
  cacheHitTokens: number; cacheMissTokens: number;
  /** Requests whose provider reported no usage; their tokens are absent from the sums above, not estimated. */
  unknownUsageRequests: number;
  averageDurationMs: number | null; maxMessageCount: number; maxTotalCharacters: number;
};
export type UsageBaselineSummary = UsageBaselineGroup & {
  bySource: Record<string, UsageBaselineGroup>; byModel: Record<string, UsageBaselineGroup>;
};

function group(rows: readonly UsageBaselineRecord[]): UsageBaselineGroup {
  const sum = (pick: (row: UsageBaselineRecord) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
  return {
    requests: rows.length,
    completed: rows.filter((row) => row.outcome === "completed" || row.outcome === "truncated").length,
    cancelled: rows.filter((row) => row.outcome === "cancelled").length,
    failed: rows.filter((row) => row.outcome === "error" || row.outcome === "timeout").length,
    promptTokens: sum((row) => row.promptTokens), completionTokens: sum((row) => row.completionTokens),
    totalTokens: sum((row) => row.totalTokens), cacheHitTokens: sum((row) => row.cacheHitTokens),
    cacheMissTokens: sum((row) => row.cacheMissTokens),
    unknownUsageRequests: rows.filter((row) => row.totalTokens === null && row.promptTokens === null
      && row.completionTokens === null).length,
    averageDurationMs: rows.length ? Math.round(sum((row) => row.durationMs) / rows.length) : null,
    maxMessageCount: Math.max(0, ...rows.map((row) => row.messageCount)),
    maxTotalCharacters: Math.max(0, ...rows.map((row) => row.totalCharacters)),
  };
}

/** Numeric-only summary for viewing/exporting. No cost: no reliable price source exists, so cost is unknown. */
export function summarizeUsageBaseline(rows: readonly UsageBaselineRecord[] = readUsageBaseline()): UsageBaselineSummary {
  const split = (key: "source" | "model") => {
    const buckets = new Map<string, UsageBaselineRecord[]>();
    for (const row of rows) buckets.set(row[key], [...(buckets.get(row[key]) ?? []), row]);
    return Object.fromEntries([...buckets].map(([name, bucket]) => [name, group(bucket)]));
  };
  return { ...group(rows), bySource: split("source"), byModel: split("model") };
}
