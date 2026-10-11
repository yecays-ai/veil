// The last reason a Character's routine could not be generated, kept in memory for this session only so the
// Character page can name it. It is not Presence data: nothing is stored, and a reload forgets it (the routine
// is still missing then, and the next save asks again and reports again).

export type RoutineIssue = "no-api" | "error" | "truncated" | "invalid";

const issues = new Map<string, RoutineIssue>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const getRoutineIssue = (characterId: string | undefined): RoutineIssue | null =>
  (characterId && issues.get(characterId)) || null;
export function subscribeRoutineIssue(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Records the issue, or clears the old one when `issue` is null. Subscribers hear only about real changes. */
export function setRoutineIssue(characterId: string, issue: RoutineIssue | null) {
  if ((issues.get(characterId) ?? null) === issue) return;
  if (issue) issues.set(characterId, issue); else issues.delete(characterId);
  notify();
}
const REPORTED: readonly string[] = ["no-api", "error", "truncated", "invalid"] satisfies RoutineIssue[];
export const reportedIssue = (outcome: string): RoutineIssue | null => REPORTED.includes(outcome) ? outcome as RoutineIssue : null;
