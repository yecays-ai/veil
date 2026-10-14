import type { Memory } from "./types";

/** Ongoing review: a hint for the next normal maintenance, with no timer, wake-up or extra model request. */
export const ONGOING_REVIEW = { maxDays: 365, dayMs: 86_400_000 } as const;

/** Due means the expected review time has passed; it never means the matter ended. Rows without reviewAt are never due. */
export const ongoingDue = (row: Pick<Memory, "kind" | "status" | "ongoing">, now: number): boolean =>
  row.kind === "ongoing" && row.status === "active" && row.ongoing?.reviewAt !== undefined && row.ongoing.reviewAt <= now;

export const reviewAtFrom = (now: number, days: number): number => now + days * ONGOING_REVIEW.dayMs;

/** Shape rules shared by the commit gate and backup validation; null when valid. */
export function ongoingProblem(row: Pick<Memory, "kind" | "origin" | "status" | "ongoing">): string | null {
  const data = row.ongoing as unknown;
  if (data === undefined) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "Ongoing data must be an object.";
  const { reviewAt, ended, ...rest } = data as Record<string, unknown>;
  if (Object.keys(rest).length || (reviewAt === undefined && ended === undefined)) return "Ongoing data has unexpected fields.";
  if (row.kind !== "ongoing" || row.origin !== "auto") return "Only automatic ongoing memories carry review data.";
  if (reviewAt !== undefined && (!Number.isSafeInteger(reviewAt) || (reviewAt as number) <= 0)) return "Invalid review time.";
  if (ended !== undefined && (!["explicit", "presumed"].includes(String(ended)) || row.status !== "archived")) return "Invalid ended marker.";
  return null;
}
