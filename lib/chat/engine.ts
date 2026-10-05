import { resolveBindings } from "../bindings";
import { browserFoundationStorage } from "../foundation-storage";
import type { FoundationDocument } from "../foundation-types";
import { activePreset, createPresetDocument, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { assembleChatPrompt } from "./prompt";
import {
  openAITextProvider,
  validateApiConfig,
  type TextProvider,
} from "./provider";
import { ChatStorage, chatStorage } from "./storage";
import { DEFAULT_API_CONFIG_ID, type ChatMessage } from "./types";
import { sanitizeHistoryTimestamps } from "./timestamp-sanitizer";

export function createChatEngine(
  storage: ChatStorage,
  foundation: () => Promise<FoundationDocument>,
  provider: TextProvider = openAITextProvider,
  presets: () => Promise<PresetDocument> = async () => createPresetDocument(),
  now: () => Date = () => new Date(),
) {
  const active = new Map<string, AbortController>();
  async function prepareGeneration(characterId: string) {
    const document = await foundation();
    const character = document.characters.find((item) => item.characterId === characterId);
    if (!character) throw new Error("This Character is no longer available.");
    const binding = resolveBindings(document.bindings, character.characterId, "messages").apiConfigId;
    if (binding === null)
      throw new Error("The Messages API binding is disabled for this Character.");
    const config = await storage.getApiConfig(binding ?? DEFAULT_API_CONFIG_ID);
    if (!config)
      throw new Error("The selected Text API is missing. Choose a saved config in Settings → Text API.");
    validateApiConfig(config);
    const preset = activePreset(await presets());
    return { document, character, config, preset };
  }
  async function generateReply(sessionId: string, onFinalized?: (messages: readonly ChatMessage[]) => void, regenerateId?: string): Promise<ChatMessage | null> {
    if (active.has(sessionId)) return null;
    const controller = new AbortController();
    active.set(sessionId, controller);
    let assistant: ChatMessage | undefined;
    let rawContent = "";
    let content = "";
    try {
      const current = await storage.readSession(sessionId);
      if (regenerateId === undefined && !current.messages.some((m) =>
        m.role === "user" && m.status === "sent" && !m.requestedBy))
        return null;
      const { document, character, config, preset } = await prepareGeneration(current.session.characterId);
      controller.signal.throwIfAborted();
      const batch = await storage.beginReply(sessionId, regenerateId);
      if (!batch) return null;
      assistant = batch.assistant;
      const prompt = assembleChatPrompt(
        document,
        character,
        batch.messages,
        batch.pending,
        undefined,
        preset,
        now(),
      );
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
      const completed = await storage.finalizeReply(assistant.id, content);
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
      });
    } finally {
      active.delete(sessionId);
    }
  }
  return {
    send: (sessionId: string, content: string, quoteMessageId?: string) =>
      storage.send(sessionId, content, quoteMessageId),
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
