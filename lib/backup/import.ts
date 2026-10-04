import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { normalizeFoundation } from "../foundation-types";
import { normalizeDocument } from "../theme-types";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupV1 } from "./types";
import { validateBackupV1 } from "./validate";
import { sameBackupChat, stableJson } from "./equality";

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

export type OverwriteRestoreSources = {
  foundation: {
    readRaw(): Promise<string | null>;
    replaceIfCurrent(
      expected: string | null,
      document: ReturnType<typeof normalizeFoundation>,
    ): Promise<string>;
    rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
  };
  theme: {
    readRaw(): Promise<string | null>;
    replaceIfCurrent(
      expected: string | null,
      document: ReturnType<typeof normalizeDocument>,
    ): Promise<string>;
    rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
  };
  chat: {
    exportBackup(): Promise<BackupChat>;
    replaceBackup(expected: BackupChat, backup: BackupChat): Promise<void>;
  };
};

const browserOverwriteSources: OverwriteRestoreSources = {
  foundation: browserFoundationStorage,
  theme: browserThemeStorage,
  chat: chatStorage,
};

export async function requiresOverwriteRestore(
  sources: Pick<OverwriteRestoreSources, "foundation" | "theme" | "chat"> =
    browserOverwriteSources,
): Promise<boolean> {
  const [foundation, theme, chat] = await Promise.all([
    sources.foundation.readRaw(),
    sources.theme.readRaw(),
    sources.chat.exportBackup(),
  ]);
  return foundation !== null || theme !== null || !!chat.sessions.length || !!chat.messages.length;
}

export function isOverwriteConfirmationValid(value: string): boolean {
  return value === "RESTORE";
}

export async function overwriteRestoreBackupV1(
  backup: BackupV1,
  sources: OverwriteRestoreSources = browserOverwriteSources,
): Promise<void> {
  const safeBackup = validateBackupV1(backup);
  const [foundationBefore, themeBefore, chatBefore] = await Promise.all([
    sources.foundation.readRaw(),
    sources.theme.readRaw(),
    sources.chat.exportBackup(),
  ]);
  let foundationTarget: string | undefined;
  let themeTarget: string | undefined;
  try {
    foundationTarget = await sources.foundation.replaceIfCurrent(
      foundationBefore,
      normalizeFoundation(safeBackup.foundation),
    );
    themeTarget = await sources.theme.replaceIfCurrent(
      themeBefore,
      normalizeDocument(safeBackup.theme),
    );
    await sources.chat.replaceBackup(chatBefore, safeBackup.chat);
  } catch (error) {
    const rollbackErrors: string[] = [];
    if (themeTarget) {
      try {
        if (!(await sources.theme.rollbackIfCurrent(themeTarget, themeBefore)))
          rollbackErrors.push("appearance changed before rollback");
      } catch {
        rollbackErrors.push("appearance rollback failed");
      }
    }
    if (foundationTarget) {
      try {
        if (
          !(await sources.foundation.rollbackIfCurrent(
            foundationTarget,
            foundationBefore,
          ))
        )
          rollbackErrors.push("profile data changed before rollback");
      } catch {
        rollbackErrors.push("profile rollback failed");
      }
    }
    const message = error instanceof Error ? error.message : "Restore could not be completed.";
    const rollback = rollbackErrors.length
      ? ` Rollback was incomplete: ${rollbackErrors.join(", ")}.`
      : " Previous data was restored.";
    throw new Error(`${message}${rollback} Reload VEIL before trying again.`);
  }
}

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
  const foundationMatches = stableJson(normalizeFoundation(currentFoundation)) === stableJson(foundation);
  const themeMatches = stableJson(normalizeDocument(currentTheme)) === stableJson(theme);
  const chatMatches = sameBackupChat(currentChat, safeBackup.chat);
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
