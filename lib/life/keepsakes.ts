import { LIFE_KEEPSAKE_LIMIT, LIFE_KEEPSAKE_TEXT_LIMIT, type LifeKeepsake } from "./activity";

// Keepsakes: the few experiences the Character itself judges to matter in the long run, with how much (1 low to 5 high).
// Written by the day plan and by one chat action; read by the day plan and (the top few) by chat replies. This is its own
// small record, kept apart from the Memory feature, which it neither reads nor writes.

const MAX_UPDATES = 4;
export const CHAT_KEEPSAKES = 5;

export type KeepsakeUpdate = { do: "add"; text: string; weight: LifeKeepsake["weight"] } | { do: "retire"; keepsake: string };
export type KeepsakeDraft = { text: string; weight: LifeKeepsake["weight"] };

const weightOf = (value: unknown): LifeKeepsake["weight"] | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value as LifeKeepsake["weight"] : null;
const textOf = (value: unknown) => {
  const text = typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim() : "";
  return text && text.length <= LIFE_KEEPSAKE_TEXT_LIMIT ? text : null;
};
/** One keepsake as the chat action carries it; null when text or weight is unusable. */
export const keepsakeDraft = (value: { text?: unknown; weight?: unknown }): KeepsakeDraft | null => {
  const text = textOf(value.text), weight = weightOf(value.weight);
  return text && weight ? { text, weight } : null;
};

/** Codes K1, K2… in creation order, so the day plan can retire one by code; the caller maps them back to ids. */
export const keepsakeCodes = (list: readonly LifeKeepsake[] | undefined) => (list ?? []).map((item, index) => ({ code: `K${index + 1}`, ...item }));

/** Reads the `keepsakes` list of the day-plan reply. Invalid entries are skipped; a missing or malformed list means no change. */
export function parseKeepsakeUpdates(reply: string): KeepsakeUpdate[] {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let list: unknown;
  try { list = (JSON.parse(reply.slice(start, end + 1)) as { keepsakes?: unknown } | null)?.keepsakes; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const result: KeepsakeUpdate[] = [];
  for (const item of list.slice(0, MAX_UPDATES)) {
    const raw = item as Record<string, unknown> | null;
    if (typeof raw?.retire === "string" && /^K\d{1,2}$/.test(raw.retire.trim())) { result.push({ do: "retire", keepsake: raw.retire.trim() }); continue; }
    const draft = keepsakeDraft({ text: raw?.add, weight: raw?.weight });
    if (draft) result.push({ do: "add", ...draft });
  }
  return result;
}

/**
 * Adds one keepsake. The same text again only raises its weight. With 20 kept, the lowest-weight oldest one is replaced
 * only if the new one weighs at least as much; otherwise the new one is refused (null) and nothing already kept is lost.
 */
export function addKeepsake(list: readonly LifeKeepsake[], draft: KeepsakeDraft, now: number, id: string): LifeKeepsake[] | null {
  const same = list.find((item) => item.text.toLowerCase() === draft.text.toLowerCase());
  if (same) return same.weight >= draft.weight ? [...list] : list.map((item) => item === same ? { ...item, weight: draft.weight, updatedAt: now } : item);
  const fresh: LifeKeepsake = { id, text: draft.text, weight: draft.weight, createdAt: now, updatedAt: now };
  if (list.length < LIFE_KEEPSAKE_LIMIT) return [...list, fresh];
  const lowest = [...list].sort((a, b) => a.weight - b.weight || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
  return draft.weight >= lowest.weight ? [...list.filter((item) => item !== lowest), fresh] : null;
}

/** Applies the day plan's updates: retires first, then adds from the heaviest, so a full list keeps what matters most. */
export function applyKeepsakeUpdates(list: readonly LifeKeepsake[] | undefined, updates: readonly KeepsakeUpdate[],
  codes: ReadonlyMap<string, string>, now: number, idPrefix: string): LifeKeepsake[] | undefined {
  let next = [...(list ?? [])], created = 0;
  for (const update of updates) if (update.do === "retire") { const id = codes.get(update.keepsake); next = next.filter((item) => item.id !== id); }
  const adds = updates.filter((update): update is Extract<KeepsakeUpdate, { do: "add" }> => update.do === "add").sort((a, b) => b.weight - a.weight);
  for (const update of adds) {
    let id = `${idPrefix}:${now}:${created++}`;
    while (next.some((item) => item.id === id)) id = `${idPrefix}:${now}:${created++}`;
    next = addKeepsake(next, update, now, id) ?? next;
  }
  return next.length ? next : undefined;
}

/** What chat replies may recall: the heaviest few, newest first among equals. Importance beats age. */
export const topKeepsakes = (list: readonly LifeKeepsake[] | undefined, limit = CHAT_KEEPSAKES) =>
  [...(list ?? [])].sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, limit);
