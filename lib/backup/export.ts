import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { browserPresetStorage } from "../preset-storage";
import { browserRegexStorage } from "../regex-storage";
import { browserWorldBookStorage } from "../worldbook-storage";
import {
  BACKUP_FORMAT,
  BACKUP_MAX_BYTES,
  BACKUP_VERSION,
  type BackupSources,
  type BackupV2,
} from "./types";
import { validateBackupV2 } from "./validate";
import { stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";
import { emptyRegexDocument } from "../regex";
import { emptyWorldBookDocument } from "../worldbook";

const browserSources: BackupSources = {
  foundation: browserFoundationStorage,
  theme: browserThemeStorage,
  preset: browserPresetStorage,
  regex: browserRegexStorage,
  worldBooks: browserWorldBookStorage,
  chat: chatStorage,
};

export type ExportedBackup = { backup: BackupV2; json: string };

export async function exportBackupV2(
  sources: BackupSources = browserSources,
  now: () => Date = () => new Date(),
): Promise<ExportedBackup> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [foundationA, themeA, presetA, regexA, worldBooksA] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.regex?.load() ?? emptyRegexDocument(),
      sources.worldBooks?.load() ?? emptyWorldBookDocument(),
    ]);
    const chat = await sources.chat.exportBackup();
    const [foundationB, themeB, presetB, regexB, worldBooksB] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.regex?.load() ?? emptyRegexDocument(),
      sources.worldBooks?.load() ?? emptyWorldBookDocument(),
    ]);
    if (
      stableJson(foundationA) !== stableJson(foundationB) ||
      stableJson(themeA) !== stableJson(themeB) ||
      stableJson(presetA) !== stableJson(presetB) ||
      stableJson(regexA) !== stableJson(regexB) ||
      stableJson(worldBooksA) !== stableJson(worldBooksB)
    )
      continue;
    const backup = validateBackupV2({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      foundation: foundationA,
      theme: themeA,
      preset: presetA,
      regex: regexA,
      worldBooks: worldBooksA,
      chat: restorableChat(chat),
    });
    const json = JSON.stringify(backup);
    if (new TextEncoder().encode(json).byteLength > BACKUP_MAX_BYTES)
      throw new Error("Backup is larger than the 32 MiB export limit.");
    return { backup, json };
  }
  throw new Error("Your data changed while the backup was being prepared. Try again.");
}

export const exportBackup = exportBackupV2;
/** @deprecated Exports are V2 from this release onward. */
export const exportBackupV1 = exportBackupV2;
