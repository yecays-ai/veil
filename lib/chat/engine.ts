import { resolveBindings } from "../bindings";
import type { BindingDocument } from "../bindings";
import { browserBindingStorage } from "../binding-storage";
import { browserApiConfigStorage } from "../api-config-storage";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { browserFoundationStorage } from "../foundation-storage";
import type { FoundationDocument } from "../foundation-types";
import { createPresetDocument, presetForBinding, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { assembleChatPrompt } from "./prompt";
import {
  openAITextProvider,
  validateApiConfig,
  type TextProvider,
} from "./provider";
import { ChatStorage, chatStorage } from "./storage";
import type { ChatMessage } from "./types";
import { sanitizeHistoryTimestamps } from "./timestamp-sanitizer";
import { browserWorldBookStorage } from "../worldbook-storage";
import { emptyWorldBookDocument, type WorldBookDocument } from "../worldbook";
import { evaluateWorldBooks } from "../worldbook-activation";
import type { WorldBookActivationState } from "../worldbook-activation";
import { browserRegexStorage } from "../regex-storage";
import { emptyRegexDocument, resolveRegexGroups, type RegexDocument } from "../regex";
import { applyRegex } from "../regex-engine";
import { loadWeatherState } from "../weather";
import type { Coordinates, WeatherState } from "../participant-config";

type WeatherLoader = (target: { label: string | null; coordinates: Coordinates | null }) => Promise<WeatherState>;

async function safeWeather(loader: WeatherLoader, location: FoundationDocument["user"]["location"]) {
  if (!location) return { status: "not-configured" } as const;
  try {
    return await loader({ label: location.label, coordinates: location.coordinates });
  } catch {
    return { status: "error", message: "Weather unavailable" } as const;
  }
}

export function createChatEngine(
  storage: ChatStorage,
  foundation: () => Promise<FoundationDocument>,
  provider: TextProvider = openAITextProvider,
  presets: () => Promise<PresetDocument> = async () => createPresetDocument(),
  now: () => Date = () => new Date(),
  worldBooks: () => Promise<WorldBookDocument> = () =>
    typeof window === "undefined" ? Promise.resolve(emptyWorldBookDocument()) : browserWorldBookStorage.load(),
  regex: () => Promise<RegexDocument> = () =>
    typeof window === "undefined" ? Promise.resolve(emptyRegexDocument()) : browserRegexStorage.load(),
  bindings: () => Promise<BindingDocument> = () => typeof window === "undefined"
    ? Promise.resolve({ global: {}, characters: {} }) : browserBindingStorage.load(),
  weatherLoader: WeatherLoader = (target) => loadWeatherState(target),
  apiConfig: (id: string) => Promise<ApiConfig | undefined> = (id) => browserApiConfigStorage.getApiConfig(id),
) {
  const active = new Map<string, AbortController>();
  async function prepareGeneration(characterId: string) {
    const document = await foundation();
    const character = document.characters.find((item) => item.characterId === characterId);
    if (!character) throw new Error("This Character is no longer available.");
    const binding = resolveBindings(await bindings(), character.characterId, "messages");
    if (binding.apiConfigId === null)
      throw new Error("The Messages API binding is disabled for this Character.");
    const config = await apiConfig(binding.apiConfigId ?? DEFAULT_API_CONFIG_ID);
    if (!config)
      throw new Error("The selected Text API is missing. Choose a saved config in Settings → Text API.");
    validateApiConfig(config);
    const preset = presetForBinding(await presets(), binding.presetId);
    return { document, character, config, preset, binding };
  }
  async function generateReply(sessionId: string, onFinalized?: (messages: readonly ChatMessage[]) => void, regenerateId?: string): Promise<ChatMessage | null> {
    if (active.has(sessionId)) return null;
    const controller = new AbortController();
    active.set(sessionId, controller);
    let assistant: ChatMessage | undefined;
    let rawContent = "";
    let content = "";
    let activationState: WorldBookActivationState | undefined;
    let providerStarted = false;
    try {
      const current = await storage.readSession(sessionId);
      if (regenerateId === undefined && !current.messages.some((m) =>
        m.role === "user" && m.status === "sent" && !m.requestedBy))
        return null;
      const { document, character, config, preset, binding } = await prepareGeneration(current.session.characterId);
      controller.signal.throwIfAborted();
      const batch = await storage.beginReply(sessionId, regenerateId);
      if (!batch) return null;
      assistant = batch.assistant;
      const selectedIds = binding.worldBookIds;
      const regexIds = binding.regexIds;
      const regexGroups = resolveRegexGroups(await regex(), regexIds);
      const books = (await worldBooks()).books.filter((book) =>
        selectedIds === undefined || selectedIds.includes(book.id));
      const activation = evaluateWorldBooks(books, batch.messages,
        await storage.readWorldBookState(sessionId));
      activationState = activation.nextState;
      const weather = document.runtime?.timeAware === false ? undefined : await Promise.all([
        safeWeather(weatherLoader, document.user.location),
        safeWeather(weatherLoader, character.location),
      ]).then(([user, characterWeather]) => ({
        ...(user.status === "ready" && document.user.location ? {
          user: { location: document.user.location.label, temperatureC: user.temperatureC, summary: user.summary },
        } : {}),
        ...(characterWeather.status === "ready" && character.location ? {
          character: { location: character.location.label, temperatureC: characterWeather.temperatureC, summary: characterWeather.summary },
        } : {}),
      }));
      const prompt = assembleChatPrompt(
        document,
        character,
        batch.messages,
        batch.pending,
        undefined,
        preset,
        now(),
        activation,
        regexGroups,
        weather,
      );
      providerStarted = true;
      for await (const text of provider(
        config,
        prompt.messages,
        controller.signal,
        preset.generation,
      )) {
        controller.signal.throwIfAborted();
        rawContent += text;
        content = sanitizeHistoryTimestamps(rawContent, true);
        await storage.updateReply(assistant.id, {
          content,
          status: "streaming",
        });
      }
      controller.signal.throwIfAborted();
      content = sanitizeHistoryTimestamps(rawContent);
      if (!content.trim()) throw new Error("The API returned no reply text.");
      const completed = await storage.finalizeReply(assistant.id, content, activationState,
        (part) => applyRegex(part, regexGroups, "assistant", "stored",
          { character: character.name, user: document.user.name }));
      // Optional presentation notification; it cannot turn a committed reply into an error.
      try { onFinalized?.(completed); } catch { /* Generation and storage have succeeded. */ }
      return completed[0];
    } catch (error) {
      if (!assistant) {
        if (controller.signal.aborted) return null;
        throw error;
      }
      return await storage.updateReply(assistant.id, {
        content,
        status: controller.signal.aborted ? "cancelled" : "error",
        error: controller.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : "Reply failed.",
      }, providerStarted ? activationState : undefined);
    } finally {
      active.delete(sessionId);
    }
  }
  return {
    async send(sessionId: string, content: string, quoteMessageId?: string) {
      const { session } = await storage.readSession(sessionId);
      const document = await foundation();
      const ids = resolveBindings(await bindings(), session.characterId, "messages").regexIds;
      const groups = resolveRegexGroups(await regex(), ids);
      const character = document.characters.find((item) => item.characterId === session.characterId);
      return storage.send(sessionId, applyRegex(content, groups, "user", "stored",
        { character: character?.name, user: document.user.name }), quoteMessageId);
    },
    isGenerating: (sessionId: string) => active.has(sessionId),
    stop: (sessionId: string) => active.get(sessionId)?.abort(),
    requestReply: (sessionId: string, onFinalized?: (messages: readonly ChatMessage[]) => void) =>
      generateReply(sessionId, onFinalized),
    async regenerateMessage(messageId: string, onFinalized?: (messages: readonly ChatMessage[]) => void, expectedSessionId?: string): Promise<ChatMessage | null> {
      const sessionId = expectedSessionId ?? await storage.regenerationSessionId(messageId);
      if (active.has(sessionId)) throw new Error("A reply is already in progress.");
      return generateReply(sessionId, onFinalized, messageId);
    },
  };
}
export const chatEngine = createChatEngine(chatStorage, () =>
  browserFoundationStorage.load(),
  openAITextProvider,
  () => browserPresetStorage.load(),
);
