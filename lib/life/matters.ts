import { LIFE_THREAD_ACTIVE_LIMIT, LIFE_THREAD_PAUSED_LIMIT, LIFE_THREAD_TEXT_LIMIT, LIFE_TITLE_LIMIT, type LifeThread } from "./activity";

// Matters: things in the Character's life that run longer than a day (a project, a worry, a plan with someone). They are
// written only by the day plan; chat replies read the active ones. Nothing here calls a model or runs on a timer.

const DAY_MS = 86_400_000;
export const MATTER_IDLE_PAUSE_MS = 14 * DAY_MS;
export const MATTER_PAUSED_EXPIRE_MS = 30 * DAY_MS;
const MAX_UPDATES = 6;

export type MatterUpdate =
  | { do: "continue"; matter: string; progress?: string; next?: string }
  | { do: "pause" | "finish" | "cancel"; matter: string }
  | { do: "new"; title: string; progress: string; next: string };

/**
 * The matters as of `now`: a paused one untouched for 30 days is gone, and an active one untouched for 14 days is paused
 * (kept active instead when the paused list is full, so nothing is dropped to make room). Idempotent for a fixed `now`.
 */
export function settleMatters(threads: readonly LifeThread[] | undefined, now: number): LifeThread[] {
  const kept = (threads ?? []).filter((item) => item.state === "active" || now - item.updatedAt < MATTER_PAUSED_EXPIRE_MS);
  let paused = kept.filter((item) => item.state === "paused").length;
  return kept.map((item) => {
    if (item.state !== "active" || now - item.updatedAt < MATTER_IDLE_PAUSE_MS || paused >= LIFE_THREAD_PAUSED_LIMIT) return item;
    paused++;
    return { ...item, state: "paused" as const, updatedAt: now };
  });
}

/** Codes M1, M2… in creation order: the Character names a matter by code in the day plan; the caller maps them back to ids. */
export const matterCodes = (threads: readonly LifeThread[]) => threads.map((item, index) => ({ code: `M${index + 1}`, ...item }));

const text = (value: unknown, limit: number) => typeof value === "string" && value.trim() && value.trim().length <= limit ? value.trim() : null;

/** Reads the `matters` list of the day-plan reply. Invalid entries are skipped; a missing or malformed list means no change. */
export function parseMatterUpdates(reply: string): MatterUpdate[] {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let list: unknown;
  try { list = (JSON.parse(reply.slice(start, end + 1)) as { matters?: unknown } | null)?.matters; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const result: MatterUpdate[] = [];
  for (const item of list.slice(0, MAX_UPDATES)) {
    const raw = item as Record<string, unknown> | null, action = typeof raw?.do === "string" ? raw.do.trim().toLowerCase() : "";
    const progress = text(raw?.progress, LIFE_THREAD_TEXT_LIMIT), next = text(raw?.next, LIFE_THREAD_TEXT_LIMIT);
    if (action === "new") {
      const title = text(raw?.title, LIFE_TITLE_LIMIT);
      if (title && progress && next) result.push({ do: "new", title, progress, next });
      continue;
    }
    const matter = typeof raw?.matter === "string" && /^M\d{1,2}$/.test(raw.matter.trim()) ? raw.matter.trim() : null;
    if (!matter) continue;
    if (action === "pause" || action === "finish" || action === "cancel") result.push({ do: action, matter });
    else if (action === "continue" && (progress || next)) result.push({ do: "continue", matter, ...(progress ? { progress } : {}), ...(next ? { next } : {}) });
  }
  return result;
}

/**
 * Applies the day plan's matter updates to the stored matters. `codes` maps the codes shown in the prompt to ids. A new
 * matter is active while fewer than 3 are, otherwise paused while fewer than 5 are, otherwise refused. Resuming a paused
 * matter needs a free active place. Finished and cancelled matters leave. Returns undefined when nothing is left.
 */
export function applyMatterUpdates(threads: readonly LifeThread[] | undefined, updates: readonly MatterUpdate[],
  codes: ReadonlyMap<string, string>, now: number, idPrefix: string): LifeThread[] | undefined {
  let list = settleMatters(threads, now);
  const count = (state: LifeThread["state"]) => list.filter((item) => item.state === state).length;
  let created = 0;
  // Updates that free an active place (finish, cancel, pause) run first, then resumes, then new matters, so the order the
  // model happened to write them in cannot lose a resume or let a new matter take a place a resume needed.
  const rank = (update: MatterUpdate) => update.do === "continue" ? 1 : update.do === "new" ? 2 : 0;
  for (const update of [...updates].sort((a, b) => rank(a) - rank(b))) {
    if (update.do === "new") {
      const state = count("active") < LIFE_THREAD_ACTIVE_LIMIT ? "active" : count("paused") < LIFE_THREAD_PAUSED_LIMIT ? "paused" : null;
      let id = `${idPrefix}:${now}:${created++}`;
      while (list.some((item) => item.id === id)) id = `${idPrefix}:${now}:${created++}`;
      if (state) list = [...list, { id, title: update.title, progress: update.progress, next: update.next, state,
        createdAt: now, updatedAt: now }];
      continue;
    }
    const id = codes.get(update.matter), target = list.find((item) => item.id === id);
    if (!target) continue;
    if (update.do === "finish" || update.do === "cancel") list = list.filter((item) => item !== target);
    else if (update.do === "pause") {
      if (target.state === "active" && count("paused") < LIFE_THREAD_PAUSED_LIMIT)
        list = list.map((item) => item === target ? { ...item, state: "paused", updatedAt: now } : item);
    } else if (update.do === "continue" && (target.state === "active" || count("active") < LIFE_THREAD_ACTIVE_LIMIT)) {
      const { progress, next } = update;
      list = list.map((item) => item === target ? { ...item, state: "active", updatedAt: now,
        ...(progress ? { progress } : {}), ...(next ? { next } : {}) } : item);
    }
  }
  return list.length ? list : undefined;
}

/** The active matters, oldest first: what chat replies may know. Paused ones are not shown outside the day plan. */
export const activeMatters = (threads: readonly LifeThread[] | undefined, now: number) =>
  settleMatters(threads, now).filter((item) => item.state === "active");
