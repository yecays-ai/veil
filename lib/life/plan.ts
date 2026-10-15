import type { Presence } from "../foundation-types";
import { localDayWindow, presenceSegments, type PresenceInputs, type PresenceSegment } from "../presence/compute";
import { LIFE_FUTURE_MS, LIFE_HISTORY_MS, reconcileLifeActivities, type LifeActivity, type LifeActivityKind, type LifeState } from "./activity";

const MAX_DAILY_SEGMENTS = 12;

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

/** Freezes already-settled time. A later Routine edit may fill gaps but cannot replace an activity the user could have seen. */
export function reconcileProjectedLife(current: LifeState | undefined, inputs: PresenceInputs, now: number): LifeState {
  const effectiveNow = Math.max(current?.reconciledAt ?? 0, now);
  const recentMoments = current?.activities
    .filter((item) => item.endsAt >= effectiveNow - LIFE_HISTORY_MS
      && item.startsAt <= effectiveNow + LIFE_FUTURE_MS)
    .flatMap((item) => item.moment ? [item.moment] : []) ?? [];
  const candidates = projectDailyLife(inputs, now, recentMoments).filter((candidate) => !(current?.activities.some((stored) =>
    stored.occurrenceKey !== candidate.occurrenceKey && candidate.startsAt < stored.endsAt && stored.startsAt < candidate.endsAt)));
  return reconcileLifeActivities(current, candidates, now);
}

