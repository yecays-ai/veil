import type { Presence } from "../foundation-types";

// Provisional trial defaults (lan, 2026-10-14). A model attempt is counted when the request is prepared, whether the
// Character then writes or stays silent; failed or silent attempts are never retried and an overdue one is never replayed.
export const PROACTIVE_DAILY_MAX = 2;
export const PROACTIVE_MIN_GAP_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The attempts that still count against today's budget. */
export function recentAttempts(attempts: readonly number[] | undefined, now: number): number[] {
  return (attempts ?? []).filter((at) => Number.isFinite(at) && at > now - DAY_MS);
}

export function attemptsAllow(attempts: readonly number[] | undefined, now: number): boolean {
  const recent = recentAttempts(attempts, now);
  return recent.length < PROACTIVE_DAILY_MAX && recent.every((at) => now - at >= PROACTIVE_MIN_GAP_MS);
}

/** Busy, Do Not Disturb and Offline do not reach out; a Character with no routine yet counts as available. */
export function statusMayInitiate(status: Presence | null): boolean {
  return status === null || status === "online" || status === "away";
}

export const SILENCE_TAG = "<veil-silence/>";
/** True for a reply that is only the silence tag (or nothing): the Character chose not to write. */
export function isSilence(text: string): boolean {
  const value = text.trim();
  return !value || value === SILENCE_TAG;
}
/** True while streamed text could still turn out to be the silence tag, so it is not shown yet. */
export function maybeSilence(text: string): boolean {
  const value = text.trim();
  return !value || SILENCE_TAG.startsWith(value) || value === SILENCE_TAG;
}

export const PROACTIVE_INSTRUCTION = [
  "The user has not written to you. Decide, as this Character, whether you would message them right now for a reason that fits your own life, the time, and your history together. Something small that has already happened in your day can be that reason, but it is never required.",
  `If you would not, reply with exactly ${SILENCE_TAG} and nothing else.`,
  "If you would, write the message itself in your own voice. Do not mention that you were asked or prompted, and do not repeat what you already said.",
].join(" ");
