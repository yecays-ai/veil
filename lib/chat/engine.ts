import { resolveBindings } from "../bindings";
import { browserFoundationStorage } from "../foundation-storage";
import type { FoundationDocument } from "../foundation-types";
import { createPresetDocument, type PresetDocument } from "../preset";
import { browserPresetStorage } from "../preset-storage";
import { assembleChatPrompt } from "./prompt";
import {
  openAITextProvider,
  validateApiConfig,
  type TextProvider,
} from "./provider";
import { ChatStorage, chatStorage } from "./storage";
import { DEFAULT_API_CONFIG_ID, type ChatMessage } from "./types";

export function createChatEngine(
  storage: ChatStorage,
  foundation: () => Promise<FoundationDocument>,
  provider: TextProvider = openAITextProvider,
  presets: () => Promise<PresetDocument> = async () => createPresetDocument(),
  now: () => Date = () => new Date(),
) {
  const active = new Map<string, AbortController>();
  return {
    send: (sessionId: string, content: string) =>
      storage.send(sessionId, content),
    isGenerating: (sessionId: string) => active.has(sessionId),
    stop: (sessionId: string) => active.get(sessionId)?.abort(),
    async requestReply(sessionId: string): Promise<ChatMessage | null> {
      if (active.has(sessionId)) return null;
      const controller = new AbortController();
      active.set(sessionId, controller);
      let assistant: ChatMessage | undefined;
      let content = "";
      try {
        const current = await storage.readSession(sessionId);
        if (!current.messages.some((m) =>
          m.role === "user" && m.status === "sent" && !m.requestedBy))
          return null;
        const document = await foundation();
        const character = document.characters.find(
          (c) => c.characterId === current.session.characterId,
        );
        if (!character)
          throw new Error("This Character is no longer available.");
        const binding = resolveBindings(
          document.bindings,
          character.characterId,
          "messages",
        ).apiConfigId;
        if (binding === null)
          throw new Error(
            "The Messages API binding is disabled for this Character.",
          );
        const config = await storage.getApiConfig(
          binding ?? DEFAULT_API_CONFIG_ID,
        );
        if (!config)
          throw new Error(
            "The selected Text API is missing. Choose a saved config in Settings → Text API.",
          );
        validateApiConfig(config);
        const preset = (await presets()).activePreset;
        controller.signal.throwIfAborted();
        const batch = await storage.beginReply(sessionId);
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
          content += text;
          await storage.updateReply(assistant.id, {
            content,
            status: "streaming",
          });
        }
        controller.signal.throwIfAborted();
        if (!content.trim()) throw new Error("The API returned no reply text.");
        return (await storage.finalizeReply(assistant.id, content))[0];
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
    },
  };
}
export const chatEngine = createChatEngine(chatStorage, () =>
  browserFoundationStorage.load(),
  openAITextProvider,
  () => browserPresetStorage.load(),
);
