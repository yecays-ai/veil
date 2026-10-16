import { localDayWindow } from "../presence/compute";
import { presenceRecord, setLifeState, type PresenceDocument } from "../presence/storage";
import { lifeLive, lifeMomentRevealAt, type LifeActivity, type LifeState } from "./activity";

// The Character changing its own day from a chat reply. Only rows it was shown with a code can be changed, one change per
// reply, paced by `LifeState.actedAt`. What already happened is never rewritten: a running activity is cut at now.

export const LIFE_EDIT_COOLDOWN_MS = 30 * 60_000;
export const LIFE_DELAY_MIN_MINUTES = 5;
export const LIFE_DELAY_MAX_MINUTES = 240;
const MIN_ROW_MS = 15 * 60_000;
const MAX_CHOICES = 5;

export type LifeChoice = { code: string; id: string; running: boolean; title: string; startsAt: number; endsAt: number };
export type LifeEdit = { action: "delay" | "cancel" | "replace" | "detail"; id: string; minutes?: number; title?: string; moment?: string };

export const lifeEditReady = (life: LifeState | undefined, now: number) => life?.actedAt === undefined || now - life.actedAt >= LIFE_EDIT_COOLDOWN_MS;

/** What the Character may change in this reply: the activity under way and its own plan rows still ahead today, each with a code valid for this reply only. */
export function lifeChoices(life: LifeState | undefined, now: number, timezone: string | null, limit = MAX_CHOICES): LifeChoice[] {
  if (!lifeEditReady(life, now)) return [];
  const live = lifeLive(life?.activities ?? []), end = localDayWindow(now, timezone).endsAt;
  const current = live.find((item) => item.startsAt <= now && now < item.endsAt);
  const rows = [...(current ? [current] : []), ...live.filter((item) => item.origin === "plan" && item.startsAt > now && item.startsAt < end)].slice(0, Math.max(0, limit));
  return rows.map((item, index) => ({ code: `L${index + 1}`, id: item.id, running: item === current, title: item.title,
    startsAt: item.startsAt, endsAt: item.endsAt }));
}

/** The running row cut at `now`; its Moment stays only if it had already been revealed. Null when nothing has happened yet. */
function cutAt(row: LifeActivity, at: number, now: number): LifeActivity | null {
  if (at - row.startsAt < 60_000) return null;
  const { moment, ...rest } = row;
  return { ...rest, endsAt: at, ...(moment && lifeMomentRevealAt(row) <= now && lifeMomentRevealAt({ ...row, endsAt: at }) <= now ? { moment } : {}) };
}

/**
 * Applies one change to the Character's stored Life, or returns the document untouched when it is not allowed: a row it was
 * never offered, a finished or cancelled one, someone else's, a second change inside the cooldown, or a result that would
 * not be a valid Life. Delay and cancel work on plan rows not yet started; replace on those or the running activity;
 * detail adds one small thing to the running activity and never overwrites one.
 */
export function applyLifeEdit(document: PresenceDocument, characterId: string, edit: LifeEdit, now: number, messageId: string): PresenceDocument {
  const record = presenceRecord(document, characterId), life = record?.life;
  if (!life || !lifeEditReady(life, now)) return document;
  const row = life.activities.find((item) => item.id === edit.id && item.state !== "cancelled");
  if (!row || row.endsAt <= now) return document;
  const running = row.startsAt <= now, planned = row.origin === "plan" && !running;
  const others = life.activities.filter((item) => item !== row);
  let next: LifeActivity[] | null = null;

  if (edit.action === "cancel") {
    if (planned) next = [...others, { ...row, state: "cancelled" as const }];
    else if (running) { const head = cutAt(row, now, now); next = [...others, head ?? { ...row, state: "cancelled" as const }]; }
  } else if (edit.action === "replace" && edit.title) {
    if (planned) { const { moment: _unrevealed, ...rest } = row; void _unrevealed; next = [...others, { ...rest, title: edit.title }]; }
    else if (running) {
      const head = cutAt(row, now, now);
      const { moment: _gone, ...rest } = row; void _gone;
      const tail: LifeActivity = { ...rest, id: `life:${characterId}:chat:${messageId}`, occurrenceKey: `${characterId}|chat|${messageId}`,
        title: edit.title, startsAt: now, endsAt: row.endsAt, origin: "plan" };
      next = [...others, ...(head ? [head] : []), ...(head ? [tail] : [{ ...rest, title: edit.title }])];
    }
  } else if (edit.action === "detail" && edit.moment) {
    if (running && !row.moment) next = [...others, { ...row, moment: edit.moment }];
  } else if (edit.action === "delay" && planned && edit.minutes && Number.isInteger(edit.minutes)
    && edit.minutes >= LIFE_DELAY_MIN_MINUTES && edit.minutes <= LIFE_DELAY_MAX_MINUTES) {
    const shift = edit.minutes * 60_000, startsAt = row.startsAt + shift;
    const situations = record?.situations ?? [];
    let endsAt = row.endsAt + shift;
    // Later plan rows and Situations keep their time; the moved row gives way to them.
    const blockers = [...others.filter((item) => item.state !== "cancelled" && item.origin === "plan" && item.endsAt > startsAt).map((item) => [item.startsAt, item.endsAt]),
      ...situations.filter((item) => item.endsAt > startsAt).map((item) => [item.startsAt, item.endsAt])];
    if (!blockers.some(([from, to]) => from <= startsAt && startsAt < to)) {
      for (const [from] of blockers) if (from > startsAt && from < endsAt) endsAt = from;
      if (endsAt - startsAt >= MIN_ROW_MS) {
        const moved: LifeActivity = { ...row, startsAt, endsAt };
        // Routine rows in the way give way to it; one already running is cut where the moved row begins.
        next = [...others.flatMap((item): LifeActivity[] => {
          if (item.state === "cancelled" || item.origin === "plan" || item.endsAt <= startsAt || item.startsAt >= endsAt) return [item];
          if (item.startsAt >= now) return [];
          const head = cutAt(item, startsAt, now);
          return head ? [head] : [];
        }), moved];
      }
    }
  }
  if (!next) return document;
  try {
    return setLifeState(document, characterId, { ...life, activities: next.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id)), actedAt: now });
  } catch { return document; }
}
