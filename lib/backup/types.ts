export const BACKUP_FORMAT = "veil-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;

export type BackupSession = {
  id: string;
  characterId: string;
  updatedAt: number;
  lastMessageId?: string;
  lastMessagePreview?: string;
  remark: string | null;
  autoReplyOnKeyboardDismiss: boolean;
  nextOrder: number;
};
export type BackupMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "sent" | "streaming" | "complete" | "cancelled" | "error";
  createdAt: number;
  order: number;
  requestedBy?: string;
  error?: string;
};
export type BackupChat = {
  version: 1;
  sessions: BackupSession[];
  messages: BackupMessage[];
};

export type BackupV1 = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  foundation: unknown;
  theme: unknown;
  chat: BackupChat;
};

export type BackupSources = {
  foundation: { load(): Promise<unknown> };
  theme: { load(): Promise<unknown> };
  chat: { exportBackup(): Promise<BackupChat> };
};
