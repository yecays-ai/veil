import type { BindingDocument } from "../bindings";
import type { ChatSession, ChatMessage } from "../chat/types";
import type { FoundationDocument } from "../foundation-types";
import type { ThemeDocument } from "../theme-types";
import type { PresetDocument } from "../preset";
import type { RegexDocument } from "../regex";
import type { WorldBookDocument } from "../worldbook";

export const BACKUP_FORMAT = "veil-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;

export type BackupSession = Pick<ChatSession,
  "id" | "characterId" | "updatedAt" | "lastMessageId" | "lastMessagePreview" |
  "remark" | "autoReplyOnKeyboardDismiss" | "streamOnline" | "customCSS" | "nextOrder" |
  "type" | "participantIds" | "title">;
export type BackupMessage = Pick<ChatMessage,
  "id" | "sessionId" | "role" | "content" | "status" |
  "createdAt" | "order" | "requestedBy" | "error" | "quote">;
export type BackupChat = { version: 1; sessions: BackupSession[]; messages: BackupMessage[] };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  foundation: FoundationDocument;
  bindings: BindingDocument;
  theme: ThemeDocument;
  preset: PresetDocument;
  regex: RegexDocument;
  worldBooks: WorldBookDocument;
  chat: BackupChat;
};

export type BackupSources = {
  foundation: { load(): Promise<unknown> };
  bindings: { load(): Promise<BindingDocument> };
  theme: { load(): Promise<unknown> };
  preset: { load(): Promise<unknown> };
  regex: { load(): Promise<unknown> };
  worldBooks: { load(): Promise<unknown> };
  chat: { exportBackup(): Promise<BackupChat> };
};
