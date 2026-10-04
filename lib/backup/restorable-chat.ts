import type { BackupChat } from "./types";

/** A saved snapshot cannot resume a live provider request. Keep its batch claims. */
export function restorableChat(chat: BackupChat): BackupChat {
  const interrupted = new Map(chat.messages
    .filter((message) => message.status === "streaming")
    .map((message) => [message.id, message]));
  return {
    version: 1,
    messages: chat.messages.map((message) => interrupted.has(message.id)
      ? { ...message, status: "cancelled" } : { ...message }),
    sessions: chat.sessions.map((session) => {
      const last = session.lastMessageId && interrupted.get(session.lastMessageId);
      return last ? { ...session, lastMessagePreview: last.content.slice(0, 120) || "Reply stopped" }
        : { ...session };
    }),
  };
}
