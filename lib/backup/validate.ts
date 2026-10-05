import { normalizeBindings } from "../bindings";
import { normalizeFoundation, type FoundationDocument } from "../foundation-types";
import { normalizeDocument, type ThemeDocument } from "../theme-types";
import { createPresetDocument, validatePresetDocument } from "../preset";
import { emptyRegexDocument, validateRegexDocument } from "../regex";
import { emptyWorldBookDocument, validateWorldBookDocument } from "../worldbook";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  type BackupChat,
  type BackupMessage,
  type BackupSession,
  type BackupV1,
  type BackupV2,
} from "./types";
import { stableJson } from "./equality";
import { migrateLegacyWidgetCharacters } from "../legacy-widget-character";

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
    onlyKeys(session, ["id", "characterId", "type", "participantIds", "title", "updatedAt", "nextOrder", "remark",
      "autoReplyOnKeyboardDismiss", "streamOnline", "customCSS", "lastMessageId", "lastMessagePreview"]) &&
    text(session.id) &&
    text(session.characterId) &&
    (session.type === undefined || session.type === "direct" || session.type === "group") &&
    (session.participantIds === undefined || (Array.isArray(session.participantIds) &&
      session.participantIds.length >= 2 && session.participantIds.every(text) &&
      new Set(session.participantIds).size === session.participantIds.length)) &&
    (session.title === undefined || text(session.title)) &&
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
      "order", "requestedBy", "error", "quote"]) &&
    text(message.id) &&
    text(message.sessionId) &&
    roles.has(message.role) &&
    statuses.has(message.status) &&
    typeof message.content === "string" &&
    timestamp(message.createdAt) &&
    integer(message.order) &&
    message.order >= 1 &&
    (message.requestedBy === undefined || text(message.requestedBy)) &&
    (message.error === undefined || typeof message.error === "string") &&
    (message.quote === undefined || (onlyKeys(message.quote, ["messageId", "preview", "role"]) &&
      text(message.quote.messageId) && typeof message.quote.preview === "string" &&
      (message.quote.role === "user" || message.quote.role === "assistant")))
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
  if (sessionById.size !== sessions.length)
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
  if (backup.format !== BACKUP_FORMAT || backup.version !== 1)
    throw new Error("Unsupported backup format.");
  if (!onlyKeys(value, ["format", "version", "exportedAt", "foundation", "bindings", "theme", "preset", "chat"]) ||
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
  const foundationInput = { ...record(backup.foundation) };
  const legacySelection = Object.hasOwn(foundationInput, "selectedCharacterId");
  delete foundationInput.selectedCharacterId;
  const bindingInput = backup.bindings ?? foundationInput.bindings;
  delete foundationInput.bindings;
  const bindings = bindingInput === undefined ? undefined : normalizeBindings(bindingInput,
    foundation.characters.map((character) => character.characterId));
  if (bindings && stableJson(bindingInput) !== stableJson(bindings))
    throw new Error("Backup contains invalid bindings.");
  const theme: ThemeDocument = normalizeDocument(backup.theme);
  const preset = backup.preset === undefined
    ? createPresetDocument()
    : validatePresetDocument(backup.preset);
  if (
    stableJson(foundationInput) !== stableJson(foundation) ||
    stableJson(backup.theme) !== stableJson(theme)
  )
    throw new Error("Backup contains invalid profile or appearance data.");
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: backup.exportedAt,
    foundation,
    ...(bindings ? { bindings } : {}),
    theme: legacySelection ? migrateLegacyWidgetCharacters(theme, backup.foundation) : theme,
    preset,
    chat: stableChat(chat as BackupChat),
  };
}

/** V2 is strict: its complete envelope and both new document types must validate exactly. */
export function validateBackupV2(value: unknown): BackupV2 {
  const backup = record(value);
  if (backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION)
    throw new Error("Unsupported backup format.");
  if (!onlyKeys(value, ["format", "version", "exportedAt", "foundation", "bindings", "theme", "preset", "regex", "worldBooks", "chat"]))
    throw new Error("Backup contains unsupported fields.");
  const legacy = validateBackupV1({
    format: backup.format,
    version: 1,
    exportedAt: backup.exportedAt,
    foundation: backup.foundation,
    bindings: backup.bindings,
    theme: backup.theme,
    preset: backup.preset,
    chat: backup.chat,
  });
  const regex = validateRegexDocument(backup.regex);
  const worldBooks = validateWorldBookDocument(backup.worldBooks);
  return { ...legacy, version: BACKUP_VERSION, regex, worldBooks };
}

/** V1 remains importable; its newer documents deliberately remain absent. */
export function validateBackup(value: unknown): Backup {
  const backup = record(value);
  if (backup.version === 1) return validateBackupV1(value);
  if (backup.version === BACKUP_VERSION) return validateBackupV2(value);
  throw new Error("Unsupported backup format.");
}

export const missingBackupDocuments = () => ({
  regex: emptyRegexDocument(),
  worldBooks: emptyWorldBookDocument(),
});
