import { browserApiConfigStorage } from "../api-config-storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { browserBindingStorage } from "../binding-storage";
import { normalizeBindingSlot, type BindingDocument } from "../bindings";
import { isTruncatedReason } from "../chat/types";
import { openAITextProvider, validateApiConfig, type TextProvider } from "../chat/provider";
import { createCompletionRequestContext, logPromptSummary } from "../chat/request-diagnostics";
import { browserFoundationStorage } from "../foundation-storage";
import { normalizePresence, type Character, type FoundationDocument } from "../foundation-types";
import { presetForBinding, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { MAX_JITTER_MINUTES, type PresenceRoutine } from "./compute";
import { browserPresenceStorage, normalizeRoutine, presenceRecord, setRoutine, type PresenceDocument } from "./storage";

// Routine generation: the model drafts a rough weekly rhythm once per Character life basis (occupation,
// backstory, personality). Nothing here runs on a timer; the only trigger is a Character save, and a save
// that leaves the basis unchanged finds the stored routine current and makes no request.

const SOURCE_PREFIX = "generated:";
// Reasoning models spend most of their output budget thinking before the short JSON appears, so the budget is
// generous but fixed. It is used as is: a chat preset's maxTokens is sized for chat replies and must not cap it.
export const ROUTINE_MAX_TOKENS = 3000;
export const ROUTINE_TIMEOUT_MS = 90_000;
const ROUTINE_MAX_REPLY_CHARACTERS = 8_000;
const PROMPT_FIELD_LIMIT = 1_500;

const field = (value: string | null) => value?.trim() ?? "";

/** A short stable fingerprint (FNV-1a) of the settings that shape a life rhythm. */
export function routineBasis(character: Pick<Character, "occupation" | "backstory" | "personality">): string {
  const text = JSON.stringify([field(character.occupation), field(character.backstory), field(character.personality)]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
/** The change-mark source stored with a generated routine; it carries the basis it was made from. */
export const routineSource = (basis: string) => `${SOURCE_PREFIX}${basis}`;

export function routinePrompt(character: Pick<Character, "name" | "occupation" | "backstory" | "personality">) {
  const text = (value: string | null, limit = PROMPT_FIELD_LIMIT) => field(value).slice(0, limit) || "unspecified";
  return [{ role: "system" as const, content: [
    `Sketch the rough weekly life rhythm of ${text(character.name, 100)}, a fictional character, as the times they are usually reachable in their own local time.`,
    `Occupation: ${text(character.occupation, 200)}`,
    `Backstory: ${text(character.backstory)}`,
    `Personality: ${text(character.personality)}`,
    "Reply with one JSON object and nothing else:",
    '{"defaultStatus":"online","jitterMinutes":45,"blocks":[{"days":[1,2,3,4,5],"start":"09:00","end":"17:30","status":"busy"}]}',
    "Rules: status is one of online, away, busy, dnd, offline. days use 0=Sunday to 6=Saturday. Times are 24-hour HH:MM in the character's local time; an end earlier than its start runs past midnight.",
    "defaultStatus applies whenever no block does. Use at most 12 blocks, for sleep, work, commutes, meals or whatever fits this character's life; later blocks win where blocks overlap.",
    "This is a rough natural rhythm, not a precise timetable. jitterMinutes (0-" + MAX_JITTER_MINUTES + ") is how much the edges may drift from day to day.",
  ].join("\n") }];
}

/** "HH:MM" as minutes of the day. An end time may be "24:00" (midnight, the end of that day); a start may not. */
function minutes(value: unknown, isEnd = false): number | null {
  const match = typeof value === "string" ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null;
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (isEnd && hour === 24 && minute === 0) return 0;
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}
// Common harmless deviations only: a number or day written as digits in a string, a status in other case.
const count = (value: unknown) => typeof value === "string" && /^\s*\d{1,4}\s*$/.test(value) ? Number(value) : value;
const label = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : value;
/** Reads the model's JSON reply into a routine, or null when anything is missing or out of range. */
export function parseRoutine(reply: string): PresenceRoutine | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  const raw = data as { defaultStatus?: unknown; jitterMinutes?: unknown; blocks?: unknown };
  const jitter = count(raw?.jitterMinutes);
  if (!raw || !Array.isArray(raw.blocks) || !raw.blocks.length || typeof jitter !== "number") return null;
  const blocks = [];
  for (const item of raw.blocks) {
    const block = item as { days?: unknown; start?: unknown; end?: unknown; status?: unknown };
    const startMinute = minutes(block?.start), endMinute = minutes(block?.end, true);
    if (startMinute === null || endMinute === null || !Array.isArray(block.days)) return null;
    blocks.push({ days: block.days.map(count), startMinute, endMinute, status: label(block.status) });
  }
  const defaultStatus = label(raw.defaultStatus);
  if (normalizePresence(defaultStatus) !== defaultStatus) return null;
  return normalizeRoutine({ blocks, defaultStatus, jitterMinutes: jitter });
}

export type RoutineOutcome = "current" | "busy" | "no-character" | "no-api" | "generated" | "invalid" | "truncated" | "stale" | "cancelled" | "error";
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

const inFlight = new Set<string>(), rerun = new Set<string>();
/**
 * Makes sure the Character's stored routine matches its current life basis, generating one when it does not.
 * One request at most per Character at a time; a failure of any kind leaves the stored routine untouched and
 * is not retried until the next Character save. Never throws.
 */
export async function ensureRoutine(characterId: string, signal?: AbortSignal, deps: Services = services): Promise<RoutineOutcome> {
  // A save that lands while a request is running is not lost: the Character is checked again when it ends.
  if (inFlight.has(characterId)) { rerun.add(characterId); return "busy"; }
  inFlight.add(characterId);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, ROUTINE_TIMEOUT_MS);
  if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true });
  try {
    const character = (await deps.foundation()).characters.find((item) => item.characterId === characterId);
    if (!character) return "no-character";
    const basis = routineBasis(character), source = routineSource(basis);
    if (presenceRecord(await deps.presence(), characterId)?.routine?.source === source) return "current";
    const bindings = await deps.bindings();
    const binding = normalizeBindingSlot({ ...bindings.global, ...bindings.characters[characterId]?.defaults });
    if (binding.apiConfigId === null) return "no-api";
    const api = await deps.api(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID);
    if (!api) return "no-api";
    validateApiConfig(api);
    const preset = presetForBinding(await deps.presets(), binding.presetId);
    const messages = routinePrompt(character), request = createCompletionRequestContext("presence-routine");
    logPromptSummary(request, api.model, [{ identifier: "presence-routine", role: "system", characterLength: messages[0].content.length }], messages);
    let reply = "", finishReason: string | undefined;
    controller.signal.throwIfAborted();
    for await (const part of deps.provider(api, messages, controller.signal,
      { ...preset.generation, maxTokens: ROUTINE_MAX_TOKENS }, request, (reason) => { finishReason = reason; })) {
      reply += part;
      if (reply.length > ROUTINE_MAX_REPLY_CHARACTERS) return "invalid";
    }
    controller.signal.throwIfAborted();
    const routine = parseRoutine(reply);
    // A reply cut off at the token limit usually holds only the model's reasoning; say so instead of "invalid".
    if (!routine) return isTruncatedReason(finishReason) ? "truncated" : "invalid";
    // The Character may have been edited or deleted while the model was thinking; a routine for an old basis is dropped.
    const latest = (await deps.foundation()).characters.find((item) => item.characterId === characterId);
    if (!latest || routineBasis(latest) !== basis) return "stale";
    await deps.write((document) => setRoutine(document, characterId, routine, { changedAt: deps.now(), source }));
    return "generated";
  } catch {
    return controller.signal.aborted ? "cancelled" : "error";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    inFlight.delete(characterId);
  }
}
/** Runs `ensureRoutine` and repeats it while another save arrives during a request; each repeat needs a new save. */
export async function ensureRoutineAfterSave(characterId: string, deps: Services = services): Promise<RoutineOutcome> {
  // No caller signal: a repeat belongs to a later save, so cancelling the first request must not drop it.
  let outcome = await ensureRoutine(characterId, undefined, deps);
  // A "busy" call left its marker for the wrapper that is already running; only that one repeats.
  if (outcome === "busy") return outcome;
  while (rerun.delete(characterId)) outcome = await ensureRoutine(characterId, undefined, deps);
  return outcome;
}
