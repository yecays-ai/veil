import { browserBindingStorage } from "../binding-storage";
import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { browserPresetStorage } from "../preset-storage";
import { browserRegexStorage } from "../regex-storage";
import { browserWorldBookStorage } from "../worldbook-storage";
import { BACKUP_FORMAT, BACKUP_MAX_BYTES, BACKUP_VERSION,
  type Backup, type BackupSources } from "./types";
import { validateBackup } from "./validate";
import { stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";

const browserSources: BackupSources = {
  foundation: browserFoundationStorage,
  bindings: browserBindingStorage,
  theme: browserThemeStorage,
  preset: browserPresetStorage,
  regex: browserRegexStorage,
  worldBooks: browserWorldBookStorage,
  chat: chatStorage,
};

export type ExportedBackup = { backup: Backup; json: string };

export async function exportBackup(
  sources: BackupSources = browserSources,
  now: () => Date = () => new Date(),
): Promise<ExportedBackup> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await Promise.all([
      sources.foundation.load(), sources.bindings.load(), sources.theme.load(),
      sources.preset.load(), sources.regex.load(), sources.worldBooks.load(),
    ]);
    const chat = await sources.chat.exportBackup();
    const after = await Promise.all([
      sources.foundation.load(), sources.bindings.load(), sources.theme.load(),
      sources.preset.load(), sources.regex.load(), sources.worldBooks.load(),
    ]);
    if (before.some((value, index) => stableJson(value) !== stableJson(after[index]))) continue;
    const backup = validateBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now().toISOString(),
      foundation: before[0], bindings: before[1], theme: before[2], preset: before[3],
      regex: before[4], worldBooks: before[5], chat: restorableChat(chat),
    });
    const json = JSON.stringify(backup);
    if (new TextEncoder().encode(json).byteLength > BACKUP_MAX_BYTES)
      throw new Error("Backup is larger than the 32 MiB export limit.");
    return { backup, json };
  }
  throw new Error("Your data changed while the backup was being prepared. Try again.");
}
