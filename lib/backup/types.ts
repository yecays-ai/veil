import type { ChatSession, ChatMessage } from "../chat/types";
import type { FoundationDocument } from "../foundation-types";
import type { ThemeDocument } from "../theme-types";
import type { PresetDocument } from "../preset";

export const BACKUP_FORMAT = "veil-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;

// Keep the backup contract explicit even if live chat records gain new fields.
export type BackupSession = Pick<ChatSession,
  "id" | "characterId" | "updatedAt" | "lastMessageId" | "lastMessagePreview" |
  "remark" | "autoReplyOnKeyboardDismiss" | "streamOnline" | "nextOrder">;
export type BackupMessage = Pick<ChatMessage,
  "id" | "sessionId" | "role" | "content" | "status" |
  "createdAt" | "order" | "requestedBy" | "error">;
export type BackupChat = {
  version: 1;
  sessions: BackupSession[];
  messages: BackupMessage[];
};

export type BackupV1 = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  foundation: FoundationDocument;
  theme: ThemeDocument;
  preset: PresetDocument;
  chat: BackupChat;
};

export type BackupSources = {
  foundation: { load(): Promise<unknown> };
  theme: { load(): Promise<unknown> };
  preset: { load(): Promise<unknown> };
  chat: { exportBackup(): Promise<BackupChat> };
};
