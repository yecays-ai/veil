export type MaintenanceDiagnostic = { outcome: "prepared" | "validated" | "rejected" | "commit-failed" | "committed";
  messageCount: number; candidateCount: number; inputCharacters: number; operationCount: number; discarded: number; durationMs: number;
  /** Counts only, never text: what the local guards did to this request. */
  sizeAttempts?: number; redactedCharacters?: number; omittedMessages?: number; backgroundOmitted?: number; manualSent?: number };
/** Development-only bounded RAM records. No arbitrary strings, IDs, bodies, keys or persisted usage. */
export function createMaintenanceDiagnostics(enabled = process.env.NODE_ENV === "development") {
  const records: MaintenanceDiagnostic[] = [];
  return { record(value: MaintenanceDiagnostic) {
    if (!enabled || !["prepared", "validated", "rejected", "commit-failed", "committed"].includes(value.outcome)) return;
    const numeric = [value.messageCount, value.candidateCount, value.inputCharacters, value.operationCount, value.discarded, value.durationMs];
    if (numeric.some((n) => !Number.isFinite(n) || n < 0)) return;
    const extra = Object.fromEntries((["sizeAttempts", "redactedCharacters", "omittedMessages", "backgroundOmitted", "manualSent"] as const)
      .flatMap((key) => Number.isFinite(value[key]) && (value[key] as number) >= 0 ? [[key, value[key]]] : []));
    records.push({ outcome: value.outcome, messageCount: value.messageCount, candidateCount: value.candidateCount,
      inputCharacters: value.inputCharacters, operationCount: value.operationCount, discarded: value.discarded, durationMs: value.durationMs, ...extra });
    if (records.length > 20) records.shift();
  }, read: () => records.map((r) => ({ ...r })) };
}
