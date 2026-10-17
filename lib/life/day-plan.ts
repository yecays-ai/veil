import { universeForCharacter, characterUniverseId } from "../universe";
import { browserApiConfigStorage } from "../api-config-storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { browserBindingStorage } from "../binding-storage";
import { normalizeBindingSlot, type BindingDocument } from "../bindings";
import { isTruncatedReason } from "../chat/types";
import { openAITextProvider, validateApiConfig, type TextProvider } from "../chat/provider";
import { createCompletionRequestContext, logPromptSummary } from "../chat/request-diagnostics";
import { browserFoundationStorage } from "../foundation-storage";
import type { Character, FoundationDocument } from "../foundation-types";
import { presetForBinding, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { localDayWindow, localWallClock, type PresenceInputs } from "../presence/compute";
import { browserPresenceStorage, presenceRecord, setLifeState, type PresenceDocument } from "../presence/storage";
import { LIFE_ACTIVITY_KINDS, LIFE_MOMENT_LIMIT, LIFE_TITLE_LIMIT, lifeLive, lifeMomentRevealAt, reconcileLifeActivities,
  type LifeActivity, type LifeActivityKind, type LifeState } from "./activity";
import { applyKeepsakeUpdates, keepsakeCodes, parseKeepsakeUpdates, type KeepsakeUpdate } from "./keepsakes";
import { applyMatterUpdates, matterCodes, parseMatterUpdates, settleMatters, type MatterUpdate } from "./matters";
import { projectDailyLife } from "./plan";
import { settleLifeDocument } from "./settle";

// The day plan: once per Character per local day, on demand, the model writes the rest of today's life. Nothing here
// runs on a timer. A day is claimed before the request and never claimed twice, so repeated opens, two tabs and a
// failed request cost at most one request that day. The Routine stays the skeleton that fills whatever the plan leaves.

export const DAY_PLAN_MAX_TOKENS = 3000;
export const DAY_PLAN_TIMEOUT_MS = 90_000;
/** A claim older than this was left by a closed page; the day may be claimed again. */
export const DAY_PLAN_CLAIM_TTL_MS = 2 * 60_000;
const MAX_ROWS = 8, MIN_ROW_MS = 15 * 60_000, MAX_ROW_MS = 12 * 60 * 60_000, SNAP_START_MS = 60 * 60_000;
const MAX_REPLY_CHARACTERS = 8_000, FIELD_LIMIT = 1_500, WORLD_LIMIT = 1_500, RELATION_LIMIT = 6, RELATION_TEXT_LIMIT = 200;

const field = (value: string | null | undefined, limit = FIELD_LIMIT) => value?.trim().slice(0, limit) || "unspecified";
const clock = (instant: number, timezone: string | null) => {
  const options = { hourCycle: "h23", hour: "2-digit", minute: "2-digit" } as const;
  try { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone ?? undefined }).format(instant); }
  catch { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(instant); }
};

type PromptInput = {
  character: Character; universe: FoundationDocument["universe"]; characters: readonly Pick<Character, "characterId" | "name">[];
  inputs: PresenceInputs; life: LifeState | undefined; now: number;
};

function relationLines(input: PromptInput) {
  const names = new Map(input.characters.map((item) => [item.characterId, item.name] as const));
  return input.universe.relations.flatMap((relation) => {
    const mine = relation.characterAId === input.character.characterId, theirs = relation.characterBId === input.character.characterId;
    if (!mine && !theirs) return [];
    const other = names.get(mine ? relation.characterBId : relation.characterAId);
    if (!other) return [];
    const context = (mine ? relation.aToBContext : relation.bToAContext)?.trim();
    return [`- ${field(other, 100)}: ${field(relation.label, 80)}${context ? ` (${context.slice(0, RELATION_TEXT_LIMIT)})` : ""}`];
  }).slice(0, RELATION_LIMIT);
}

export function dayPlanPrompt(input: PromptInput) {
  const { character, inputs, now } = input, zone = character.timezone;
  const day = localDayWindow(now, zone);
  const skeleton = projectDailyLife(inputs, now).filter((item) => item.endsAt > day.startsAt && item.startsAt < day.endsAt)
    .map((item) => `${clock(item.startsAt, zone)}–${clock(item.endsAt, zone)} ${item.title}`);
  const situations = inputs.situations.filter((item) => item.endsAt > now)
    .map((item) => `${clock(item.startsAt, zone)}–${clock(item.endsAt, zone)} ${item.status}${item.reason ? `: ${item.reason}` : ""}`);
  const recent = [...new Set(lifeLive(input.life?.activities ?? []).filter((item) => item.endsAt <= now && item.endsAt > now - 3 * 86_400_000)
    .map((item) => item.title))].slice(-12);
  const relations = relationLines(input);
  const matters = matterCodes(settleMatters(input.life?.threads, now));
  const keepsakes = keepsakeCodes(input.life?.keepsakes);
  const lines = [
    `Write the rest of today for ${field(character.name, 100)}, a fictional character, as the things they do between now and the end of the day, in their own local time.`,
    `Occupation: ${field(character.occupation, 200)}`,
    `Backstory: ${field(character.backstory)}`,
    `Personality: ${field(character.personality)}`,
    `Speaking style: ${field(character.speakingStyle, 300)}`,
    `World: ${field(input.universe.name, 100)}. ${field(input.universe.worldSetting, WORLD_LIMIT)}`,
    ...(relations.length ? ["People close to them:", ...relations] : []),
    `Now: ${day.key} ${clock(now, zone)} (${zone ?? "UTC"}).`,
    ...(skeleton.length ? ["Their usual rhythm today:", ...skeleton] : []),
    ...(situations.length ? ["Already fixed, do not plan over these:", ...situations] : []),
    ...(recent.length ? [`Recent days: ${recent.join("; ")}`] : []),
    ...(matters.length ? ["Matters in their life that run over several days (code: title. progress so far. next step):",
      ...matters.map((item) => `${item.code}${item.state === "paused" ? " (paused)" : ""}: ${item.title}. ${item.progress}. Next: ${item.next}`)] : []),
    ...(keepsakes.length ? ["Things they have kept as lasting experiences (code, weight 1-5: what):",
      ...keepsakes.map((item) => `${item.code} (${item.weight}): ${item.text}`)] : []),
    "Reply with one JSON object and nothing else:",
    '{"activities":[{"start":"HH:MM","end":"HH:MM","kind":"meal","title":"Lunch with a colleague","moment":"One small thing that happened, optional."}],"matters":[{"do":"continue","matter":"M1","progress":"What moved today.","next":"What comes next."}],"keepsakes":[{"add":"A lasting experience in one sentence.","weight":3}]}',
    `Rules: kind is one of ${LIFE_ACTIVITY_KINDS.join(", ")}. Times are 24-hour HH:MM in their local time; an end earlier than its start runs past midnight. At most ${MAX_ROWS} activities, in order, not overlapping, each between 15 minutes and 12 hours. The first starts now or within the next hour.`,
    "Titles are short (a few words). moment is one small concrete thing, optional. This is an ordinary day shaped by their rhythm and character; nothing special has to happen. Follow the usual rhythm unless there is a reason to differ.",
    "matters is optional and usually empty. Use it only when something in their life really moved or ended: do is continue (matter, progress and/or next), pause, finish or cancel (matter), or new (title, progress, next) for a matter that will take several days. Do not invent progress to fill it, and do not restate a matter that did not change. At most 3 matters are active at once.",
    "keepsakes is optional and almost always empty: add only an experience that will still matter to this character months from now (weight 1 small to 5 life-changing), written as one sentence about their own life, or retire (a code above) one that no longer matters. Ordinary days are not keepsakes.",
    "Write titles, moments, matter and keepsake text in the language this character's description is written in.",
  ];
  return [{ role: "system" as const, content: lines.join("\n") }];
}

const minutes = (value: unknown, isEnd = false): number | null => {
  const match = typeof value === "string" ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null;
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (isEnd && hour === 24 && minute === 0) return 1440;
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
};

export type PlanRow = { kind: LifeActivityKind; title: string; startsAt: number; endsAt: number; moment?: string };

/**
 * Reads the model's JSON reply into rows on the Character's local day, clipped to the future and to Situations (which
 * win). Invalid rows are dropped; rows that overlap each other make the whole reply unusable. Null when nothing is left.
 */
export function parseDayPlan(reply: string, timezone: string | null, now: number,
  situations: readonly { startsAt: number; endsAt: number }[] = []): PlanRow[] | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  const list = (data as { activities?: unknown } | null)?.activities;
  if (!Array.isArray(list)) return null;
  const rows: PlanRow[] = [];
  for (const item of list) {
    const raw = item as { start?: unknown; end?: unknown; kind?: unknown; title?: unknown; moment?: unknown } | null;
    const from = minutes(raw?.start), to = minutes(raw?.end, true), kind = typeof raw?.kind === "string" ? raw.kind.trim().toLowerCase() : "";
    const title = typeof raw?.title === "string" ? raw.title.trim() : "";
    if (from === null || to === null || !title || title.length > LIFE_TITLE_LIMIT || !LIFE_ACTIVITY_KINDS.includes(kind as LifeActivityKind)) continue;
    const moment = typeof raw?.moment === "string" ? raw.moment.trim() : "";
    rows.push({ kind: kind as LifeActivityKind, title, startsAt: localWallClock(now, timezone, from),
      endsAt: localWallClock(now, timezone, to <= from ? to + 1440 : to), ...(moment && moment.length <= LIFE_MOMENT_LIMIT ? { moment } : {}) });
  }
  rows.sort((a, b) => a.startsAt - b.startsAt);
  if (rows.some((row, index) => index > 0 && row.startsAt < rows[index - 1].endsAt)) return null;
  const result: PlanRow[] = [];
  for (const row of rows) {
    let { startsAt, endsAt } = row;
    if (endsAt <= now) continue;
    if (startsAt < now) startsAt = now;
    if (!result.length && startsAt - now <= SNAP_START_MS) startsAt = now;
    if (situations.some((item) => item.startsAt <= startsAt && startsAt < item.endsAt)) continue;
    for (const item of situations) if (item.startsAt > startsAt && item.startsAt < endsAt) endsAt = item.startsAt;
    if (endsAt - startsAt < MIN_ROW_MS || endsAt - startsAt > MAX_ROW_MS) continue;
    result.push({ ...row, startsAt, endsAt });
    if (result.length >= MAX_ROWS) break;
  }
  return result.length ? result : null;
}

const planKey = (characterId: string, day: string, index: number) => `${characterId}|plan|${day}|${index}`;

/**
 * Writes the plan into stored Life and marks the day done, in one document change. What has not started and overlaps the
 * plan gives way to it; a running activity it overlaps is cut at `now`, keeping its Moment only if already revealed.
 * The Routine skeleton then fills whatever the plan leaves open. Throws if the result is not a valid Life record.
 */
export function applyDayPlan(document: PresenceDocument, character: Pick<Character, "characterId" | "timezone">,
  rows: readonly PlanRow[], now: number, claimedAt: number, matters?: { updates: readonly MatterUpdate[]; codes: ReadonlyMap<string, string> },
  keepsakes?: { updates: readonly KeepsakeUpdate[]; codes: ReadonlyMap<string, string> }): PresenceDocument {
  const settled = settleLifeDocument(document, character.characterId, character.timezone, now);
  const life = presenceRecord(settled, character.characterId)?.life ?? { activities: [], reconciledAt: now };
  const effectiveNow = Math.max(life.reconciledAt, now);
  const day = localDayWindow(now, character.timezone).key;
  const overlaps = (item: LifeActivity) => rows.some((row) => item.startsAt < row.endsAt && row.startsAt < item.endsAt);
  const kept = life.activities.flatMap((item): LifeActivity[] => {
    if (item.endsAt <= effectiveNow || item.state === "cancelled" || !overlaps(item)) return [item];
    if (item.startsAt >= effectiveNow) return [];
    const { moment, ...rest } = item;
    return [{ ...rest, endsAt: effectiveNow, ...(moment && lifeMomentRevealAt(item) <= effectiveNow ? { moment } : {}) }];
  });
  const candidates = rows.map((row, index): LifeActivity => ({ id: `life:${character.characterId}:plan:${day}:${index}`,
    occurrenceKey: planKey(character.characterId, day, index), kind: row.kind, title: row.title, startsAt: row.startsAt,
    endsAt: row.endsAt, origin: "plan", ...(row.moment ? { moment: row.moment } : {}) }));
  const next = reconcileLifeActivities({ ...life, activities: kept }, candidates, now);
  // Matters follow the same day: expiry and the Character's own updates land with the plan, in the one document change.
  const { threads: stored, keepsakes: storedKeepsakes, ...rest } = next;
  const threads = applyMatterUpdates(stored, matters?.updates ?? [], matters?.codes ?? new Map(), now, `life:${character.characterId}:matter`);
  const keepsakeList = applyKeepsakeUpdates(storedKeepsakes, keepsakes?.updates ?? [], keepsakes?.codes ?? new Map(), now, `life:${character.characterId}:keep`);
  return setLifeState(settled, character.characterId, { ...rest, ...(threads ? { threads } : {}), ...(keepsakeList ? { keepsakes: keepsakeList } : {}), plan: { day, claimedAt, status: "done" } });
}

export type DayPlanOutcome = "current" | "busy" | "no-character" | "no-routine" | "no-api" | "generated" | "invalid" | "truncated" | "cancelled" | "error";
type Services = {
  foundation: () => Promise<FoundationDocument>; presence: () => Promise<PresenceDocument>;
  bindings: () => Promise<BindingDocument>; presets: () => Promise<PresetDocument>;
  api: (id: string) => Promise<ApiConfig | undefined>; provider: TextProvider;
  write: (change: (document: PresenceDocument) => PresenceDocument) => Promise<unknown>; now: () => number;
};
const services: Services = { foundation: () => browserFoundationStorage.load(), presence: () => browserPresenceStorage.load(),
  bindings: () => browserBindingStorage.load(), presets: () => browserPresetStorage.load(),
  api: (id) => browserApiConfigStorage.getApiConfig(id), provider: openAITextProvider,
  write: (change) => browserPresenceStorage.transact(change), now: Date.now };

/** Whether today is already claimed: done or failed for good, or claimed recently enough that a request may still be running. */
const taken = (life: LifeState | undefined, day: string, now: number) => {
  const mark = life?.plan;
  return !!mark && mark.day === day && (mark.status !== "claimed" || now - mark.claimedAt < DAY_PLAN_CLAIM_TTL_MS);
};
const withMark = (document: PresenceDocument, characterId: string, now: number, mark: NonNullable<LifeState["plan"]>) => {
  const life = presenceRecord(document, characterId)?.life ?? { activities: [], reconciledAt: now };
  return setLifeState(document, characterId, { ...life, plan: mark });
};

const inFlight = new Set<string>();
/**
 * Makes sure today's plan exists for the Character: at most one request per Character per local day, claimed before it is
 * sent and never retried that day. A Character without a Routine, or without a usable API, is left alone without
 * using up the day. Never throws.
 */
export async function ensureDayPlan(characterId: string, signal?: AbortSignal, deps: Services = services): Promise<DayPlanOutcome> {
  if (inFlight.has(characterId)) return "busy";
  inFlight.add(characterId);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, DAY_PLAN_TIMEOUT_MS);
  if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
  let claim: { day: string; claimedAt: number } | null = null;
  const fail = async () => {
    if (!claim) return;
    const mine = claim;
    // Best effort: a failed note stops a retry today; if it cannot be written the claim simply ages out.
    await deps.write((document) => {
      const mark = presenceRecord(document, characterId)?.life?.plan;
      return mark?.day === mine.day && mark.claimedAt === mine.claimedAt && mark.status === "claimed"
        ? withMark(document, characterId, mine.claimedAt, { ...mine, status: "failed" }) : document;
    }).catch(() => {});
  };
  try {
    const foundation = await deps.foundation();
    const character = foundation.characters.find((item) => item.characterId === characterId);
    if (!character) return "no-character";
    const now = deps.now(), day = localDayWindow(now, character.timezone).key;
    const record = presenceRecord(await deps.presence(), characterId);
    if (!record?.routine) return "no-routine";
    if (taken(record.life, day, now)) return "current";
    const bindings = await deps.bindings();
    const binding = normalizeBindingSlot({ ...bindings.global, ...bindings.characters[characterId]?.defaults });
    if (binding.apiConfigId === null) return "no-api";
    const api = await deps.api(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID);
    if (!api) return "no-api";
    validateApiConfig(api);
    const preset = presetForBinding(await deps.presets(), binding.presetId);
    // The claim is the only gate: the document change runs under the cross-tab lock, so exactly one caller wins.
    let won = false;
    await deps.write((document) => {
      won = false;
      const latest = presenceRecord(document, characterId);
      if (!latest?.routine || taken(latest.life, day, now)) return document;
      won = true;
      return withMark(document, characterId, now, { day, claimedAt: now, status: "claimed" });
    });
    if (!won) return "current";
    claim = { day, claimedAt: now };
    const inputs: PresenceInputs = { characterId, timezone: character.timezone, routine: record.routine.routine, situations: record.situations };
    const messages = dayPlanPrompt({ character, universe: universeForCharacter(foundation, character), characters: foundation.characters.filter((c) => characterUniverseId(c) === characterUniverseId(character)), inputs, life: record.life, now });
    const request = createCompletionRequestContext("life-day-plan");
    logPromptSummary(request, api.model, [{ identifier: "life-day-plan", role: "system", characterLength: messages[0].content.length }], messages);
    let reply = "", finishReason: string | undefined;
    controller.signal.throwIfAborted();
    for await (const part of deps.provider(api, messages, controller.signal,
      { ...preset.generation, maxTokens: DAY_PLAN_MAX_TOKENS, thinking: "disabled" }, request, (reason) => { finishReason = reason; })) {
      reply += part;
      if (reply.length > MAX_REPLY_CHARACTERS) { await fail(); return "invalid"; }
    }
    controller.signal.throwIfAborted();
    const finished = deps.now();
    // A reply that lands after local midnight would anchor its wall-clock rows to the wrong day; the claimed day is over.
    if (localDayWindow(finished, character.timezone).key !== day) { await fail(); return "invalid"; }
    const latest = presenceRecord(await deps.presence(), characterId);
    const rows = parseDayPlan(reply, character.timezone, finished, latest?.situations ?? []);
    if (!rows) { await fail(); return isTruncatedReason(finishReason) ? "truncated" : "invalid"; }
    const mine = claim;
    const codes = new Map(matterCodes(settleMatters(record.life?.threads, now)).map((item) => [item.code, item.id] as const));
    const matters = { updates: parseMatterUpdates(reply), codes };
    const keepsakes = { updates: parseKeepsakeUpdates(reply), codes: new Map(keepsakeCodes(record.life?.keepsakes).map((item) => [item.code, item.id] as const)) };
    await deps.write((document) => {
      // Only our own claim may be completed; a Character removed meanwhile has no record to write into.
      const mark = presenceRecord(document, characterId)?.life?.plan;
      if (!mark || mark.day !== mine.day || mark.claimedAt !== mine.claimedAt || mark.status !== "claimed") return document;
      return applyDayPlan(document, character, rows, finished, mine.claimedAt, matters, keepsakes);
    });
    return "generated";
  } catch {
    await fail();
    return controller.signal.aborted ? "cancelled" : "error";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    inFlight.delete(characterId);
  }
}

/** Fire-and-forget trigger for a page that shows or uses the Character's day. */
export function requestDayPlan(characterId: string) {
  if (typeof window !== "undefined") void ensureDayPlan(characterId);
}
