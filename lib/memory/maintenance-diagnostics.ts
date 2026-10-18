import { extractJsonObject, scanJson, topLevelObjects } from "./maintenance-operations";

/** Where a maintenance request ended. `ok` means the batch committed; it says nothing about how much was written (see counts). */
export const MAINTENANCE_STAGES = ["ok", "provider-error", "truncated", "json", "format", "commit-failed", "too-large", "preflight", "all-redacted"] as const;
export type MaintenanceStage = (typeof MAINTENANCE_STAGES)[number];
/** What the model returned and what the local checks did to it. Numbers only. */
export const MAINTENANCE_COUNT_KEYS = ["ignored", "created", "updated", "state", "droppedManual", "droppedTooLong", "droppedProtected", "droppedDuplicate"] as const;
export type MaintenanceCounts = Record<(typeof MAINTENANCE_COUNT_KEYS)[number], number>;
/** Numbers and enums describing a response that failed to parse. Never any of its text. */
export type ShapeEdge = "brace" | "fence" | "other" | "empty";
/** Category of the JSON parser's complaint, never its message (which can quote the response). */
export const PARSE_ERRORS = ["control-char", "unterminated-string", "end-of-input", "expected-delimiter", "unexpected-token", "other"] as const;
export type ParseErrorKind = (typeof PARSE_ERRORS)[number];
export type MaintenanceShape = { length: number; head: ShapeEdge; tail: ShapeEdge; fenced: boolean; objects: number;
  finish: "stop" | "length" | "other" | "none"; position?: number;
  /** Of the single object when there is one: why it does not parse, and how many known syntax slips it holds. */
  error?: ParseErrorKind; controlChars?: number; trailingCommas?: number; strayQuotes?: number };
const DEFECT_KEYS = ["controlChars", "trailingCommas", "strayQuotes"] as const;
function parseErrorKind(text: string): ParseErrorKind | undefined {
  try { JSON.parse(text); return undefined; }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /control character/i.test(message) ? "control-char" : /unterminated/i.test(message) ? "unterminated-string"
      : /end of|eof/i.test(message) ? "end-of-input" : /expected/i.test(message) ? "expected-delimiter"
        : /unexpected|unrecognized/i.test(message) ? "unexpected-token" : "other";
  }
}
const SHAPE_EDGES: readonly string[] = ["brace", "fence", "other", "empty"], SHAPE_FINISH: readonly string[] = ["stop", "length", "other", "none"];
export function responseShape(text: string, finish: MaintenanceShape["finish"]): MaintenanceShape {
  const trimmed = text.trim();
  const edge = (value: string, fence: boolean): ShapeEdge => !value ? "empty" : fence ? "fence" : /[{}]/.test(value) ? "brace" : "other";
  const { spans } = topLevelObjects(text);
  let position: number | undefined;
  try { JSON.parse(text); } catch (error) { const match = /position (\d+)/.exec(error instanceof Error ? error.message : ""); if (match) position = Number(match[1]); }
  const object = extractJsonObject(text), error = parseErrorKind(object ?? text), { defects } = scanJson(object ?? text);
  return { length: text.length, head: edge(trimmed.slice(0, 1), trimmed.startsWith("```")), tail: edge(trimmed.slice(-1), trimmed.endsWith("```")),
    fenced: trimmed.includes("```"), objects: spans.length, finish, ...(position !== undefined ? { position } : {}),
    ...(error ? { error } : {}), ...defects };
}
export type MaintenanceDiagnostic = { outcome: "prepared" | "validated" | "rejected" | "commit-failed" | "committed";
  messageCount: number; candidateCount: number; inputCharacters: number; operationCount: number; discarded: number; durationMs: number;
  /** Counts only, never text: what the local guards did to this request. */
  sizeAttempts?: number; redactedCharacters?: number; omittedMessages?: number; backgroundOmitted?: number; manualSent?: number;
  /** Which request this was for its range: 1 first, 2 the single automatic retry. */
  attempt?: number; shape?: MaintenanceShape;
  at?: number; stage?: MaintenanceStage; fromSeq?: number; toSeq?: number; counts?: MaintenanceCounts };
export type MaintenanceDiagnosticStore = { load(): string | null; save(value: string): void };
export const MAINTENANCE_RESULTS_KEY = "veil.memory-maintenance-results.v1";
/** Fired after a result is stored, so an open status page can refresh. */
export const MAINTENANCE_RESULTS_EVENT = "veil-memory-maintenance-results";
const MAX_RECORDS = 20;
const OUTCOMES = ["prepared", "validated", "rejected", "commit-failed", "committed"];
const OPTIONAL = ["sizeAttempts", "redactedCharacters", "omittedMessages", "backgroundOmitted", "manualSent", "at", "fromSeq", "toSeq", "attempt"] as const;
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
  const s = v.shape as Record<string, unknown> | undefined;
  const shape: MaintenanceShape | undefined = s && typeof s === "object" && count(s.length) && count(s.objects) && typeof s.fenced === "boolean"
    && SHAPE_EDGES.includes(String(s.head)) && SHAPE_EDGES.includes(String(s.tail)) && SHAPE_FINISH.includes(String(s.finish))
    ? { length: s.length, head: s.head as ShapeEdge, tail: s.tail as ShapeEdge, fenced: s.fenced, objects: s.objects,
      finish: s.finish as MaintenanceShape["finish"], ...(count(s.position) ? { position: s.position } : {}),
      ...(PARSE_ERRORS.some((kind) => kind === s.error) ? { error: s.error as ParseErrorKind } : {}),
      ...Object.fromEntries(DEFECT_KEYS.flatMap((key) => count(s[key]) ? [[key, s[key]]] : [])) } : undefined;
  return { outcome: v.outcome as MaintenanceDiagnostic["outcome"], messageCount: v.messageCount as number, candidateCount: v.candidateCount as number,
    inputCharacters: v.inputCharacters as number, operationCount: v.operationCount as number, discarded: v.discarded as number,
    durationMs: v.durationMs as number, ...extra, ...(stage ? { stage } : {}), ...(counts ? { counts } : {}), ...(shape ? { shape } : {}) };
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
  save: (value) => {
    try { localStorage.setItem(MAINTENANCE_RESULTS_KEY, value); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event(MAINTENANCE_RESULTS_EVENT)); } catch { /* ignore */ }
  },
};

const STAGE_TEXT: Record<Exclude<MaintenanceStage, "ok">, string> = {
  "provider-error": "request failed or was interrupted; result unknown, not retried",
  truncated: "model output was cut off",
  json: "response was not valid JSON",
  format: "response broke the operation format",
  "commit-failed": "write failed; result unknown, not retried",
  "too-large": "input too large; no request sent",
  preflight: "stopped by a local check; no request sent",
  "all-redacted": "every message held a secret; no request sent",
};

/** One line of counts for the status page. `completed` on the usage row only says the provider answered. */
export function describeMaintenanceResult(d: MaintenanceDiagnostic): string {
  const retry = (d.attempt ?? 1) > 1 ? "Retry. " : "";
  if (d.stage && d.stage !== "ok") {
    const x = d.shape;
    const shape = x ? ` Response: ${x.length} chars, starts ${x.head}, ends ${x.tail}, ${x.fenced ? "code fence, " : ""}${x.objects} JSON object${x.objects === 1 ? "" : "s"}, finish ${x.finish}${x.position !== undefined ? `, error at ${x.position}` : ""}${x.error ? `, parser says ${x.error}` : ""}${x.controlChars ? `, ${x.controlChars} raw control char${x.controlChars === 1 ? "" : "s"} in strings` : ""}${x.trailingCommas ? `, ${x.trailingCommas} trailing comma${x.trailingCommas === 1 ? "" : "s"}` : ""}${x.strayQuotes ? `, ${x.strayQuotes} stray quote${x.strayQuotes === 1 ? "" : "s"}` : ""}.` : "";
    // A known failure keeps its range and is retried once automatically; request-unknown stages never are.
    const next = ["truncated", "json", "format"].includes(d.stage) ? (d.attempt ?? 1) >= 2 ? "; no more automatic retries" : "; one automatic retry is allowed" : "";
    return `${retry}Not written: ${STAGE_TEXT[d.stage]}${next}.${shape}`;
  }
  const c = d.counts;
  if (!c) return "Result not recorded";
  const valid = d.operationCount - c.ignored;
  const dropped = [[c.droppedTooLong, "over 600 characters"], [c.droppedProtected, "protected"], [c.droppedDuplicate, "duplicate"], [c.droppedManual, "manual target"]]
    .filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
  return `${retry}Model returned ${d.operationCount} operation${d.operationCount === 1 ? "" : "s"} (${c.ignored} ignored, ${valid} actionable). Written: ${c.created} created, ${c.updated} updated, ${c.state} state.`
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
