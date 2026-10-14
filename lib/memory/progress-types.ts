export type MemoryBatchState = "ready" | "claimed" | "in-flight" | "commit-pending" | "failed" | "uncertain" | "too-large";
export type MemoryBatch = {
  id: string; fromSeq: number; toSeq: number; state: MemoryBatchState; attempts: number;
  sources: { messageId: string; seq: number; hash: string }[];
  candidates: { id: string; updatedAt: number; hash: string }[];
  /** Consecutive too-large evaluations under `budgetKey`; automatic attempts pause at two. Never marks the range done. */
  sizeAttempts?: number; budgetKey?: string;
  ownerId?: string; attemptId?: string; errorCode?: "known-failed" | "source-changed" | "commit-failed" | "owner-lost";
};
export type MemoryProgress = {
  epoch: string; incarnation: string; throughSeq: number;
  completed: [number, number][]; batches: MemoryBatch[];
};
export const memoryBatchActive = (batch: Pick<MemoryBatch, "state">) =>
  batch.state === "claimed" || batch.state === "in-flight" || batch.state === "commit-pending";

/** Reject unrecognized backup fields and malformed authorization ranges; never normalize damage. */
export function validMemoryProgress(value: unknown): value is MemoryProgress {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024;
  const int = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const keys = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).every((key) => fields.includes(key));
  if (!obj(value) || !keys(value, ["epoch", "incarnation", "throughSeq", "completed", "batches"])
    || !str(value.epoch) || !str(value.incarnation) || !int(value.throughSeq) || !Array.isArray(value.completed) || !Array.isArray(value.batches)) return false;
  const ranges: [number, number][] = [];
  let last = value.throughSeq;
  for (const range of value.completed) {
    if (!Array.isArray(range) || range.length !== 2 || !int(range[0]) || !int(range[1]) || range[0] <= last + 1 || range[1] < range[0]) return false;
    last = range[1]; ranges.push([range[0], range[1]]);
  }
  const ids = new Set<string>();
  for (const batch of value.batches) {
    if (!obj(batch) || !keys(batch, ["id", "fromSeq", "toSeq", "state", "attempts", "sources", "candidates", "ownerId", "attemptId", "errorCode", "sizeAttempts", "budgetKey"])
      || !str(batch.id) || ids.has(batch.id) || !int(batch.fromSeq) || !int(batch.toSeq) || batch.fromSeq <= value.throughSeq || batch.toSeq < batch.fromSeq
      || !["ready", "claimed", "in-flight", "commit-pending", "failed", "uncertain", "too-large"].includes(String(batch.state)) || !int(batch.attempts)
      || !Array.isArray(batch.sources) || !Array.isArray(batch.candidates)
      || (batch.sizeAttempts !== undefined && !int(batch.sizeAttempts)) || (batch.budgetKey !== undefined && !str(batch.budgetKey))
      || (batch.ownerId !== undefined && !str(batch.ownerId)) || (batch.attemptId !== undefined && !str(batch.attemptId))
      || (batch.errorCode !== undefined && !["known-failed", "source-changed", "commit-failed", "owner-lost"].includes(String(batch.errorCode)))) return false;
    const active = memoryBatchActive(batch as MemoryBatch);
    if (active && (!str(batch.ownerId) || !str(batch.attemptId) || batch.attempts < 1)) return false;
    if ((batch.state === "ready" || batch.state === "too-large") && (batch.ownerId !== undefined || batch.attemptId !== undefined)) return false;
    if (batch.state === "uncertain" && batch.attempts < 1) return false;
    if (batch.state === "failed" && batch.attempts < 1) return false;
    if (ranges.some(([from, to]) => batch.fromSeq as number <= to && (batch.toSeq as number) >= from)) return false;
    ranges.push([batch.fromSeq, batch.toSeq]); ids.add(batch.id);
    const sourceIds = new Set<string>(), seqs = new Set<number>(), candidates = new Set<string>();
    const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    for (const source of batch.sources) {
      if (!obj(source) || !keys(source, ["messageId", "seq", "hash"]) || !str(source.messageId) || !int(source.seq)
        || source.seq < batch.fromSeq || source.seq > batch.toSeq || !hash(source.hash) || sourceIds.has(source.messageId) || seqs.has(source.seq)) return false;
      sourceIds.add(source.messageId); seqs.add(source.seq);
    }
    for (const candidate of batch.candidates) {
      if (!obj(candidate) || !keys(candidate, ["id", "updatedAt", "hash"]) || !str(candidate.id) || !int(candidate.updatedAt) || !hash(candidate.hash) || candidates.has(candidate.id)) return false;
      candidates.add(candidate.id);
    }
  }
  return true;
}

export function finishMemoryRange(progress: MemoryProgress, batch: MemoryBatch): void {
  progress.batches = progress.batches.filter((item) => item.id !== batch.id);
  const ranges = [...progress.completed, [batch.fromSeq, batch.toSeq] as [number, number]].sort((a, b) => a[0] - b[0]);
  progress.completed = [];
  for (const range of ranges) {
    if (range[0] <= progress.throughSeq + 1) { progress.throughSeq = Math.max(progress.throughSeq, range[1]); continue; }
    const last = progress.completed.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else progress.completed.push(range);
  }
}
