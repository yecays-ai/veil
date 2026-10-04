import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import {
  BACKUP_FORMAT,
  BACKUP_MAX_BYTES,
  BACKUP_VERSION,
  type BackupSources,
  type BackupV1,
} from "./types";
import { validateBackupV1 } from "./validate";

const browserSources: BackupSources = {
  foundation: browserFoundationStorage,
  theme: browserThemeStorage,
  chat: chatStorage,
};

export type ExportedBackup = { backup: BackupV1; json: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function exportBackupV1(
  sources: BackupSources = browserSources,
  now: () => Date = () => new Date(),
): Promise<ExportedBackup> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [foundationA, themeA] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
    ]);
    const chat = await sources.chat.exportBackup();
    const [foundationB, themeB] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
    ]);
    if (
      canonical(foundationA) !== canonical(foundationB) ||
      canonical(themeA) !== canonical(themeB)
    )
      continue;
    const backup = validateBackupV1({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      foundation: foundationA,
      theme: themeA,
      chat,
    });
    const json = JSON.stringify(backup);
    if (new TextEncoder().encode(json).byteLength > BACKUP_MAX_BYTES)
      throw new Error("Backup is larger than the 32 MiB export limit.");
    return { backup, json };
  }
  throw new Error("Your data changed while the backup was being prepared. Try again.");
}
