import type { ChatSession, ChatMessage } from "../chat/types";
import type { FoundationDocument } from "../foundation-types";
import type { ThemeDocument } from "../theme-types";
import type { PresetDocument } from "../preset";
import type { RegexDocument } from "../regex";
import type { WorldBookDocument } from "../worldbook";

export const BACKUP_FORMAT = "veil-backup";
export const BACKUP_VERSION = 2;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;

// Keep the backup contract explicit even if live chat records gain new fields.
export type BackupSession = Pick<ChatSession,
  "id" | "characterId" | "updatedAt" | "lastMessageId" | "lastMessagePreview" |
  "remark" | "autoReplyOnKeyboardDismiss" | "streamOnline" | "customCSS" | "nextOrder" |
  "type" | "participantIds" | "title">;
export type BackupMessage = Pick<ChatMessage,
  "id" | "sessionId" | "role" | "content" | "status" |
  "createdAt" | "order" | "requestedBy" | "error" | "quote">;
export type BackupChat = {
  version: 1;
  sessions: BackupSession[];
  messages: BackupMessage[];
};

export type BackupV1 = {
  bindings?: import("../bindings").BindingDocument;
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  foundation: FoundationDocument;
  theme: ThemeDocument;
  preset: PresetDocument;
  chat: BackupChat;
};

export type BackupV2 = Omit<BackupV1, "version"> & {
  version: typeof BACKUP_VERSION;
  regex: RegexDocument;
  worldBooks: WorldBookDocument;
};

export type Backup = BackupV1 | BackupV2;

export type BackupSources = {
  bindings?: { load(): Promise<import("../bindings").BindingDocument> };
  foundation: { load(): Promise<unknown> };
  theme: { load(): Promise<unknown> };
  preset: { load(): Promise<unknown> };
  /** Optional only for non-browser callers that predate V2; omitted sections export safe empty documents. */
  regex?: { load(): Promise<unknown> };
  worldBooks?: { load(): Promise<unknown> };
  chat: { exportBackup(): Promise<BackupChat> };
};
