import type { Presence } from "../foundation-types";
import { localDayWindow, presenceSegments, type PresenceInputs, type PresenceSegment } from "../presence/compute";
import { LIFE_HISTORY_MS, lifeMomentRevealAt, reconcileLifeActivities, type LifeActivity, type LifeActivityKind, type LifeState } from "./activity";

const MAX_DAILY_SEGMENTS = 12;
/** A leftover shorter than this after clipping against recorded time is not worth an entry. */
const MIN_FILL_MS = 60_000;

const presentation: Record<Presence, { kind: LifeActivityKind; title: string }> = {
  offline: { kind: "sleep", title: "Sleeping" },
  busy: { kind: "work", title: "Working" },
  dnd: { kind: "work", title: "Focused time" },
  away: { kind: "errand", title: "Out and about" },
  online: { kind: "leisure", title: "Free time" },
};

const moments: Partial<Record<LifeActivityKind, readonly string[]>> = {
  work: ["Told a joke. Nobody laughed.", "Had to redo one small thing that looked easy.", "Reached for a pen that was already in hand.",
    "A tiny mistake took longer to fix than the main task.", "Forgot why the next tab was open, then remembered.",
    "Finally found the note that had been sitting in plain sight.", "Took a short break and came back with a better idea.",
    "Read the same sentence twice before it made sense.", "The first attempt went oddly well.", "Saved a draft and gave it one last suspicious look."],
  errand: ["Took a wrong turn and quietly pretended it was intentional.", "Stopped to help with one small problem.",
    "Held the door for someone carrying far too many things.", "Nearly walked past the place, despite checking the map.",
    "Waited an extra moment so someone else could go first.", "Found a shortcut that was not much shorter.",
    "A gust of wind nearly stole a receipt.", "Got the one item that was almost forgotten.",
    "Paused to look at something interesting in a shop window.", "Made it back with everything on the list."],
  leisure: ["Found something unexpectedly funny.", "Spilled a little water and cleaned it up before anyone noticed.",
    "Started one episode and immediately checked how much time was left.", "Made a drink, then forgot where it was put down.",
    "Found a comfortable spot and stayed there longer than planned.", "Heard a song that brought back a half-remembered scene.",
    "Tried to relax while mentally rearranging tomorrow's plans.", "Paused to watch the light change across the room.",
    "Picked up a book, read two pages, and kept thinking about them.", "Had a snack that was better than expected."],
};

function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) value = Math.imul(value ^ seed.charCodeAt(index), 0x01000193);
  return value >>> 0;
}

function title(segment: PresenceSegment) {
  const reason = segment.situation?.reason?.trim();
  return reason ? reason.slice(0, 80) : presentation[segment.status].title;
}

function coarse(segments: PresenceSegment[]) {
  const merged: PresenceSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.endsAt === segment.startsAt && !previous.situation && !segment.situation
      && presentation[previous.status].kind === presentation[segment.status].kind
      && presentation[previous.status].title === presentation[segment.status].title) previous.endsAt = segment.endsAt;
    else merged.push({ ...segment });
  }
  if (merged.length <= MAX_DAILY_SEGMENTS) return merged;
  const keep = new Set(merged.map((item, index) => ({ index, duration: item.endsAt - item.startsAt }))
    .sort((a, b) => b.duration - a.duration || a.index - b.index).slice(0, MAX_DAILY_SEGMENTS).map((item) => item.index));
  return merged.filter((_, index) => keep.has(index));
}

function activity(characterId: string, segment: PresenceSegment, usedMoments: Set<string>): LifeActivity {
  const view = presentation[segment.status];
  const occurrenceKey = `${characterId}|${segment.startsAt}|${segment.endsAt}|${view.kind}`;
  const options = moments[view.kind];
  const pick = hash(occurrenceKey);
  let moment: string | undefined;
  if (options && pick % 4 === 0) {
    const first = Math.floor(pick / 4) % options.length;
    for (let offset = 0; offset < options.length; offset++) {
      const candidate = options[(first + offset) % options.length];
      if (usedMoments.has(candidate)) continue;
      moment = candidate;
      usedMoments.add(candidate);
      break;
    }
  }
  return { id: `life:${characterId}:${segment.startsAt}`, occurrenceKey, kind: view.kind, title: title(segment),
    startsAt: segment.startsAt, endsAt: segment.endsAt, ...(moment ? { moment } : {}) };
}

/**
 * Projects yesterday, today and tomorrow from the existing Presence authority. The same inputs, time and recent
 * Moments yield the same IDs, wording and optional Moment. It performs no storage write, timer or model request.
 */
export function projectDailyLife(inputs: PresenceInputs, now: number, recentMoments: readonly string[] = []): LifeActivity[] {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid life planning time.");
  if (!inputs.routine && !inputs.situations.length) return [];
  const usedMoments = new Set(recentMoments);
  return [-1, 0, 1].flatMap((offset) => {
    const day = localDayWindow(now, inputs.timezone, offset);
    const segments = presenceSegments(inputs, day.startsAt, day.endsAt)
      .filter((segment) => inputs.routine || segment.source === "situation");
    return coarse(segments).map((segment) => activity(inputs.characterId, segment, usedMoments));
  }).sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

/**
 * Settles stored Life against the latest Routine and Situations. What has already begun is history and stays: finished
 * activities and revealed Moments never change. What has not happened yet follows the latest state: a planned
 * activity that no longer matches is dropped, and the running one is cut at `now` so the time after it can follow the
 * new status. A cut activity keeps its Moment only if that Moment had already been revealed.
 */
export function reconcileProjectedLife(current: LifeState | undefined, inputs: PresenceInputs, now: number): LifeState {
  const effectiveNow = Math.max(current?.reconciledAt ?? 0, now);
  const projected = projectDailyLife(inputs, now, (current?.activities
    .filter((item) => item.endsAt >= effectiveNow - LIFE_HISTORY_MS && item.endsAt <= effectiveNow)
    .flatMap((item) => item.moment ? [item.moment] : [])) ?? []);
  const wanted = new Map(projected.map((item) => [item.occurrenceKey, item] as const));
  const frozen = (current?.activities ?? []).flatMap((item): LifeActivity[] => {
    const same = wanted.get(item.occurrenceKey);
    // The same planned stretch keeps its identity; only its wording follows the latest status, and only before it starts.
    if (same && item.startsAt > effectiveNow) return [{ ...item, title: same.title }];
    if (same && item.startsAt <= effectiveNow && effectiveNow < item.endsAt && same.title !== item.title) {
      // A running stretch whose wording changed is cut here and becomes history under its own key, so the rest of the
      // stretch can continue under the plan's key with the new wording.
      const { moment, ...rest } = item;
      const head = { ...rest, occurrenceKey: `${item.occurrenceKey}~${effectiveNow}`, endsAt: effectiveNow };
      return [{ ...head, ...(moment && lifeMomentRevealAt(head) <= effectiveNow ? { moment } : {}) }];
    }
    if (same || item.endsAt <= effectiveNow) return [item];
    if (item.startsAt >= effectiveNow) return [];
    const { moment, ...rest } = item;
    return [{ ...rest, endsAt: effectiveNow, ...(moment && lifeMomentRevealAt(item) <= effectiveNow ? { moment } : {}) }];
  });
  const ids = new Set(frozen.map((item) => item.id));
  const candidates = projected.flatMap((candidate): LifeActivity[] => {
    if (frozen.some((stored) => stored.occurrenceKey === candidate.occurrenceKey)) return [candidate];
    // Time that already belongs to the record is not rewritten. The candidate keeps what lies after it, because that is
    // the part still ahead; an unrecorded stretch before recorded time is not invented afterwards.
    let { startsAt } = candidate;
    const { endsAt } = candidate;
    for (const stored of frozen) if (startsAt < stored.endsAt && stored.startsAt < endsAt) startsAt = stored.endsAt;
    // A segment that shares its start with recorded time keeps a distinct row ID.
    const id = ids.has(candidate.id) ? `${candidate.id}:${candidate.endsAt}` : candidate.id;
    return endsAt - startsAt >= MIN_FILL_MS ? [{ ...candidate, id, startsAt, endsAt }] : [];
  });
  return reconcileLifeActivities({ activities: frozen, reconciledAt: current?.reconciledAt ?? 0 }, candidates, now);
}
