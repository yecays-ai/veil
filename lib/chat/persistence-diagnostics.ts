import type { CompletionSource } from "./request-diagnostics";

/**
 * What a claimed generation attempt left in storage. Separate from `completion:terminal`, which only says how the
 * model call ended: a call that completed can still fail to commit.
 * - committed: `finalizeReply` returned.
 * - failure-recorded / stopped-recorded: `failGeneration` saved the marker.
 * - owner-lost: `failGeneration` reported the attempt is no longer the owner, so nothing was written.
 * - failure-record-failed: `failGeneration` itself threw.
 * - nothing-persisted: attempt claimed, but nothing to answer, a rejected eligibility check, or a stop before a draft.
 */
export type GenerationPersistenceOutcome = "committed" | "failure-recorded" | "stopped-recorded" | "owner-lost"
  | "failure-record-failed" | "nothing-persisted";

export function generationPersistenceSummary(requestId: string, source: CompletionSource,
  outcome: GenerationPersistenceOutcome, releaseFailed: boolean, durationMs: number) {
  return { requestId, source, outcome, releaseFailed, durationMs };
}

/** Starts the clock for one claimed attempt. The returned function records the first outcome and ignores later ones. */
export function startGenerationPersistence(source: CompletionSource) {
  const started = Date.now();
  let recorded = false;
  return (requestId: string, outcome: GenerationPersistenceOutcome, releaseFailed: boolean) => {
    if (recorded) return;
    recorded = true;
    if (process.env.NODE_ENV !== "development") return;
    try {
      console.info("[VEIL generation:persisted]",
        generationPersistenceSummary(requestId, source, outcome, releaseFailed, Date.now() - started));
    } catch { /* Diagnostics must never affect generation. */ }
  };
}
