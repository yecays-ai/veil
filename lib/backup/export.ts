import { browserBindingStorage } from "../binding-storage";
import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { browserPresetStorage } from "../preset-storage";
import {
  BACKUP_FORMAT,
  BACKUP_MAX_BYTES,
  BACKUP_VERSION,
  type BackupSources,
  type BackupV1,
} from "./types";
import { validateBackupV1 } from "./validate";
import { stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";

const browserSources: BackupSources = {
  foundation: browserFoundationStorage,
  bindings: browserBindingStorage,
  theme: browserThemeStorage,
  preset: browserPresetStorage,
  chat: chatStorage,
};

export type ExportedBackup = { backup: BackupV1; json: string };

export async function exportBackupV1(
  sources: BackupSources = browserSources,
  now: () => Date = () => new Date(),
): Promise<ExportedBackup> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [foundationA, themeA, presetA, bindingsA] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.bindings?.load(),
    ]);
    const chat = await sources.chat.exportBackup();
    const [foundationB, themeB, presetB, bindingsB] = await Promise.all([
      sources.foundation.load(),
      sources.theme.load(),
      sources.preset.load(),
      sources.bindings?.load(),
    ]);
    if (
      stableJson(foundationA) !== stableJson(foundationB) ||
      stableJson(themeA) !== stableJson(themeB) ||
      stableJson(presetA) !== stableJson(presetB) || stableJson(bindingsA) !== stableJson(bindingsB)
    )
      continue;
    const backup = validateBackupV1({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      foundation: foundationA,
      ...(bindingsA ? { bindings: bindingsA } : {}),
      theme: themeA,
      preset: presetA,
      chat: restorableChat(chat),
    });
    const json = JSON.stringify(backup);
    if (new TextEncoder().encode(json).byteLength > BACKUP_MAX_BYTES)
      throw new Error("Backup is larger than the 32 MiB export limit.");
    return { backup, json };
  }
  throw new Error("Your data changed while the backup was being prepared. Try again.");
}
