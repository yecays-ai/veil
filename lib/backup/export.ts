import { browserBindingStorage } from "../binding-storage";
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
  type BackupV1,
  type BackupV2,
} from "./types";
import { validateBackupV1, validateBackupV2 } from "./validate";
import { stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";
import { emptyRegexDocument } from "../regex";
import { emptyWorldBookDocument } from "../worldbook";

const browserSources: BackupSources = {
  foundation: browserFoundationStorage,
  bindings: browserBindingStorage,
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
    const [foundationA, bindingsA, themeA, presetA, regexA, worldBooksA] = await Promise.all([
      sources.foundation.load(),
      sources.bindings?.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.regex?.load() ?? emptyRegexDocument(),
      sources.worldBooks?.load() ?? emptyWorldBookDocument(),
    ]);
    const chat = await sources.chat.exportBackup();
    const [foundationB, bindingsB, themeB, presetB, regexB, worldBooksB] = await Promise.all([
      sources.foundation.load(),
      sources.bindings?.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.regex?.load() ?? emptyRegexDocument(),
      sources.worldBooks?.load() ?? emptyWorldBookDocument(),
    ]);
    if (
      stableJson(foundationA) !== stableJson(foundationB) ||
      stableJson(themeA) !== stableJson(themeB) ||
      stableJson(presetA) !== stableJson(presetB) ||
      stableJson(bindingsA) !== stableJson(bindingsB) ||
      stableJson(regexA) !== stableJson(regexB) ||
      stableJson(worldBooksA) !== stableJson(worldBooksB)
    )
      continue;
    const backup = validateBackupV2({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      foundation: foundationA,
      ...(bindingsA ? { bindings: bindingsA } : {}),
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
/** Compatibility export for callers that explicitly require the legacy V1 envelope. */
export async function exportBackupV1(
  sources: BackupSources = browserSources,
  now: () => Date = () => new Date(),
): Promise<{ backup: BackupV1; json: string }> {
  const { backup } = await exportBackupV2(sources, now);
  const v1 = validateBackupV1({
    format: backup.format,
    version: 1,
    exportedAt: backup.exportedAt,
    foundation: backup.foundation,
    ...(backup.bindings ? { bindings: backup.bindings } : {}),
    theme: backup.theme,
    preset: backup.preset,
    chat: backup.chat,
  });
  return { backup: v1, json: JSON.stringify(v1) };
}
