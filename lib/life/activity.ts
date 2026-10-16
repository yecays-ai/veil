export const LIFE_ACTIVITY_LIMIT = 96;
export const LIFE_TITLE_LIMIT = 80;
export const LIFE_MOMENT_LIMIT = 280;
export const LIFE_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const LIFE_FUTURE_MS = 3 * 24 * 60 * 60_000;
export const LIFE_MAX_DURATION_MS = 36 * 60 * 60_000;
/** Life V2 record limits. Writers enforce them; stored data over a limit is not trusted and is left out. */
export const LIFE_THREAD_ACTIVE_LIMIT = 3;
export const LIFE_THREAD_PAUSED_LIMIT = 5;
export const LIFE_THREAD_TEXT_LIMIT = 280;
export const LIFE_KEEPSAKE_LIMIT = 20;
export const LIFE_KEEPSAKE_TEXT_LIMIT = 280;
export const LIFE_KEEPSAKE_WEIGHTS = [1, 2, 3, 4, 5] as const;

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
  /** Absent for the Routine's own projection; `"plan"` marks a row the Character's day plan created. */
  origin?: "plan";
  /** `"cancelled"` rows did not happen: they are kept for consistency, never shown or told, and never block time. */
  state?: "cancelled";
};

/** A matter that carries over from one day to the next. Active threads feed every plan; paused ones wait. */
export type LifeThread = {
  id: string; title: string; progress: string; next: string; state: "active" | "paused";
  createdAt: number; updatedAt: number;
};
/** An experience the Character itself judged to matter in the long run, with how much (1 low to 5 high). */
export type LifeKeepsake = { id: string; text: string; weight: 1 | 2 | 3 | 4 | 5; createdAt: number; updatedAt: number };
/** The local day (`YYYY-MM-DD`) the day plan was last claimed for. A claimed day is never planned twice. */
export type LifePlanMark = { day: string; claimedAt: number; status: "claimed" | "done" | "failed" };

export type LifeState = {
  activities: LifeActivity[]; reconciledAt: number;
  threads?: LifeThread[]; keepsakes?: LifeKeepsake[]; plan?: LifePlanMark;
};
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
    || raw.endsAt - raw.startsAt > LIFE_MAX_DURATION_MS || (raw.moment !== undefined && !moment)
    || (raw.origin !== undefined && raw.origin !== "plan") || (raw.state !== undefined && raw.state !== "cancelled")) return null;
  return { id: raw.id, occurrenceKey: raw.occurrenceKey, kind: raw.kind as LifeActivityKind, title,
    startsAt: raw.startsAt, endsAt: raw.endsAt, ...(moment ? { moment } : {}),
    ...(raw.origin ? { origin: "plan" as const } : {}), ...(raw.state ? { state: "cancelled" as const } : {}) };
}

const isDay = (value: unknown): value is string => {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().startsWith(value as string);
};
const byCreated = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Each optional record is all-or-nothing: one bad entry, duplicate id or an over-limit list leaves that record out. */
function normalizeThreads(value: unknown): LifeThread[] | null {
  if (!Array.isArray(value) || !value.length || value.length > LIFE_THREAD_ACTIVE_LIMIT + LIFE_THREAD_PAUSED_LIMIT) return null;
  const ids = new Set<string>(), threads: LifeThread[] = [];
  for (const item of value) {
    const raw = plain(item), title = safeText(raw.title, LIFE_TITLE_LIMIT), progress = safeText(raw.progress, LIFE_THREAD_TEXT_LIMIT),
      next = safeText(raw.next, LIFE_THREAD_TEXT_LIMIT);
    if (!safeId(raw.id) || ids.has(raw.id) || !title || !progress || !next || (raw.state !== "active" && raw.state !== "paused")
      || !safeTime(raw.createdAt) || !safeTime(raw.updatedAt) || raw.updatedAt < raw.createdAt) return null;
    ids.add(raw.id);
    threads.push({ id: raw.id, title, progress, next, state: raw.state, createdAt: raw.createdAt, updatedAt: raw.updatedAt });
  }
  if (threads.filter((item) => item.state === "active").length > LIFE_THREAD_ACTIVE_LIMIT
    || threads.filter((item) => item.state === "paused").length > LIFE_THREAD_PAUSED_LIMIT) return null;
  return threads.sort(byCreated);
}
function normalizeKeepsakes(value: unknown): LifeKeepsake[] | null {
  if (!Array.isArray(value) || !value.length || value.length > LIFE_KEEPSAKE_LIMIT) return null;
  const ids = new Set<string>(), keepsakes: LifeKeepsake[] = [];
  for (const item of value) {
    const raw = plain(item), text = safeText(raw.text, LIFE_KEEPSAKE_TEXT_LIMIT);
    if (!safeId(raw.id) || ids.has(raw.id) || !text || !LIFE_KEEPSAKE_WEIGHTS.includes(raw.weight as 1)
      || !safeTime(raw.createdAt) || !safeTime(raw.updatedAt) || raw.updatedAt < raw.createdAt) return null;
    ids.add(raw.id);
    keepsakes.push({ id: raw.id, text, weight: raw.weight as LifeKeepsake["weight"], createdAt: raw.createdAt, updatedAt: raw.updatedAt });
  }
  return keepsakes.sort(byCreated);
}
function normalizePlanMark(value: unknown): LifePlanMark | null {
  const raw = plain(value);
  return isDay(raw.day) && safeTime(raw.claimedAt) && (raw.status === "claimed" || raw.status === "done" || raw.status === "failed")
    ? { day: raw.day, claimedAt: raw.claimedAt, status: raw.status } : null;
}
/** The Life V2 records ride along with the activities; absent stays absent so older data reads back unchanged. */
function lifeRecords(raw: Record<string, unknown>): Pick<LifeState, "threads" | "keepsakes" | "plan"> {
  const threads = raw.threads === undefined ? null : normalizeThreads(raw.threads);
  const keepsakes = raw.keepsakes === undefined ? null : normalizeKeepsakes(raw.keepsakes);
  const plan = raw.plan === undefined ? null : normalizePlanMark(raw.plan);
  return { ...(threads ? { threads } : {}), ...(keepsakes ? { keepsakes } : {}), ...(plan ? { plan } : {}) };
}

/** Rows that happened or will: cancelled rows are history of a change of plan, not of the Character's day. */
export const lifeLive = (activities: readonly LifeActivity[]) => activities.filter((item) => item.state !== "cancelled");

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
  const live = lifeLive(activities);
  if (live.some((item, index) => index > 0 && item.startsAt < live[index - 1].endsAt)) return null;
  return { activities, reconciledAt, ...lifeRecords(raw) };
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
  // Over the cap, only the oldest finished activities go; the running one and everything ahead are never dropped.
  while (activities.length > LIFE_ACTIVITY_LIMIT && activities[0].endsAt <= effectiveNow) activities.shift();
  if (activities.length > LIFE_ACTIVITY_LIMIT) throw new Error("Too many life activities.");
  const live = lifeLive(activities);
  if (live.some((item, index) => index > 0 && item.startsAt < live[index - 1].endsAt))
    throw new Error("Life activities overlap.");
  // The Life V2 records belong to the Character, not to this pass, so a reconciliation hands them on untouched.
  return { activities, reconciledAt: effectiveNow, ...(current?.threads ? { threads: current.threads } : {}),
    ...(current?.keepsakes ? { keepsakes: current.keepsakes } : {}), ...(current?.plan ? { plan: current.plan } : {}) };
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
  const activities = lifeLive(state?.activities ?? []);
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
