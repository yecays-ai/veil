import { normalizePresence, validTimezone, type Presence } from "../foundation-types";

// Pure Character Presence calculation: no storage, no React, no clock of its own. The same inputs and
// `now` always give the same answer, which is what keeps a back-filled Last Seen stable across reopens.

/** A Character-chosen stretch of life (busy, on a mission, asleep early). Absolute ms timestamps. */
export type PresenceSituation = { status: Presence; reason: string | null; startsAt: number; endsAt: number };
/** One rough weekly block in the Character's local time; `endMinute <= startMinute` runs past midnight. */
export type RoutineBlock = { days: readonly number[]; startMinute: number; endMinute: number; status: Presence };
/** A rough rhythm, not a timetable: edges move by up to `jitterMinutes` per day from a stable seed. */
export type PresenceRoutine = { blocks: readonly RoutineBlock[]; defaultStatus: Presence; jitterMinutes: number };
export type PresenceInputs = {
  characterId: string;
  /** The Character's IANA timezone; invalid or missing falls back to UTC. */
  timezone: string | null;
  routine: PresenceRoutine | null;
  situations: readonly PresenceSituation[];
};
export type EffectivePresence = { status: Presence; source: "situation" | "routine"; situation: PresenceSituation | null };
export type PresenceSegment = EffectivePresence & { startsAt: number; endsAt: number };

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
export const SITUATION_DEFAULT_MS = 6 * HOUR;
export const SITUATION_MAX_MS = 14 * DAY;
export const MAX_JITTER_MINUTES = 120;
export const NEXT_CHANGE_HORIZON_MS = 8 * DAY;
export const LAST_ONLINE_LOOKBACK_MS = 7 * DAY;
const NO_ROUTINE_STATUS: Presence = "offline";

/**
 * Turns a situation proposed by a Character action into stored form: never starts in the past, always
 * ends, defaults a missing end and caps the length. Returns null when the action carries nothing usable.
 */
export function normalizeSituation(draft: { status: unknown; reason?: unknown; startsAt?: unknown; endsAt?: unknown },
  now: number): PresenceSituation | null {
  const status = normalizePresence(draft.status);
  if (status !== draft.status || !Number.isFinite(now)) return null;
  const startsAt = Math.max(now, finite(draft.startsAt) ?? now);
  const requestedEnd = finite(draft.endsAt) ?? startsAt + SITUATION_DEFAULT_MS;
  if (requestedEnd <= startsAt) return null;
  const reason = typeof draft.reason === "string" ? draft.reason.trim().slice(0, 200) || null : null;
  return { status, reason, startsAt, endsAt: Math.min(requestedEnd, startsAt + SITUATION_MAX_MS) };
}

/** The single answer every surface shows: an active situation wins, otherwise the routine with its daily jitter. */
export function effectivePresence(inputs: PresenceInputs, now: number): EffectivePresence {
  const situation = activeSituation(inputs.situations, now);
  if (situation) return { status: situation.status, source: "situation", situation };
  return { status: routineStatus(inputs, now), source: "routine", situation: null };
}

/** The next instant after `now` at which the effective status may change, or null within the horizon. */
export function nextPresenceChange(inputs: PresenceInputs, now: number, horizonMs = NEXT_CHANGE_HORIZON_MS): number | null {
  const current = effectivePresence(inputs, now).status;
  for (const edge of boundaries(inputs, now, now + horizonMs))
    if (effectivePresence(inputs, edge).status !== current) return edge;
  return null;
}

/**
 * The latest instant at or before `now` when the Character was online, looking back a bounded window.
 * `now` itself when online now; null when the window holds no online time.
 */
export function lastOnlineAt(inputs: PresenceInputs, now: number, lookbackMs = LAST_ONLINE_LOOKBACK_MS): number | null {
  if (effectivePresence(inputs, now).status === "online") return now;
  const start = now - lookbackMs;
  const edges = [start, ...boundaries(inputs, start, now)];
  // Status is constant between consecutive edges; walk back to the newest online stretch.
  for (let index = edges.length - 1; index >= 0; index--) {
    const from = edges[index], to = index + 1 < edges.length ? edges[index + 1] : now;
    if (to > from && effectivePresence(inputs, from).status === "online") return to;
  }
  return null;
}

/** Stable local-calendar bounds used by readers that project Presence into a day-sized view. */
export function localDayWindow(instant: number, timezone: string | null, offsetDays = 0) {
  const zone = validTimezone(timezone) ?? "UTC";
  let date = localDate(instant, zone);
  for (let index = 0; index < Math.abs(offsetDays); index++) date = offsetDays < 0
    ? makeDate(date.year, date.month, date.day - 1) : nextDate(date);
  return { key: date.key, startsAt: localInstant(date, 0, zone), endsAt: localInstant(nextDate(date), 0, zone) };
}

/** The instant of a local wall-clock minute of the day (may exceed 1440) on the local day `offsetDays` from `instant`'s. */
export function localWallClock(instant: number, timezone: string | null, minute: number, offsetDays = 0) {
  const zone = validTimezone(timezone) ?? "UTC";
  let date = localDate(instant, zone);
  for (let index = 0; index < Math.abs(offsetDays); index++) date = offsetDays < 0
    ? makeDate(date.year, date.month, date.day - 1) : nextDate(date);
  return localInstant(date, minute, zone);
}

/** A bounded, read-only projection. It does not schedule work or call a model. */
export function presenceSegments(inputs: PresenceInputs, from: number, to: number): PresenceSegment[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const edges = [from, ...boundaries(inputs, from, to).filter((edge) => edge < to), to];
  return edges.slice(0, -1).map((startsAt, index) => ({ ...effectivePresence(inputs, startsAt),
    startsAt, endsAt: edges[index + 1] })).filter((item) => item.endsAt > item.startsAt);
}

function activeSituation(situations: readonly PresenceSituation[], now: number) {
  let active: PresenceSituation | null = null;
  // Situations may overlap: a short one inside a long one is an interruption, and the long one shows again
  // when it ends. The most recently started of those running wins. Storage keeps at most two running at once.
  for (const item of situations)
    if (item.startsAt <= now && now < item.endsAt && (!active || item.startsAt >= active.startsAt)) active = item;
  return active;
}

function routineStatus(inputs: PresenceInputs, now: number): Presence {
  const routine = inputs.routine;
  if (!routine) return NO_ROUTINE_STATUS;
  // A block wins over the default; among overlapping blocks the later one in the list wins.
  let winner: Occurrence | null = null;
  for (const occurrence of occurrences(inputs, now - 2 * DAY, now + DAY))
    if (occurrence.startsAt <= now && now < occurrence.endsAt && (!winner || occurrence.index >= winner.index)) winner = occurrence;
  return winner ? winner.status : routine.defaultStatus;
}

function boundaries(inputs: PresenceInputs, from: number, to: number): number[] {
  const edges = new Set<number>();
  for (const item of inputs.situations) for (const edge of [item.startsAt, item.endsAt]) if (edge > from && edge <= to) edges.add(edge);
  if (inputs.routine) for (const occurrence of occurrences(inputs, from - 2 * DAY, to + DAY))
    for (const edge of [occurrence.startsAt, occurrence.endsAt]) if (edge > from && edge <= to) edges.add(edge);
  return [...edges].sort((a, b) => a - b);
}

type Occurrence = { index: number; status: Presence; startsAt: number; endsAt: number };
/** Every routine block occurrence whose local start date lies in [from, to], with stable per-day jitter. */
function occurrences(inputs: PresenceInputs, from: number, to: number): Occurrence[] {
  const routine = inputs.routine;
  if (!routine) return [];
  const zone = validTimezone(inputs.timezone) ?? "UTC";
  const jitter = Math.max(0, Math.min(MAX_JITTER_MINUTES, Math.floor(routine.jitterMinutes) || 0));
  const result: Occurrence[] = [];
  const first = localDate(from, zone), last = localDate(to, zone);
  for (let day = first; day.key <= last.key; day = nextDate(day)) routine.blocks.forEach((block, index) => {
    if (!block.days.includes(day.weekday)) return;
    const length = (block.endMinute - block.startMinute + 1440) % 1440 || 1440;
    // Each edge moves at most a quarter of the block, so a jittered block never collapses or inverts.
    const spread = Math.min(jitter, Math.floor(length / 4));
    const start = block.startMinute + offset(`${inputs.characterId}|${day.key}|${index}|start`, spread);
    const end = block.startMinute + length + offset(`${inputs.characterId}|${day.key}|${index}|end`, spread);
    result.push({ index, status: block.status,
      startsAt: localInstant(day, start, zone), endsAt: localInstant(day, end, zone) });
  });
  return result;
}

type LocalDate = { year: number; month: number; day: number; weekday: number; key: string };
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(instant: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) formatters.set(zone, formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  const value = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: +value.year, month: +value.month, day: +value.day, hour: +value.hour, minute: +value.minute, second: +value.second };
}
function makeDate(year: number, month: number, day: number): LocalDate {
  const utc = new Date(Date.UTC(year, month - 1, day));
  const [y, m, d] = [utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate()];
  return { year: y, month: m, day: d, weekday: utc.getUTCDay(),
    key: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}
function localDate(instant: number, zone: string) { const p = parts(instant, zone); return makeDate(p.year, p.month, p.day); }
function nextDate(date: LocalDate) { return makeDate(date.year, date.month, date.day + 1); }
/** Offset of `zone` from UTC at an instant, in ms. */
function zoneOffset(instant: number, zone: string) {
  const p = parts(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}
/**
 * The instant of a local wall-clock minute (may exceed one day) on a local date in `zone`. A repeated
 * time (DST fall-back) resolves to the earlier instant; a skipped time (spring-forward) resolves to the
 * transition itself. The mapping never runs backwards, so a block's edges keep their order.
 */
function localInstant(date: LocalDate, minute: number, zone: string) {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, minute);
  const candidates = [naive - zoneOffset(naive - DAY, zone), naive - zoneOffset(naive + DAY, zone)];
  const valid = candidates.filter((instant) => instant + zoneOffset(instant, zone) === naive);
  if (valid.length) return Math.min(...valid);
  // Binary search, by minute, for the first instant on the new offset between the two candidates.
  let low = Math.floor(Math.min(...candidates) / MINUTE), high = Math.ceil(Math.max(...candidates) / MINUTE);
  const before = zoneOffset(low * MINUTE, zone);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (zoneOffset(middle * MINUTE, zone) === before) low = middle; else high = middle;
  }
  return high * MINUTE;
}

/** Stable integer in [-spread, spread] from a string seed (FNV-1a). */
function offset(seed: string, spread: number) {
  if (spread <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193);
  return (hash >>> 0) % (2 * spread + 1) - spread;
}
function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
