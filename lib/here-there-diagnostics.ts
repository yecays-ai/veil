/**
 * What became of one Here & There remark request, from the moment a model call was about to be made. Separate from
 * `completion:terminal` (how the model call ended) and from `generation:persisted` (Chat). Retry scheduling is not
 * reported: handing the opportunity back can itself fail without anyone noticing.
 * - adopted: the remark was written to the widget (the update found its target and the commit returned).
 * - stale-discarded: the owner ended, or the target widget was deleted or rebound, so nothing was written.
 * - cancelled: the request was aborted. Checked first, so a late abort never rewrites an adoption (the guard records once).
 * - empty: the model returned no usable text.
 * - commit-failed: the commit itself threw.
 * - error: anything else that went wrong while generating.
 */
export type HereThereOutcome = "adopted" | "stale-discarded" | "cancelled" | "empty" | "commit-failed" | "error";
export type HereThereStage = "model" | "commit";

export function hereThereDispositionSummary(requestId: string, outcome: HereThereOutcome, stage: HereThereStage,
  durationMs: number) {
  return { requestId, source: "here-there-comment" as const, outcome, stage, durationMs };
}

/** Starts the clock for one requested remark. The returned function records the first disposition and ignores later ones. */
export function startHereThereDisposition(requestId: string) {
  const started = Date.now();
  let recorded = false;
  return (outcome: HereThereOutcome, stage: HereThereStage) => {
    if (recorded) return;
    recorded = true;
    if (process.env.NODE_ENV !== "development") return;
    try {
      console.info("[VEIL here-there:disposed]", hereThereDispositionSummary(requestId, outcome, stage, Date.now() - started));
    } catch { /* Diagnostics must never affect the remark. */ }
  };
}
