/** Where a maintenance request ended. `ok` means the batch committed; it says nothing about how much was written (see counts). */
export const MAINTENANCE_STAGES = ["ok", "provider-error", "truncated", "json", "format", "commit-failed", "too-large", "preflight", "all-redacted"] as const;
export type MaintenanceStage = (typeof MAINTENANCE_STAGES)[number];
/** What the model returned and what the local checks did to it. Numbers only. */
export const MAINTENANCE_COUNT_KEYS = ["ignored", "created", "updated", "state", "droppedManual", "droppedTooLong", "droppedProtected", "droppedDuplicate"] as const;
export type MaintenanceCounts = Record<(typeof MAINTENANCE_COUNT_KEYS)[number], number>;
export type MaintenanceDiagnostic = { outcome: "prepared" | "validated" | "rejected" | "commit-failed" | "committed";
  messageCount: number; candidateCount: number; inputCharacters: number; operationCount: number; discarded: number; durationMs: number;
  /** Counts only, never text: what the local guards did to this request. */
  sizeAttempts?: number; redactedCharacters?: number; omittedMessages?: number; backgroundOmitted?: number; manualSent?: number;
  at?: number; stage?: MaintenanceStage; fromSeq?: number; toSeq?: number; counts?: MaintenanceCounts };
export type MaintenanceDiagnosticStore = { load(): string | null; save(value: string): void };
export const MAINTENANCE_RESULTS_KEY = "veil.memory-maintenance-results.v1";
const MAX_RECORDS = 20;
const OUTCOMES = ["prepared", "validated", "rejected", "commit-failed", "committed"];
const OPTIONAL = ["sizeAttempts", "redactedCharacters", "omittedMessages", "backgroundOmitted", "manualSent", "at", "fromSeq", "toSeq"] as const;
const count = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Rebuilds a record from known numeric and enum fields only, so nothing else can be stored or read back. */
function sanitize(value: unknown): MaintenanceDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!OUTCOMES.includes(String(v.outcome))) return undefined;
  const required = ["messageCount", "candidateCount", "inputCharacters", "operationCount", "discarded", "durationMs"] as const;
  if (required.some((key) => !count(v[key]))) return undefined;
  const extra = Object.fromEntries(OPTIONAL.flatMap((key) => count(v[key]) ? [[key, v[key]]] : []));
  const stage = MAINTENANCE_STAGES.find((s) => s === v.stage);
  const raw = v.counts as Record<string, unknown> | undefined;
  const counts = raw && typeof raw === "object" && MAINTENANCE_COUNT_KEYS.every((key) => count(raw[key]))
    ? Object.fromEntries(MAINTENANCE_COUNT_KEYS.map((key) => [key, raw[key]])) as MaintenanceCounts : undefined;
  return { outcome: v.outcome as MaintenanceDiagnostic["outcome"], messageCount: v.messageCount as number, candidateCount: v.candidateCount as number,
    inputCharacters: v.inputCharacters as number, operationCount: v.operationCount as number, discarded: v.discarded as number,
    durationMs: v.durationMs as number, ...extra, ...(stage ? { stage } : {}), ...(counts ? { counts } : {}) };
}

/** Bounded records of numbers and enums. Development-only RAM by default; the browser passes a store to keep the last few results on this device. */
export function createMaintenanceDiagnostics(enabled = process.env.NODE_ENV === "development", store?: MaintenanceDiagnosticStore) {
  const records: MaintenanceDiagnostic[] = [];
  const persist = () => { try { store?.save(JSON.stringify(records)); } catch { /* Diagnostics never block maintenance. */ } };
  if (enabled && store) {
    try {
      const saved: unknown = JSON.parse(store.load() ?? "[]");
      if (Array.isArray(saved)) for (const item of saved.slice(-MAX_RECORDS)) { const clean = sanitize(item); if (clean) records.push(clean); }
    } catch { /* Unreadable diagnostics are ignored, never repaired or used for decisions. */ }
  }
  return { record(value: MaintenanceDiagnostic) {
    if (!enabled) return;
    const clean = sanitize(value);
    if (!clean) return;
    records.push(clean);
    if (records.length > MAX_RECORDS) records.shift();
    persist();
  }, read: () => records.map((r) => ({ ...r })) };
}

/** Browser store: localStorage may be unavailable or full, which only means no history. */
export const browserMaintenanceDiagnosticStore: MaintenanceDiagnosticStore = {
  load: () => { try { return localStorage.getItem(MAINTENANCE_RESULTS_KEY); } catch { return null; } },
  save: (value) => { try { localStorage.setItem(MAINTENANCE_RESULTS_KEY, value); } catch { /* ignore */ } },
};

const STAGE_TEXT: Record<Exclude<MaintenanceStage, "ok">, string> = {
  "provider-error": "request failed or was interrupted; result unknown, not retried",
  truncated: "model output was cut off; not written, not retried",
  json: "response was not valid JSON; not written, not retried",
  format: "response broke the operation format; not written, not retried",
  "commit-failed": "write failed; result unknown, not retried",
  "too-large": "input too large; no request sent",
  preflight: "stopped by a local check; no request sent",
  "all-redacted": "every message held a secret; no request sent",
};

/** One line of counts for the status page. `completed` on the usage row only says the provider answered. */
export function describeMaintenanceResult(d: MaintenanceDiagnostic): string {
  if (d.stage && d.stage !== "ok") return `Not written: ${STAGE_TEXT[d.stage]}`;
  const c = d.counts;
  if (!c) return "Result not recorded";
  const valid = d.operationCount - c.ignored;
  const dropped = [[c.droppedTooLong, "over 600 characters"], [c.droppedProtected, "protected"], [c.droppedDuplicate, "duplicate"], [c.droppedManual, "manual target"]]
    .filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
  return `Model returned ${d.operationCount} operation${d.operationCount === 1 ? "" : "s"} (${c.ignored} ignored, ${valid} actionable). Written: ${c.created} created, ${c.updated} updated, ${c.state} state.`
    + (dropped.length ? ` Dropped: ${dropped.join(", ")}.` : "");
}

/** Pairs each stored result with the provider request it started (the usage row ends after the result's clock, within the request timeout). */
export function pairMaintenanceResults<U extends { at: number }>(usage: readonly U[], diagnostics: readonly MaintenanceDiagnostic[], windowMs = 95_000) {
  const free = diagnostics.filter((d) => d.at !== undefined);
  const pairs = new Map<U, MaintenanceDiagnostic>(), used = new Set<MaintenanceDiagnostic>();
  for (const row of usage) {
    const match = free.filter((d) => !used.has(d) && d.at! <= row.at && row.at - d.at! <= windowMs).sort((a, b) => b.at! - a.at!)[0];
    if (match) { pairs.set(row, match); used.add(match); }
  }
  return { pairs, unpaired: free.filter((d) => !used.has(d)) };
}
