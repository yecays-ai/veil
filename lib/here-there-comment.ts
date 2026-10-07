import { normalizeBindingSlot } from "./bindings";
import type { BindingDocument } from "./bindings";
import { browserBindingStorage } from "./binding-storage";
import type { FoundationDocument } from "./foundation-types";
import { presetForBinding, type PresetDocument } from "./preset";
import { validateApiConfig, openAITextProvider, type TextProvider } from "./chat/provider";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "./api-config";
import { browserApiConfigStorage } from "./api-config-storage";
import { localTime, resolveTimezone, type WeatherState } from "./participant-config";
import type { ThemeDocument } from "./theme-types";
import { browserFoundationStorage } from "./foundation-storage";
import { browserPresetStorage } from "./preset-storage";
import { chatStorage } from "./chat/storage";
import { sanitizeHistoryTimestamps } from "./chat/timestamp-sanitizer";
import { createCompletionRequestContext, logPromptSummary } from "./chat/request-diagnostics";
import type { WidgetInstance } from "./widget-types";

export const HERE_THERE_COMMENT_MIN_DELAY_MS = 60 * 60 * 1000;
export const HERE_THERE_COMMENT_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
export const HERE_THERE_COMMENT_RETRY_DELAY_MS = 5 * 60 * 1000;

export class HereThereCommentAttemptGuard {
  private readonly attempted = new Set<string>();
  private readonly inFlight = new Set<string>();

  begin(characterId: string, needsRefresh: boolean, opportunity = "default"): boolean {
    const key = `${characterId}:${opportunity}`;
    if (!needsRefresh) {
      this.attempted.delete(key);
      return false;
    }
    if (this.attempted.has(key) || this.inFlight.has(key)) return false;
    this.attempted.add(key);
    this.inFlight.add(key);
    return true;
  }

  finish(characterId: string, opportunity = "default") {
    this.inFlight.delete(`${characterId}:${opportunity}`);
  }
}

/** Epoch ownership: a result may commit only while the epoch it started under is still current. */
export class HereThereGenerationOwner {
  private epoch = 0;
  begin(): () => boolean {
    const owned = this.epoch;
    return () => this.epoch === owned;
  }
  invalidate() { this.epoch++; }
}

export function startHereThereCommentAttempt(begin: () => boolean,
  generate: () => Promise<void>): Promise<void> | null {
  return begin() ? generate() : null;
}

export function hereThereCommentNeedsRefresh(widget: WidgetInstance, now: Date,
  nextCommentAt: number | null | undefined): boolean {
  return !!widget.config.characterId && typeof nextCommentAt === "number"
    && Number.isFinite(nextCommentAt) && now.getTime() >= nextCommentAt;
}

type Context = { foundation: FoundationDocument; characterId: string; now: Date;
  hereWeather: WeatherState; thereWeather: WeatherState; isCurrent?: () => boolean };
type Commit = (update: (theme: ThemeDocument) => ThemeDocument) => Promise<void>;
type Dependencies = { foundation: () => Promise<FoundationDocument>; presets: () => Promise<PresetDocument>;
  api: (id: string) => Promise<ApiConfig | undefined>; provider: TextProvider; bindings: () => Promise<BindingDocument>;
  settings: () => Promise<{ hereThereEnabled: boolean }>;
  claimOpportunity: (now: number) => Promise<number | null>;
  scheduleRetry: (expectedNextCommentAt: number, now: number, delayMs: number) => Promise<boolean> };
const dependencies: Dependencies = { foundation: () => browserFoundationStorage.load(),
  presets: () => browserPresetStorage.load(), api: (id) => browserApiConfigStorage.getApiConfig(id), provider: openAITextProvider,
  bindings: () => browserBindingStorage.load(), settings: () => chatStorage.readGlobalProfileSettings(),
  claimOpportunity: (now) => chatStorage.claimHereThereOpportunity(now),
  scheduleRetry: (expectedNextCommentAt, now, delayMs) =>
    chatStorage.rescheduleHereThereOpportunity(expectedNextCommentAt, now, delayMs) };

export async function ensureHereThereComment(widget: WidgetInstance, context: Context, commit: Commit,
  services: Dependencies = dependencies): Promise<void> {
  if (widget.config.characterId !== context.characterId) return;
  let claimedNextCommentAt: number | null = null;
  try {
    const settings = await services.settings();
    if (!settings.hereThereEnabled) return;
    claimedNextCommentAt = await services.claimOpportunity(context.now.getTime());
    if (claimedNextCommentAt === null) return;
    const foundation = await services.foundation();
    const character = foundation.characters.find((item) => item.characterId === context.characterId);
    if (!character) throw new Error("Character unavailable");
    const bindings = await services.bindings();
    const binding = normalizeBindingSlot({ ...bindings.global,
      ...bindings.characters[character.characterId]?.defaults });
    if (binding.apiConfigId === null) throw new Error("API disabled");
    const api = await services.api(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID);
    if (!api) throw new Error("API unavailable");
    validateApiConfig(api);
    const preset = presetForBinding(await services.presets(), binding.presetId);
    const userTime = localTime(context.now, resolveTimezone(context.foundation.user.timezone).timezone, false, false);
    const characterTime = localTime(context.now, resolveTimezone(character.timezone).timezone, false, false);
    const promptText = (value: string | null, limit = 500) => value?.trim().slice(0, limit) || "unspecified";
    const weatherText = (weather: WeatherState) => weather.status === "ready"
      ? `${weather.temperatureC}°C, ${weather.summary.slice(0, 120)}` : "unavailable";
    const userName = promptText(context.foundation.user.name, 100);
    const characterName = promptText(character.name, 100);
    const contextInstruction = `You are ${characterName}, the speaker. Make one short, natural in-character remark to ${userName} about the current time or weather.\nHERE is ${userName}'s place (${userName} is the user, in ${promptText(context.foundation.user.location?.label ?? null, 100)}); THERE is ${characterName}'s place (${characterName} is the character, in ${promptText(character.location?.label ?? null, 100)}). "Here" always means ${userName}'s city and "there" always means ${characterName}'s city, even though ${characterName} is the one speaking.\nPersonality: ${promptText(character.personality)}\nSpeaking Style: ${promptText(character.speakingStyle)}\nCurrent local time (HERE, ${userName}): ${userTime}; weather: ${weatherText(context.hereWeather)}\nCurrent local time (THERE, ${characterName}): ${characterTime}; weather: ${weatherText(context.thereWeather)}. Never invent weather or temperatures. Output only the remark.`;
    const messages = [{ role: "system" as const, content: contextInstruction }];
    const diagnostics = [{ identifier: "here-there-context", role: "system" as const, characterLength: contextInstruction.length }];
    const latestSettings = await services.settings();
    if (!latestSettings.hereThereEnabled) return;
    let text = "";
    const controller = new AbortController();
    const request = createCompletionRequestContext("here-there-comment");
    logPromptSummary(request, api.model, diagnostics, messages);
    for await (const part of services.provider(api, messages, controller.signal,
      { ...preset.generation, maxTokens: Math.min(preset.generation.maxTokens ?? 128, 128) },
      request)) text += part;
    text = sanitizeHistoryTimestamps(text).trim();
    if (!text) throw new Error("Empty remark");
    if (context.isCurrent && !context.isCurrent()) return;
    await commit((theme) => ({ ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((current) =>
      current.id === widget.id && current.config.characterId === context.characterId
        ? { ...current, config: { ...current.config, comment: { characterId: context.characterId,
          text: text.slice(0, 500), generatedAt: context.now.toISOString() } } } : current) } }));
  } catch {
    if (context.isCurrent && !context.isCurrent()) return;
    if (claimedNextCommentAt !== null) {
      try { await services.scheduleRetry(claimedNextCommentAt, Date.now(), HERE_THERE_COMMENT_RETRY_DELAY_MS); }
      catch { /* Keep the last successful comment even when retry scheduling fails. */ }
    }
  }
}
