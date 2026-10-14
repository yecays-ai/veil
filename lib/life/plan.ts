import type { Presence } from "../foundation-types";
import { localDayWindow, presenceSegments, type PresenceInputs, type PresenceSegment } from "../presence/compute";
import { reconcileLifeActivities, type LifeActivity, type LifeActivityKind, type LifeState } from "./activity";

const MAX_DAILY_SEGMENTS = 12;

const presentation: Record<Presence, { kind: LifeActivityKind; title: string }> = {
  offline: { kind: "sleep", title: "Sleeping" },
  busy: { kind: "work", title: "Working" },
  dnd: { kind: "work", title: "Focused time" },
  away: { kind: "errand", title: "Out and about" },
  online: { kind: "leisure", title: "Free time" },
};

const moments: Partial<Record<LifeActivityKind, readonly string[]>> = {
  work: ["Told a joke. Nobody laughed.", "Had to redo one small thing that looked easy."],
  errand: ["Took a wrong turn and quietly pretended it was intentional.", "Stopped to help with one small problem."],
  leisure: ["Found something unexpectedly funny.", "Spilled a little water and cleaned it up before anyone noticed."],
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

function activity(characterId: string, segment: PresenceSegment): LifeActivity {
  const view = presentation[segment.status];
  const occurrenceKey = `${characterId}|${segment.startsAt}|${segment.endsAt}|${view.kind}`;
  const options = moments[view.kind];
  const pick = hash(occurrenceKey);
  const moment = options && pick % 4 === 0 ? options[Math.floor(pick / 4) % options.length] : undefined;
  return { id: `life:${characterId}:${segment.startsAt}`, occurrenceKey, kind: view.kind, title: title(segment),
    startsAt: segment.startsAt, endsAt: segment.endsAt, ...(moment ? { moment } : {}) };
}

/**
 * Projects yesterday, today and tomorrow from the existing Presence authority. The same local day always yields
 * the same IDs, wording and optional Moment. It performs no storage write, timer or model request.
 */
export function projectDailyLife(inputs: PresenceInputs, now: number): LifeActivity[] {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid life planning time.");
  if (!inputs.routine && !inputs.situations.length) return [];
  return [-1, 0, 1].flatMap((offset) => {
    const day = localDayWindow(now, inputs.timezone, offset);
    const segments = presenceSegments(inputs, day.startsAt, day.endsAt)
      .filter((segment) => inputs.routine || segment.source === "situation");
    return coarse(segments).map((segment) => activity(inputs.characterId, segment));
  }).sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
}

/** Freezes already-settled time. A later Routine edit may fill gaps but cannot replace an activity the user could have seen. */
export function reconcileProjectedLife(current: LifeState | undefined, inputs: PresenceInputs, now: number): LifeState {
  const candidates = projectDailyLife(inputs, now).filter((candidate) => !(current?.activities.some((stored) =>
    stored.occurrenceKey !== candidate.occurrenceKey && candidate.startsAt < stored.endsAt && stored.startsAt < candidate.endsAt)));
  return reconcileLifeActivities(current, candidates, now);
}
