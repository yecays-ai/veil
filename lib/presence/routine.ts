import { browserApiConfigStorage } from "../api-config-storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { browserBindingStorage } from "../binding-storage";
import { normalizeBindingSlot, type BindingDocument } from "../bindings";
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
export const ROUTINE_MAX_TOKENS = 700;
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

function minutes(value: unknown): number | null {
  const match = typeof value === "string" ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value) : null;
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? total : null;
}
/** Reads the model's JSON reply into a routine, or null when anything is missing or out of range. */
export function parseRoutine(reply: string): PresenceRoutine | null {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try { data = JSON.parse(reply.slice(start, end + 1)); } catch { return null; }
  const raw = data as { defaultStatus?: unknown; jitterMinutes?: unknown; blocks?: unknown };
  if (!raw || !Array.isArray(raw.blocks) || !raw.blocks.length || typeof raw.jitterMinutes !== "number") return null;
  const blocks = [];
  for (const item of raw.blocks) {
    const block = item as { days?: unknown; start?: unknown; end?: unknown; status?: unknown };
    const startMinute = minutes(block?.start), endMinute = minutes(block?.end);
    if (startMinute === null || endMinute === null || !Array.isArray(block.days)) return null;
    blocks.push({ days: block.days, startMinute, endMinute, status: block.status });
  }
  if (normalizePresence(raw.defaultStatus) !== raw.defaultStatus) return null;
  return normalizeRoutine({ blocks, defaultStatus: raw.defaultStatus, jitterMinutes: raw.jitterMinutes });
}

export type RoutineOutcome = "current" | "no-character" | "no-api" | "generated" | "invalid" | "stale" | "cancelled" | "error";
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
  if (inFlight.has(characterId)) { rerun.add(characterId); return "current"; }
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
    let reply = "";
    controller.signal.throwIfAborted();
    for await (const part of deps.provider(api, messages, controller.signal,
      { ...preset.generation, maxTokens: Math.min(preset.generation.maxTokens ?? ROUTINE_MAX_TOKENS, ROUTINE_MAX_TOKENS) }, request)) {
      reply += part;
      if (reply.length > ROUTINE_MAX_REPLY_CHARACTERS) return "invalid";
    }
    controller.signal.throwIfAborted();
    const routine = parseRoutine(reply);
    if (!routine) return "invalid";
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
/** Runs `ensureRoutine`, then once more if another save arrived meanwhile and the first result went stale. */
export async function ensureRoutineAfterSave(characterId: string, signal?: AbortSignal, deps: Services = services): Promise<RoutineOutcome> {
  rerun.delete(characterId);
  const outcome = await ensureRoutine(characterId, signal, deps);
  if (!rerun.delete(characterId) || signal?.aborted) return outcome;
  return ensureRoutine(characterId, signal, deps);
}
