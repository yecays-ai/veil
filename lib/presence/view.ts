import type { Presence } from "../foundation-types";
import { effectivePresence, lastOnlineAt, nextPresenceChange, type PresenceInputs } from "./compute";
import type { PresenceRecord } from "./storage";

// What every surface shows for a Character, from one pure function: the status, the Last Seen instant and the next
// moment the status may change. Storage is only an input; nothing here reads a clock or writes anything.

export type PresenceView = {
  status: Presence;
  /** Latest of the stored values and the freshly derived online time; null when there is none to show. */
  lastSeenAt: number | null;
  /** The online time derived from routine and situations now, for the caller to persist when it is later than stored. */
  derivedOnlineAt: number | null;
  nextChangeAt: number | null;
};

export function presenceView(character: { characterId: string; timezone: string | null }, record: PresenceRecord | undefined, now: number): PresenceView {
  const inputs: PresenceInputs = { characterId: character.characterId, timezone: character.timezone,
    routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] };
  const status = effectivePresence(inputs, now).status;
  const derivedOnlineAt = lastOnlineAt(inputs, now);
  const candidates = [record?.lastOnlineAt, record?.lastMessageAt, derivedOnlineAt]
    .filter((value): value is number => typeof value === "number" && value <= now);
  return { status, derivedOnlineAt, nextChangeAt: nextPresenceChange(inputs, now),
    lastSeenAt: candidates.length ? Math.max(...candidates) : null };
}

const LABELS: Record<Presence, string> = { online: "Online", away: "Away", busy: "Busy", dnd: "Do Not Disturb", offline: "Offline" };
export const presenceLabel = (status: Presence) => LABELS[status];

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export function relativeAge(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}
/** The one line shown under a name: "Online", or the status with when the Character was last online. */
export function presenceText(view: PresenceView, now: number): string {
  if (view.status === "online" || view.lastSeenAt === null) return presenceLabel(view.status);
  return `${presenceLabel(view.status)} · Last seen ${relativeAge(view.lastSeenAt, now)}`;
}
