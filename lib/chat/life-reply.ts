import { effectivePresence, nextPresenceChange, type PresenceInputs } from "../presence/compute";

// Life Mode reply timing (provisional base parameters, to be tuned from real use). Pure: the same inputs always give
// the same answer, nothing is stored, and no model is called. "Due" is measured from the user's first unanswered message,
// so a reload or a second message never restarts the wait.
const SECOND = 1000, MINUTE = 60 * SECOND;
const FREE_DELAY_MS = [2 * SECOND, 8 * SECOND] as const;
const PEEK_CHANCE = 0.3;
const PEEK_DELAY_MS = [1 * MINUTE, 8 * MINUTE] as const;
const BUSY_DELAY_MS = [10 * MINUTE, 90 * MINUTE] as const;
/** A chat already under way keeps going briefly when Busy starts: last reply this recent, Busy this new. */
const CHAT_ACTIVE_MS = 5 * MINUTE;
const BUSY_GRACE_MS = 15 * MINUTE;
const GRACE_DELAY_MS = [10 * SECOND, 60 * SECOND] as const;
const AFTER_BUSY_MS = [5 * SECOND, 65 * SECOND] as const;
const AFTER_AWAY_MS = [30 * SECOND, 210 * SECOND] as const;
/** Offline and Do Not Disturb wait for an available status; this many status changes are looked through before parking. */
const MAX_STATUS_CHANGES = 8;

export type LifeReplyPlan = { kind: "due"; at: number } | { kind: "parked" };

/** Stable value in [0, 1) for one message and purpose, so a refresh never re-rolls the delay. */
function unit(seed: string, salt: string): number {
  let hash = 0x811c9dc5;
  const text = `${salt}|${seed}`;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0) / 0x100000000;
}
const within = (range: readonly [number, number], fraction: number) => range[0] + Math.floor((range[1] - range[0]) * fraction);
const available = (status: string) => status === "online" || status === "away";

/**
 * When the Character answers the user's first unanswered message. `parked` means no time can be given (Offline or Do Not
 * Disturb with no available status ahead); the message then simply stays unanswered.
 */
export function lifeReplyPlan(input: { pendingId: string; pendingAt: number; lastReplyAt: number | null; presence: PresenceInputs }): LifeReplyPlan {
  const { pendingId, pendingAt, lastReplyAt, presence } = input;
  const due = (at: number): LifeReplyPlan => ({ kind: "due", at });
  const free = due(pendingAt + within(FREE_DELAY_MS, unit(pendingId, "free")));
  const effective = effectivePresence(presence, pendingAt);
  // A Character with no routine and no running situation has nothing to be busy with.
  if (!presence.routine && effective.source !== "situation") return free;
  if (available(effective.status)) return free;

  if (effective.status === "busy") {
    const justBusy = effectivePresence(presence, pendingAt - BUSY_GRACE_MS).status !== "busy";
    if (justBusy && lastReplyAt !== null && pendingAt - lastReplyAt <= CHAT_ACTIVE_MS && pendingAt >= lastReplyAt)
      return due(pendingAt + within(GRACE_DELAY_MS, unit(pendingId, "grace")));
    const delay = unit(pendingId, "peek") < PEEK_CHANCE
      ? within(PEEK_DELAY_MS, unit(pendingId, "delay")) : within(BUSY_DELAY_MS, unit(pendingId, "delay"));
    const end = nextPresenceChange(presence, pendingAt);
    const at = pendingAt + delay;
    return due(end === null ? at : Math.min(at, end + within(AFTER_BUSY_MS, unit(pendingId, "after"))));
  }

  // Offline or Do Not Disturb: wait until the Character is available again, however long that takes.
  let from = pendingAt;
  for (let step = 0; step < MAX_STATUS_CHANGES; step++) {
    const change = nextPresenceChange(presence, from);
    if (change === null) return { kind: "parked" };
    if (available(effectivePresence(presence, change).status)) return due(change + within(AFTER_AWAY_MS, unit(pendingId, "back")));
    from = change;
  }
  return { kind: "parked" };
}
