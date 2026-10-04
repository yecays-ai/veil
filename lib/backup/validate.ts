import { normalizeFoundation, type FoundationDocument } from "../foundation-types";
import { normalizeDocument, type ThemeDocument } from "../theme-types";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupChat,
  type BackupMessage,
  type BackupSession,
  type BackupV1,
} from "./types";

const roles = new Set(["user", "assistant", "system"]);
const statuses = new Set(["sent", "streaming", "complete", "cancelled", "error"]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => typeof value === "string" && !!value;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function validSession(session: BackupSession) {
  return (
    text(session.id) &&
    text(session.characterId) &&
    Number.isFinite(session.updatedAt) &&
    integer(session.nextOrder) &&
    session.nextOrder >= 1 &&
    (session.remark === null || typeof session.remark === "string") &&
    typeof session.autoReplyOnKeyboardDismiss === "boolean" &&
    (session.lastMessageId === undefined || text(session.lastMessageId)) &&
    (session.lastMessagePreview === undefined ||
      typeof session.lastMessagePreview === "string")
  );
}

function validMessage(message: BackupMessage) {
  return (
    text(message.id) &&
    text(message.sessionId) &&
    roles.has(message.role) &&
    statuses.has(message.status) &&
    typeof message.content === "string" &&
    Number.isFinite(message.createdAt) &&
    integer(message.order) &&
    message.order >= 1 &&
    (message.requestedBy === undefined || text(message.requestedBy)) &&
    (message.error === undefined || typeof message.error === "string")
  );
}

function stableChat(chat: BackupChat): BackupChat {
  const sessions = [...chat.sessions].sort((a, b) => a.id.localeCompare(b.id));
  const messages = [...chat.messages].sort(
    (a, b) =>
      a.sessionId.localeCompare(b.sessionId) ||
      a.order - b.order ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!validSession(session) || ids.has(session.id))
      throw new Error("Chat backup contains duplicate or invalid session IDs.");
    ids.add(session.id);
  }
  const messageIds = new Set<string>();
  const orders = new Set<string>();
  for (const message of messages) {
    const orderKey = `${message.sessionId}:${message.order}`;
    if (
      !validMessage(message) ||
      messageIds.has(message.id) ||
      !ids.has(message.sessionId) ||
      orders.has(orderKey)
    )
      throw new Error("Chat backup contains messages without a valid session.");
    messageIds.add(message.id);
    orders.add(orderKey);
  }
  for (const session of sessions) {
    const sessionMessages = messages.filter(
      (message) => message.sessionId === session.id,
    );
    const maxOrder = sessionMessages
      .reduce((max, message) => Math.max(max, message.order), 0);
    if (session.nextOrder <= maxOrder)
      throw new Error("Chat backup contains an invalid session message order.");
    if (
      session.lastMessageId !== undefined &&
      !sessionMessages.some((message) => message.id === session.lastMessageId)
    )
      throw new Error("Chat backup contains an invalid last message reference.");
  }
  return { version: 1, sessions, messages };
}

export function validateBackupV1(value: unknown): BackupV1 {
  const backup = record(value);
  const chat = record(backup.chat);
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION)
    throw new Error("Unsupported backup format.");
  if (
    typeof backup.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(backup.exportedAt))
  )
    throw new Error("Backup has an invalid export time.");
  if (
    chat.version !== 1 ||
    !Array.isArray(chat.sessions) ||
    !Array.isArray(chat.messages)
  )
    throw new Error("Backup has invalid chat data.");
  const foundation: FoundationDocument = normalizeFoundation(backup.foundation);
  const theme: ThemeDocument = normalizeDocument(backup.theme);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    foundation,
    theme,
    chat: stableChat(chat as BackupChat),
  };
}
