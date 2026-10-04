import { chatStorage, type ChatStorage } from "./storage";
import type { ChatBackgroundSettings, ChatSession } from "./types";

export function resolveChatBackgroundImage(
  session: Pick<ChatSession, "backgroundImage"> | null | undefined,
  settings: ChatBackgroundSettings,
): string | null {
  return session?.backgroundImage || settings.globalChatBackgroundImage || null;
}

export function saveChatImageToIndexedDB(
  blob: Blob,
  storage: ChatStorage = chatStorage,
) {
  return storage.saveChatImage(blob);
}

export function getChatImageFromIndexedDB(
  id: string,
  storage: ChatStorage = chatStorage,
) {
  return storage.readChatImage(id);
}
