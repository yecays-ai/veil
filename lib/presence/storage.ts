import { PRESENCE_VALUES, type Presence } from "../foundation-types";
import type { StringStorage } from "../storage-types";
import { LAST_ONLINE_LOOKBACK_MS, MAX_JITTER_MINUTES, SITUATION_MAX_MS,
  type PresenceRoutine, type PresenceSituation } from "./compute";

// Per-Character Presence data: the routine, a few situations, the signature's change mark and the two
// Last Seen values. Its own storage domain; it never reads or writes Character, chat or Contact data, and
// the Character's old `presence` field is left alone. Reading never writes.

export const PRESENCE_STORAGE_KEY = "veil.presence.v1";
export const PRESENCE_CHANGE_EVENT = "veil-presence-change";
export const MAX_STORED_SITUATIONS = 8;
const MAX_ROUTINE_BLOCKS = 24;
const MAX_FUTURE_SKEW_MS = 60_000;

/** When something changed and what caused it (a message ID, or a short tag such as "generated"). */
export type ChangeMark = { changedAt: number; source: string | null };
export type StoredRoutine = ChangeMark & { routine: PresenceRoutine };
export type StoredSituation = PresenceSituation & ChangeMark;
export type PresenceRecord = {
  characterId: string;
  routine: StoredRoutine | null;
  /**
   * Ordered by start, each with its own original end. At most two run at once: a longer base (a trip) and one
   * shorter interruption on top (a call); the calculator shows the one that started last, and the base shows
   * again when the interruption ends. At most one has not started yet. Ended ones are kept only for the Last
   * Seen look-back.
   */
  situations: StoredSituation[];
  /** Only the change mark: the signature text itself stays on the Character. */
  signature: ChangeMark | null;
  /** When and from which message the Character last changed its own situation (set, ended or cancelled one); drives its cooldown. Absent until it first does, so older data and backups read unchanged. */
  situationChange?: ChangeMark;
  /** Latest simulated online time, and latest time the Character sent a message. Neither ever goes down. */
  lastOnlineAt: number | null;
  lastMessageAt: number | null;
};
export type PresenceDocument = { version: 1; characters: PresenceRecord[] };

const emptyRecord = (characterId: string): PresenceRecord =>
  ({ characterId, routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null });
export const emptyPresenceDocument = (): PresenceDocument => ({ version: 1, characters: [] });

function validId(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= 100 &&
    !["__proto__", "constructor", "prototype"].includes(value);
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const time = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const status = (value: unknown): value is Presence => (PRESENCE_VALUES as readonly unknown[]).includes(value);
const sourceOf = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 100) || null : null;
const markOf = (value: unknown, fallback = 0): ChangeMark => {
  const raw = record(value);
  return { changedAt: time(raw.changedAt) ?? fallback, source: sourceOf(raw.source) };
};

/** Null when anything is out of range: a half-valid routine would change behavior silently. */
export function normalizeRoutine(value: unknown): PresenceRoutine | null {
  const raw = record(value);
  if (!status(raw.defaultStatus) || !Array.isArray(raw.blocks) || raw.blocks.length > MAX_ROUTINE_BLOCKS) return null;
  const blocks = [];
  for (const item of raw.blocks) {
    const block = record(item);
    const minute = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1440;
    if (!Array.isArray(block.days) || !block.days.length || !block.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      || !minute(block.startMinute) || !minute(block.endMinute) || !status(block.status)) return null;
    blocks.push({ days: [...new Set(block.days as number[])].sort(), startMinute: block.startMinute as number,
      endMinute: block.endMinute as number, status: block.status });
  }
  const jitter = typeof raw.jitterMinutes === "number" && Number.isFinite(raw.jitterMinutes) ? raw.jitterMinutes : 0;
  return { blocks, defaultStatus: raw.defaultStatus, jitterMinutes: Math.max(0, Math.min(MAX_JITTER_MINUTES, Math.floor(jitter))) };
}
function normalizeStoredSituation(value: unknown): StoredSituation | null {
  const raw = record(value), startsAt = time(raw.startsAt), endsAt = time(raw.endsAt);
  if (!status(raw.status) || startsAt === null || endsAt === null || endsAt <= startsAt || endsAt - startsAt > SITUATION_MAX_MS) return null;
  const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 200) || null : null;
  return { status: raw.status, reason, startsAt, endsAt, ...markOf(raw, startsAt) };
}
/**
 * Keeps at most two situations running at any instant: a base and the interruption on top of it. A situation
 * that starts while two are running ends the upper one at that moment and leaves the base alone; one that
 * starts exactly when another does replaces it (the later change wins). Original end times are otherwise
 * kept, so a base resumes after an interruption. The result is the same for any stored order.
 */
function layers(items: StoredSituation[]): StoredSituation[] {
  const sorted = items.map((item) => ({ ...item })).sort((a, b) => a.startsAt - b.startsAt || a.changedAt - b.changedAt);
  let running: StoredSituation[] = [];
  for (const next of sorted) {
    running = running.filter((item) => item.endsAt > next.startsAt);
    if (running.length && running[running.length - 1].startsAt === next.startsAt) running.pop()!.endsAt = next.startsAt;
    if (running.length >= 2) running.pop()!.endsAt = next.startsAt;
    running.push(next);
  }
  return sorted.filter((item) => item.endsAt > item.startsAt);
}
function normalizeRecord(value: unknown): PresenceRecord | null {
  const raw = record(value);
  if (!validId(raw.characterId)) return null;
  const routine = normalizeRoutine(record(raw.routine).routine);
  const situations = layers((Array.isArray(raw.situations) ? raw.situations : []).flatMap((item) => normalizeStoredSituation(item) ?? []));
  return { characterId: raw.characterId,
    routine: routine ? { routine, ...markOf(raw.routine) } : null, situations,
    signature: raw.signature ? markOf(raw.signature) : null,
    ...(raw.situationChange ? { situationChange: markOf(raw.situationChange) } : {}),
    lastOnlineAt: time(raw.lastOnlineAt), lastMessageAt: time(raw.lastMessageAt) };
}
export function normalizePresenceDocument(value: unknown): PresenceDocument {
  const seen = new Set<string>();
  const characters = (Array.isArray(record(value).characters) ? record(value).characters as unknown[] : []).flatMap((item) => {
    const next = normalizeRecord(item);
    if (!next || seen.has(next.characterId)) return [];
    seen.add(next.characterId);
    return [next];
  });
  return { version: 1, characters };
}

export const presenceRecord = (document: PresenceDocument, characterId: string): PresenceRecord | undefined =>
  document.characters.find((item) => item.characterId === characterId);

// The updaters below are pure. Each returns the very same document when it changes nothing, so a caller
// (and the storage) can skip the write. Invalid input throws rather than being stored half-valid.
function update(document: PresenceDocument, characterId: string, change: (current: PresenceRecord) => PresenceRecord): PresenceDocument {
  if (!validId(characterId)) throw new Error("Invalid Character ID.");
  const current = presenceRecord(document, characterId) ?? emptyRecord(characterId), next = change(current);
  if (next === current) return document;
  return { ...document, characters: document.characters.some((item) => item.characterId === characterId)
    ? document.characters.map((item) => item.characterId === characterId ? next : item) : [...document.characters, next] };
}
export function setRoutine(document: PresenceDocument, characterId: string, routine: PresenceRoutine, mark: ChangeMark): PresenceDocument {
  const valid = normalizeRoutine(routine);
  if (!valid) throw new Error("Invalid routine.");
  return update(document, characterId, (current) => ({ ...current, routine: { routine: valid, ...markOf(mark) } }));
}
const isRunning = (item: PresenceSituation, now: number) => item.startsAt <= now && now < item.endsAt;
const isUpcoming = (item: PresenceSituation, now: number) => item.startsAt > now;
/**
 * Adds a situation already normalized by `normalizeSituation`. It does not shorten what is running: when it
 * ends, a longer situation under it shows again (see `layers` for the two-layer limit). Only one situation
 * may be upcoming: a new upcoming one replaces the old one, a current one leaves it alone (`cancelUpcoming`
 * removes it). Situations that ended before the Last Seen look-back are dropped, and the size cap only
 * trims ended ones, never one that is running or has not started.
 */
export function addSituation(document: PresenceDocument, characterId: string, situation: PresenceSituation,
  mark: ChangeMark, now: number): PresenceDocument {
  const added = normalizeStoredSituation({ ...situation, ...markOf(mark, now) });
  if (!added) throw new Error("Invalid situation.");
  return update(document, characterId, (current) => {
    const kept = current.situations.filter((item) => item.endsAt > now - LAST_ONLINE_LOOKBACK_MS)
      .filter((item) => !(isUpcoming(added, now) && isUpcoming(item, now)));
    const all = layers([...kept, added]), ended = all.filter((item) => item.endsAt <= now);
    const dropped = new Set(ended.slice(0, Math.max(0, all.length - MAX_STORED_SITUATIONS)));
    return { ...current, situations: all.filter((item) => !dropped.has(item)) };
  });
}
/** Removes the situation that has not started yet, if any. Running and ended ones are untouched. */
export function cancelUpcoming(document: PresenceDocument, characterId: string, now: number): PresenceDocument {
  return update(document, characterId, (current) => current.situations.some((item) => isUpcoming(item, now))
    ? { ...current, situations: current.situations.filter((item) => !isUpcoming(item, now)) } : current);
}
/**
 * Ends running situations at `now`: "current" only the one showing now (a base under it shows again),
 * "all" every running layer (the Character is back on its routine). An upcoming situation is not touched.
 */
export function endSituation(document: PresenceDocument, characterId: string, now: number, scope: "current" | "all"): PresenceDocument {
  return update(document, characterId, (current) => {
    const running = current.situations.filter((item) => isRunning(item, now));
    if (!running.length) return current;
    const ending = scope === "all" ? new Set(running) : new Set(running.slice(-1));
    return { ...current, situations: current.situations.flatMap((item) =>
      !ending.has(item) ? [item] : item.startsAt < now ? [{ ...item, endsAt: now }] : []) };
  });
}
export function markSignatureChange(document: PresenceDocument, characterId: string, mark: ChangeMark): PresenceDocument {
  return update(document, characterId, (current) => ({ ...current, signature: markOf(mark) }));
}
export function markSituationChange(document: PresenceDocument, characterId: string, mark: ChangeMark): PresenceDocument {
  return update(document, characterId, (current) => ({ ...current, situationChange: markOf(mark) }));
}
/** Raises Last Seen values; lower, equal, invalid or future (beyond a small clock skew) values are ignored. */
export function advanceLastSeen(document: PresenceDocument, characterId: string,
  values: { lastOnlineAt?: number | null; lastMessageAt?: number | null }, now: number): PresenceDocument {
  const raise = (stored: number | null, incoming: number | null | undefined) => {
    const next = time(incoming);
    return next !== null && next <= now + MAX_FUTURE_SKEW_MS && (stored === null || next > stored) ? next : stored;
  };
  return update(document, characterId, (current) => {
    const lastOnlineAt = raise(current.lastOnlineAt, values.lastOnlineAt), lastMessageAt = raise(current.lastMessageAt, values.lastMessageAt);
    return lastOnlineAt === current.lastOnlineAt && lastMessageAt === current.lastMessageAt ? current : { ...current, lastOnlineAt, lastMessageAt };
  });
}
export function removePresence(document: PresenceDocument, characterId: string): PresenceDocument {
  return presenceRecord(document, characterId)
    ? { ...document, characters: document.characters.filter((item) => item.characterId !== characterId) } : document;
}

const WRITE_ATTEMPTS = 3;
/**
 * Every write is one read-modify-write of the whole Presence document, coordinated like Contacts and Bindings:
 * 1. This instance runs its own writes in order.
 * 2. Across tabs each write holds an exclusive Web Lock (`PRESENCE_STORAGE_KEY`), so cooperating tabs never
 *    interleave. Without Web Locks (`getLocks()` undefined) only levels 1 and 3 apply.
 * 3. Just before writing, the stored value is re-read; if another context changed it, the update is recomputed
 *    (at most WRITE_ATTEMPTS times, then the write fails and saves nothing).
 * An update that changes nothing writes nothing and notifies no one. Stored data that cannot be read, or was
 * saved by a newer version, makes the read and every write fail; it is never replaced with an empty document.
 */
export function createPresenceStorage(getStorage: () => StringStorage,
  getLocks: () => Pick<LockManager, "request"> | undefined = () => globalThis.navigator?.locks) {
  let queue: Promise<unknown> = Promise.resolve();
  const parse = (raw: string | null): PresenceDocument => {
    const value: unknown = raw ? JSON.parse(raw) : null;
    const version = record(value).version;
    if (typeof version === "number" && version > 1) throw new Error("Presence data was saved by a newer version of VEIL. Nothing was changed.");
    return normalizePresenceDocument(value);
  };
  const load = async () => parse(getStorage().getItem(PRESENCE_STORAGE_KEY));
  const commit = (change: (current: PresenceDocument) => PresenceDocument): PresenceDocument => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const before = getStorage().getItem(PRESENCE_STORAGE_KEY), current = parse(before);
      const next = normalizePresenceDocument(change(current)), serialized = JSON.stringify(next);
      if (getStorage().getItem(PRESENCE_STORAGE_KEY) !== before) continue;
      if (serialized === before || (before === null && !next.characters.length)) return next;
      getStorage().setItem(PRESENCE_STORAGE_KEY, serialized);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(PRESENCE_CHANGE_EVENT));
      return next;
    }
    throw new Error("Presence changed in another tab. Nothing was saved; try again.");
  };
  const transact = (change: (current: PresenceDocument) => PresenceDocument) => {
    const run = async () => {
      const locks = getLocks();
      return locks ? await locks.request(PRESENCE_STORAGE_KEY, { mode: "exclusive" }, async () => commit(change)) : commit(change);
    };
    const operation = queue.then(run, run);
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  return { load, transact };
}
export type PresenceStorage = ReturnType<typeof createPresenceStorage>;
export const browserPresenceStorage = createPresenceStorage(() => window.localStorage);
