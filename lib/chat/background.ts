import { chatStorage, type ChatStorage } from "./storage";
import { normalizeBackgroundBlur, type ChatBackgroundSettings, type ChatSession } from "./types";

export function resolveChatBackgroundImage(
  session: Pick<ChatSession, "backgroundImage"> | null | undefined,
  settings: ChatBackgroundSettings,
): string | null {
  return session?.backgroundImage || settings.globalChatBackgroundImage || null;
}

export function resolveChatBackground(
  session: Pick<ChatSession, "backgroundImage" | "backgroundBlur"> | null | undefined,
  settings: ChatBackgroundSettings,
) {
  return {
    image: resolveChatBackgroundImage(session, settings),
    blur: normalizeBackgroundBlur(session?.backgroundBlur ?? settings.blur),
  };
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
