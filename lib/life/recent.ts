import { localDayWindow, type PresenceSituation } from "../presence/compute";
import { lifeLive, lifeMomentRevealAt, type LifeActivity, type LifeState } from "./activity";

export const LIFE_RECENT_WINDOW_MS = 12 * 60 * 60_000;
export const LIFE_RECENT_LIMIT = 4;
/** A stretch left over after a situation takes its time is not worth telling. */
const MIN_PIECE_MS = 15 * 60_000;

export type LifeRecentEntry = { title: string; startsAt: number; endsAt: number; moment?: string };
type Piece = LifeRecentEntry & { kind: string };

function subtract(activity: LifeActivity, covers: readonly [number, number][]): Piece[] {
  let pieces: [number, number][] = [[activity.startsAt, activity.endsAt]];
  for (const [from, to] of covers) pieces = pieces.flatMap(([start, end]) => from >= end || to <= start ? [[start, end] as [number, number]]
    : [...(from > start ? [[start, from] as [number, number]] : []), ...(to < end ? [[to, end] as [number, number]] : [])]);
  const reveal = lifeMomentRevealAt(activity);
  return pieces.filter(([start, end]) => end - start >= MIN_PIECE_MS).map(([startsAt, endsAt]) => ({ kind: activity.kind,
    title: activity.title, startsAt, endsAt,
    ...(activity.moment && reveal >= startsAt && reveal < endsAt ? { moment: activity.moment } : {}) }));
}

/**
 * What the Character's own day has already finished in the last hours, for its reply context. A situation is the
 * Character's own word and wins over the projected day: Life time it covers is cut away, and only the leftover time
 * stays. Everything is clipped to the window. Only finished time is returned; the running activity and anything planned ahead are not here, and a Moment
 * appears only when its reveal time has passed inside the kept stretch.
 */
export function recentLife(life: LifeState | undefined, situations: readonly PresenceSituation[], now: number,
  limit = LIFE_RECENT_LIMIT, windowMs = LIFE_RECENT_WINDOW_MS): LifeRecentEntry[] {
  const covers = situations.filter((item) => item.startsAt < now).map((item): [number, number] => [item.startsAt, Math.min(item.endsAt, now)]);
  const since = now - windowMs;
  const pieces: Piece[] = [
    ...lifeLive(life?.activities ?? []).filter((item) => item.endsAt <= now && item.endsAt > since).flatMap((item) => subtract(item, [...covers, [-Infinity, since]])),
    ...situations.flatMap((item): Piece[] => {
      const reason = item.reason?.trim();
      return reason && item.endsAt <= now && item.endsAt > now - windowMs && item.endsAt - Math.max(item.startsAt, since) >= MIN_PIECE_MS
        ? [{ kind: "situation", title: reason.slice(0, 80), startsAt: Math.max(item.startsAt, since), endsAt: item.endsAt }] : [];
    }),
  ].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt);
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    if (previous && previous.kind === piece.kind && previous.title === piece.title && piece.startsAt <= previous.endsAt) {
      previous.endsAt = Math.max(previous.endsAt, piece.endsAt);
      if (!previous.moment && piece.moment) previous.moment = piece.moment;
    } else merged.push({ ...piece });
  }
  const seen = new Set<string>();
  return merged.slice(-Math.max(0, limit)).map(({ title, startsAt, endsAt, moment }) => {
    if (moment && seen.has(moment)) return { title, startsAt, endsAt };
    if (moment) seen.add(moment);
    return { title, startsAt, endsAt, ...(moment ? { moment } : {}) };
  });
}

export const LIFE_AHEAD_LIMIT = 5;
/**
 * The Character's own concrete plans for the rest of today, in order: day-plan rows that have not started and begin
 * before its local day ends. Only titles and times are given, never a Moment (nothing has happened yet), and the
 * Routine's generic rhythm is not a plan. Cancelled rows are not plans.
 */
export function aheadLife(life: LifeState | undefined, now: number, timezone: string | null, limit = LIFE_AHEAD_LIMIT): LifeRecentEntry[] {
  const end = localDayWindow(now, timezone).endsAt;
  return lifeLive(life?.activities ?? []).filter((item) => item.origin === "plan" && item.startsAt > now && item.startsAt < end)
    .slice(0, Math.max(0, limit)).map(({ title, startsAt, endsAt }) => ({ title, startsAt, endsAt }));
}
