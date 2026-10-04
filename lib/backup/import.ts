import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupV1 } from "./types";
import { validateBackupV1 } from "./validate";
import { sameBackupChat, stableJson } from "./equality";

type RestoreDocument<T> = {
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: T): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
};
export type RestoreSources = {
  foundation: RestoreDocument<BackupV1["foundation"]>;
  theme: RestoreDocument<BackupV1["theme"]>;
  chat: {
    exportBackup(): Promise<BackupChat>;
    replaceBackup(expected: BackupChat, backup: BackupChat): Promise<void>;
  };
};
const browserSources: RestoreSources = {
  foundation: browserFoundationStorage,
  theme: browserThemeStorage,
  chat: chatStorage,
};
const snapshot = (sources: RestoreSources) => Promise.all([
  sources.foundation.readRaw(), sources.theme.readRaw(), sources.chat.exportBackup(),
]);
function replacement<T>(store: RestoreDocument<T>, before: string | null, next: T) {
  return {
    matches: () => before === null || stableJson(JSON.parse(before)) === stableJson(next),
    async apply() {
      const target = await store.replaceIfCurrent(before, next);
      return () => store.rollbackIfCurrent(target, before);
    },
  };
}
export const isOverwriteConfirmationValid = (value: string) => value === "RESTORE";

export function parseBackupV1(text: string): BackupV1 {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES)
    throw new Error("Backup is larger than the 32 MiB import limit.");
  return validateBackupV1(JSON.parse(text));
}

export async function requiresOverwriteRestore(sources = browserSources) {
  const [foundation, theme, chat] = await snapshot(sources);
  return foundation !== null || theme !== null || !!chat.sessions.length || !!chat.messages.length;
}

/** Both empty and confirmed overwrite restores use the same guarded writes and rollback. */
export async function restoreBackupV1(
  backup: BackupV1, sources = browserSources, overwrite = false,
): Promise<void> {
  const safe = validateBackupV1(backup);
  const [foundation, theme, chat] = await snapshot(sources);
  const documents = [
    replacement(sources.foundation, foundation, safe.foundation),
    replacement(sources.theme, theme, safe.theme),
  ];
  if (!overwrite && (
    documents.some(({ matches }) => !matches()) ||
    ((chat.sessions.length || chat.messages.length) && !sameBackupChat(chat, safe.chat))
  )) throw new Error("Restore is only available for an empty installation. Existing data was not changed.");

  const undo: Array<() => Promise<boolean>> = [];
  try {
    for (const document of documents) undo.push(await document.apply());
    await sources.chat.replaceBackup(chat, safe.chat);
  } catch (error) {
    let complete = true;
    for (const rollback of undo.reverse()) {
      try { if (!await rollback()) complete = false; }
      catch { complete = false; }
    }
    const reason = error instanceof Error ? error.message : "Restore failed.";
    const result = complete ? "Previous data was restored." : "Rollback was incomplete.";
    throw new Error(`${reason} ${result} Reload VEIL before trying again.`);
  }
}
