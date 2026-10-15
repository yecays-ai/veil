export const LIFE_ACTIVITY_LIMIT = 96;
export const LIFE_TITLE_LIMIT = 80;
export const LIFE_MOMENT_LIMIT = 280;
export const LIFE_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const LIFE_FUTURE_MS = 3 * 24 * 60 * 60_000;
export const LIFE_MAX_DURATION_MS = 36 * 60 * 60_000;

export const LIFE_ACTIVITY_KINDS = [
  "sleep", "work", "meal", "errand", "exercise", "leisure", "social", "travel", "other",
] as const;
export type LifeActivityKind = (typeof LIFE_ACTIVITY_KINDS)[number];

/**
 * One coarse stretch of a Character's life. `occurrenceKey` identifies the planned occurrence across wakeups;
 * `id` identifies the stored row. Neither is generated from display prose, so wording can change later without
 * turning one lunch into several events.
 */
export type LifeActivity = {
  id: string;
  occurrenceKey: string;
  kind: LifeActivityKind;
  title: string;
  startsAt: number;
  endsAt: number;
  /** At most one small, already-settled detail. Refreshing a page never regenerates it. */
  moment?: string;
};

export type LifeState = { activities: LifeActivity[]; reconciledAt: number };
export type LifeActivityStatus = "upcoming" | "active" | "completed";

const plain = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeText = (value: unknown, limit: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= limit ? text : null;
};
const safeId = (value: unknown): value is string => typeof value === "string" && value === value.trim()
  && value.length > 0 && value.length <= 160 && !["__proto__", "constructor", "prototype"].includes(value);
const safeTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function normalizeLifeActivity(value: unknown): LifeActivity | null {
  const raw = plain(value), title = safeText(raw.title, LIFE_TITLE_LIMIT), moment = raw.moment === undefined
    ? undefined : safeText(raw.moment, LIFE_MOMENT_LIMIT);
  if (!safeId(raw.id) || !safeId(raw.occurrenceKey) || !LIFE_ACTIVITY_KINDS.includes(raw.kind as LifeActivityKind)
    || !title || !safeTime(raw.startsAt) || !safeTime(raw.endsAt) || raw.endsAt <= raw.startsAt
    || raw.endsAt - raw.startsAt > LIFE_MAX_DURATION_MS || (raw.moment !== undefined && !moment)) return null;
  return { id: raw.id, occurrenceKey: raw.occurrenceKey, kind: raw.kind as LifeActivityKind, title,
    startsAt: raw.startsAt, endsAt: raw.endsAt, ...(moment ? { moment } : {}) };
}

/** Strict normalization for persisted data: duplicate identities are invalid, not silently merged. */
export function normalizeLifeState(value: unknown): LifeState | null {
  const raw = plain(value), reconciledAt = raw.reconciledAt;
  if (!Array.isArray(raw.activities) || !safeTime(reconciledAt) || raw.activities.length > LIFE_ACTIVITY_LIMIT) return null;
  const ids = new Set<string>(), occurrences = new Set<string>(), activities: LifeActivity[] = [];
  for (const item of raw.activities) {
    const activity = normalizeLifeActivity(item);
    if (!activity || ids.has(activity.id) || occurrences.has(activity.occurrenceKey)) return null;
    ids.add(activity.id); occurrences.add(activity.occurrenceKey); activities.push(activity);
  }
  activities.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
  if (activities.some((item) => item.endsAt < reconciledAt - LIFE_HISTORY_MS
    || item.startsAt > reconciledAt + LIFE_FUTURE_MS)) return null;
  if (activities.some((item, index) => index > 0 && item.startsAt < activities[index - 1].endsAt)) return null;
  return { activities, reconciledAt };
}

export function lifeActivityStatus(activity: LifeActivity, now: number): LifeActivityStatus {
  return now < activity.startsAt ? "upcoming" : now < activity.endsAt ? "active" : "completed";
}

/**
 * Commits one reconciliation result. Existing occurrences win, including their settled Moment; a repeated wake
 * therefore cannot create another lunch or rewrite its anecdote. New candidates with colliding ids are rejected.
 */
export function reconcileLifeActivities(current: LifeState | undefined, candidates: readonly LifeActivity[], now: number): LifeState {
  if (!safeTime(now)) throw new Error("Invalid life reconciliation time.");
  const effectiveNow = Math.max(current?.reconciledAt ?? 0, now);
  const kept = (current?.activities ?? []).filter((item) => item.endsAt >= effectiveNow - LIFE_HISTORY_MS
    && item.startsAt <= effectiveNow + LIFE_FUTURE_MS);
  const ids = new Map(kept.map((item) => [item.id, item.occurrenceKey] as const));
  const occurrences = new Set(kept.map((item) => item.occurrenceKey));
  const additions: LifeActivity[] = [];
  for (const raw of candidates) {
    const item = normalizeLifeActivity(raw);
    if (!item) throw new Error("Invalid life activity.");
    if (occurrences.has(item.occurrenceKey)) continue;
    const owner = ids.get(item.id);
    if (owner && owner !== item.occurrenceKey) throw new Error("Life activity ID collision.");
    if (item.endsAt < effectiveNow - LIFE_HISTORY_MS || item.startsAt > effectiveNow + LIFE_FUTURE_MS) continue;
    ids.set(item.id, item.occurrenceKey); occurrences.add(item.occurrenceKey); additions.push(item);
  }
  const activities = [...kept, ...additions].sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
  if (activities.length > LIFE_ACTIVITY_LIMIT) throw new Error("Too many life activities.");
  if (activities.some((item, index) => index > 0 && item.startsAt < activities[index - 1].endsAt))
    throw new Error("Life activities overlap.");
  return { activities, reconciledAt: effectiveNow };
}

/**
 * When an activity's Moment "happens": a stable point 30–70% of the way through it, derived from the occurrence so a
 * reload never moves it. The Moment is stored when the day is planned, but nothing shows or uses it before this time.
 */
export function lifeMomentRevealAt(activity: Pick<LifeActivity, "occurrenceKey" | "startsAt" | "endsAt">): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < activity.occurrenceKey.length; index++)
    hash = Math.imul(hash ^ activity.occurrenceKey.charCodeAt(index), 0x01000193);
  const fraction = 0.3 + ((hash >>> 0) % 41) / 100;
  return activity.startsAt + Math.floor((activity.endsAt - activity.startsAt) * fraction);
}

/**
 * What has happened by `now`, and nothing planned ahead: the current activity and the most recent finished ones. An
 * activity not yet started is absent, and a Moment appears only once its time inside the activity has come.
 */
export function lifeTimeline(state: LifeState | undefined, now: number, recent = 8) {
  const activities = state?.activities ?? [];
  const current = activities.find((item) => lifeActivityStatus(item, now) === "active") ?? null;
  const limit = Math.max(0, recent);
  const completed = limit ? activities.filter((item) => item.endsAt <= now).slice(-limit).reverse() : [];
  const shownMoments = new Set<string>();
  const happened = (items: readonly LifeActivity[]) => items.map((item) => {
    if (!item.moment) return item;
    if (now < lifeMomentRevealAt(item) || shownMoments.has(item.moment)) return { ...item, moment: undefined };
    shownMoments.add(item.moment);
    return item;
  });
  return { current: current ? happened([current])[0] : null, completed: happened(completed) };
}
