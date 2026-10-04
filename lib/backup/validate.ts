import { normalizeFoundation, type FoundationDocument } from "../foundation-types";
import { normalizeDocument, type ThemeDocument } from "../theme-types";
import { createPresetDocument, validatePresetDocument } from "../preset";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupChat,
  type BackupMessage,
  type BackupSession,
  type BackupV1,
} from "./types";
import { stableJson } from "./equality";

const roles = new Set(["user", "assistant", "system"]);
const statuses = new Set(["sent", "streaming", "complete", "cancelled", "error"]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => typeof value === "string" && !!value;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
const onlyKeys = (value: unknown, keys: string[]) =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

function validSession(session: BackupSession) {
  return (
    onlyKeys(session, ["id", "characterId", "updatedAt", "nextOrder", "remark",
      "autoReplyOnKeyboardDismiss", "streamOnline", "customCSS", "lastMessageId", "lastMessagePreview"]) &&
    text(session.id) &&
    text(session.characterId) &&
    timestamp(session.updatedAt) &&
    integer(session.nextOrder) &&
    session.nextOrder >= 1 &&
    (session.remark === null || typeof session.remark === "string") &&
    typeof session.autoReplyOnKeyboardDismiss === "boolean" &&
    (session.streamOnline === undefined || typeof session.streamOnline === "boolean") &&
    (session.customCSS === undefined || typeof session.customCSS === "string") &&
    (session.lastMessageId === undefined || text(session.lastMessageId)) &&
    (session.lastMessagePreview === undefined ||
      typeof session.lastMessagePreview === "string")
  );
}

function validMessage(message: BackupMessage) {
  return (
    onlyKeys(message, ["id", "sessionId", "role", "status", "content", "createdAt",
      "order", "requestedBy", "error"]) &&
    text(message.id) &&
    text(message.sessionId) &&
    roles.has(message.role) &&
    statuses.has(message.status) &&
    typeof message.content === "string" &&
    timestamp(message.createdAt) &&
    integer(message.order) &&
    message.order >= 1 &&
    (message.requestedBy === undefined || text(message.requestedBy)) &&
    (message.error === undefined || typeof message.error === "string")
  );
}

function stableChat(chat: BackupChat): BackupChat {
  if (chat.sessions.some((s) => !s || !validSession(s)) ||
      chat.messages.some((m) => !m || !validMessage(m)))
    throw new Error("Chat backup contains invalid sessions or messages.");
  const sessions = [...chat.sessions].sort((a, b) => a.id.localeCompare(b.id));
  const messages = [...chat.messages].sort((a, b) =>
    a.sessionId.localeCompare(b.sessionId) || a.order - b.order || a.id.localeCompare(b.id));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const messageById = new Map(messages.map((m) => [m.id, m]));
  if (sessionById.size !== sessions.length ||
      new Set(sessions.map((s) => s.characterId)).size !== sessions.length)
    throw new Error("Chat backup contains duplicate or invalid session IDs.");
  if (messageById.size !== messages.length ||
      new Set(messages.map((m) => JSON.stringify([m.sessionId, m.order]))).size !== messages.length)
    throw new Error("Chat backup contains duplicate messages or orders.");
  for (const message of messages) {
    const session = sessionById.get(message.sessionId);
    if (!session || message.order >= session.nextOrder)
      throw new Error("Chat backup contains an invalid session message order.");
    if (message.requestedBy !== undefined) {
      const reply = messageById.get(message.requestedBy);
      if (message.role !== "user" || !reply || reply.sessionId !== message.sessionId ||
          reply.role !== "assistant" || reply.order <= message.order)
        throw new Error("Chat backup contains an invalid reply batch reference.");
    }
  }
  for (const session of sessions) {
    if (session.lastMessageId !== undefined &&
        messageById.get(session.lastMessageId)?.sessionId !== session.id)
      throw new Error("Chat backup contains an invalid last message reference.");
  }
  return { version: 1, sessions, messages };
}

export function validateBackupV1(value: unknown): BackupV1 {
  const backup = record(value);
  const chat = record(backup.chat);
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION)
    throw new Error("Unsupported backup format.");
  if (!onlyKeys(value, ["format", "version", "exportedAt", "foundation", "theme", "preset", "chat"]) ||
      !onlyKeys(backup.chat, ["version", "sessions", "messages"]))
    throw new Error("Backup contains unsupported fields.");
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
  const preset = backup.preset === undefined
    ? createPresetDocument()
    : validatePresetDocument(backup.preset);
  if (
    stableJson(backup.foundation) !== stableJson(foundation) ||
    stableJson(backup.theme) !== stableJson(theme)
  )
    throw new Error("Backup contains invalid profile or appearance data.");
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: backup.exportedAt,
    foundation,
    theme,
    preset,
    chat: stableChat(chat as BackupChat),
  };
}
