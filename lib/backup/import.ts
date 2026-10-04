import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { normalizeFoundation } from "../foundation-types";
import { normalizeDocument } from "../theme-types";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupV1 } from "./types";
import { validateBackupV1 } from "./validate";

export type BackupSummary = {
  exportedAt: string;
  characters: number;
  sessions: number;
  messages: number;
  note: string;
};

export function parseBackupV1(text: string): BackupV1 {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES)
    throw new Error("Backup is larger than the 32 MiB import limit.");
  try {
    return validateBackupV1(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Backup file could not be read.");
  }
}

export function summarizeBackupV1(backup: BackupV1): BackupSummary {
  const foundation = normalizeFoundation(backup.foundation);
  return {
    exportedAt: backup.exportedAt,
    characters: foundation.characters.length,
    sessions: backup.chat.sessions.length,
    messages: backup.chat.messages.length,
    note: "Text API configurations and API keys are not included.",
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sameChat(a: BackupChat, b: BackupChat) {
  const sort = (chat: BackupChat) => ({
    ...chat,
    sessions: [...chat.sessions].sort((x, y) => x.id.localeCompare(y.id)),
    messages: [...chat.messages].sort(
      (x, y) =>
        x.sessionId.localeCompare(y.sessionId) ||
        x.order - y.order ||
        x.id.localeCompare(y.id),
    ),
  });
  return canonical(sort(a)) === canonical(sort(b));
}

export type RestoreSources = {
  foundation: {
    load(): Promise<unknown>;
    hasStoredDocument(): Promise<boolean>;
    replaceIfEmpty(document: ReturnType<typeof normalizeFoundation>): Promise<unknown>;
  };
  theme: {
    load(): Promise<unknown>;
    hasStoredDocument(): Promise<boolean>;
    saveIfEmpty(document: ReturnType<typeof normalizeDocument>): Promise<void>;
  };
  chat: { exportBackup(): Promise<BackupChat>; importBackup(backup: BackupChat): Promise<void> };
};

const browserRestoreSources: RestoreSources = {
  foundation: browserFoundationStorage,
  theme: browserThemeStorage,
  chat: chatStorage,
};

export async function restoreBackupV1(
  backup: BackupV1,
  sources: RestoreSources = browserRestoreSources,
): Promise<void> {
  const safeBackup = validateBackupV1(backup);
  const [foundationStored, themeStored, currentFoundation, currentTheme, currentChat] =
    await Promise.all([
      sources.foundation.hasStoredDocument(),
      sources.theme.hasStoredDocument(),
      sources.foundation.load(),
      sources.theme.load(),
      sources.chat.exportBackup(),
    ]);
  const foundation = normalizeFoundation(safeBackup.foundation);
  const theme = normalizeDocument(safeBackup.theme);
  const foundationMatches = canonical(normalizeFoundation(currentFoundation)) === canonical(foundation);
  const themeMatches = canonical(normalizeDocument(currentTheme)) === canonical(theme);
  const chatMatches = sameChat(currentChat, safeBackup.chat);
  if (
    (foundationStored && !foundationMatches) ||
    (themeStored && !themeMatches) ||
    ((currentChat.sessions.length || currentChat.messages.length) && !chatMatches)
  )
    throw new Error("Restore is only available for an empty installation. Existing data was not changed.");

  try {
    if (!foundationStored && !foundationMatches)
      await sources.foundation.replaceIfEmpty(foundation);
    if (!themeStored && !themeMatches) await sources.theme.saveIfEmpty(theme);
    if (!chatMatches) await sources.chat.importBackup(safeBackup.chat);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restore could not be completed.";
    throw new Error(`${message} You can retry the same backup; existing data was never cleared.`);
  }
}
