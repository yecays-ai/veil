import { normalizeBindingSlot } from "./bindings";
import type { FoundationDocument } from "./foundation-types";
import { presetForBinding, type PresetDocument } from "./preset";
import { assembleChatPrompt } from "./chat/prompt";
import { validateApiConfig, openAITextProvider, type TextProvider } from "./chat/provider";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "./chat/types";
import { localTime, resolveTimezone, type ParticipantConfig, type WeatherState } from "./participant-config";
import type { ThemeDocument } from "./theme-types";
import { browserFoundationStorage } from "./foundation-storage";
import { browserPresetStorage } from "./preset-storage";
import { chatStorage } from "./chat/storage";
import { sanitizeHistoryTimestamps } from "./chat/timestamp-sanitizer";
import type { WidgetInstance } from "./widget-types";

// Persisted pending state is not proof that a request survived a page reload.
const activeComments = new Set<string>();

export function claimHereThereCommentAttempt(widget: WidgetInstance, attempts: Set<string>): boolean {
  const key = `${widget.id}:${widget.config.characterId}`;
  if (widget.config.comment?.status === "complete" || activeComments.has(key) || attempts.has(key)) return false;
  attempts.add(key);
  return true;
}

type Context = { foundation: FoundationDocument; characterId: string; now: Date;
  hereWeather: WeatherState; thereWeather: WeatherState };
type Commit = (update: (theme: ThemeDocument) => ThemeDocument) => Promise<void>;
type Dependencies = { foundation: () => Promise<FoundationDocument>; presets: () => Promise<PresetDocument>;
  api: (id: string) => Promise<ApiConfig | undefined>; provider: TextProvider;
  diagnostic?: (stage: string) => void };
const dependencies: Dependencies = { foundation: () => browserFoundationStorage.load(),
  presets: () => browserPresetStorage.load(), api: (id) => chatStorage.getApiConfig(id), provider: openAITextProvider };

function facts(profile: ParticipantConfig, weather: WeatherState, now: Date) {
  const timezone = resolveTimezone(profile.timezone).timezone;
  return { name: profile.name, location: profile.location?.label ?? null,
    localDate: new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now),
    localTime: localTime(now, timezone, false, false), timezone,
    weather: weather.status === "ready" ? { temperatureC: weather.temperatureC, summary: weather.summary } : "unavailable" };
}

export async function ensureHereThereComment(widgetId: string, context: Context, commit: Commit,
  services: Dependencies = dependencies): Promise<void> {
  if (context.hereWeather.status === "loading" || context.thereWeather.status === "loading") return;
  const key = `${widgetId}:${context.characterId}`;
  if (activeComments.has(key)) return;
  activeComments.add(key);
  let requestId = "";
  let stage = "claim-storage";
  function diagnostic() {
    // Fixed stage names only; never forward exception text, config or response bodies.
    try { (services.diagnostic ?? ((stage) => console.warn(`[Here & There comment] failed at ${stage}`)))(stage); } catch { /* Diagnostics must remain quiet. */ }
  }
  let claimed = false;
  try {
    requestId = crypto.randomUUID();
    await commit((theme) => ({ ...theme, current: { ...theme.current,
      widgets: theme.current.widgets.map((widget) => {
        if (widget.id !== widgetId || widget.type !== "here-there" || widget.config.characterId !== context.characterId
          || widget.config.comment?.status === "complete") return widget;
        claimed = true;
        return { ...widget, config: { ...widget.config, comment: {
          characterId: context.characterId, requestId, status: "pending" as const } } };
      }) } }));
    if (!claimed) return;
    stage = "foundation-load";
    const foundation = await services.foundation();
    stage = "character-resolution";
    const character = foundation.characters.find((item) => item.characterId === context.characterId);
    if (!character) throw new Error("Character unavailable");
    const binding = normalizeBindingSlot({ ...foundation.bindings.global,
      ...foundation.bindings.characters[character.characterId]?.defaults });
    stage = "api-disabled";
    if (binding.apiConfigId === null) throw new Error("API disabled");
    stage = "api-load";
    const api = await services.api(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID);
    stage = "api-missing";
    if (!api) throw new Error("API unavailable");
    stage = "api-validation";
    validateApiConfig(api);
    stage = "preset-load";
    const preset = presetForBinding(await services.presets(), binding.presetId);
    stage = "prompt-assembly";
    const prompt = assembleChatPrompt(foundation, character, [], [], undefined, preset, context.now);
    prompt.messages.push({ role: "system", content: `You are ${character.name}. This is a Home widget remark, not a chat reply.\nCharacter profile: ${JSON.stringify(character)}\nUser profile: ${JSON.stringify(foundation.user)}\nHERE: ${JSON.stringify(facts(context.foundation.user, context.hereWeather, context.now))}\nTHERE: ${JSON.stringify(facts(context.foundation.characters.find((item) => item.characterId === context.characterId) ?? character, context.thereWeather, context.now))}\nWrite exactly one short, natural in-character sentence reacting to this context, as a casual remark rather than a weather report. Never invent unavailable weather or temperatures. Output only the remark; no timestamps, headings or multiple messages.` });
    prompt.messages.push({ role: "user", content: "Make your brief Here & There remark." });
    let text = "";
    const controller = new AbortController();
    stage = "provider-generation";
    for await (const part of services.provider(api, prompt.messages, controller.signal,
      { ...preset.generation, maxTokens: Math.min(preset.generation.maxTokens ?? 128, 128) })) text += part;
    text = sanitizeHistoryTimestamps(text).trim();
    stage = "empty-output";
    if (!text) throw new Error("Empty remark");
    stage = "complete-storage";
    await finish("complete", text.slice(0, 500));
  } catch {
    diagnostic();
    if (claimed) await finish("failed").catch(() => { stage = "failure-storage"; diagnostic(); });
  } finally {
    activeComments.delete(key);
  }
  async function finish(status: "complete" | "failed", text?: string) {
    await commit((theme) => ({ ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((widget) =>
      widget.id === widgetId && widget.config.characterId === context.characterId && widget.config.comment?.requestId === requestId
        ? { ...widget, config: { ...widget.config, comment: { characterId: context.characterId, requestId, status,
          ...(text ? { text } : {}) } } } : widget) } }));
  }
}
