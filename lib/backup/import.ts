import { browserBindingStorage } from "../binding-storage";
import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { browserPresetStorage } from "../preset-storage";
import { browserRegexStorage } from "../regex-storage";
import { browserWorldBookStorage } from "../worldbook-storage";
import { createPresetDocument, validatePresetDocument } from "../preset";
import { defaultRegexGroup } from "../regex-defaults";
import { emptyRegexDocument, validateRegexDocument } from "../regex";
import { emptyWorldBookDocument, validateWorldBookDocument } from "../worldbook";
import { BACKUP_MAX_BYTES, type Backup, type BackupChat } from "./types";
import { validateBackup } from "./validate";
import { sameBackupChat, stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";

type RestoreDocument<T> = {
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: T): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
};
export type RestoreSources = {
  foundation: RestoreDocument<Backup["foundation"]>;
  bindings: RestoreDocument<Backup["bindings"]>;
  theme: RestoreDocument<Backup["theme"]>;
  preset: RestoreDocument<Backup["preset"]>;
  regex: RestoreDocument<Backup["regex"]>;
  worldBooks: RestoreDocument<Backup["worldBooks"]>;
  chat: { exportBackup(): Promise<BackupChat>;
    replaceBackup(expected: BackupChat, backup: BackupChat): Promise<void> };
};
const browserSources: RestoreSources = {
  foundation: browserFoundationStorage, bindings: browserBindingStorage,
  theme: browserThemeStorage, preset: browserPresetStorage, regex: browserRegexStorage,
  worldBooks: browserWorldBookStorage, chat: chatStorage,
};
const snapshot = (sources: RestoreSources) => Promise.all([
  sources.foundation.readRaw(), sources.bindings.readRaw(), sources.theme.readRaw(),
  sources.preset.readRaw(), sources.regex.readRaw(), sources.worldBooks.readRaw(),
  sources.chat.exportBackup(),
]);
function replacement<T>(store: RestoreDocument<T>, before: string | null, next: T,
  empty?: T | T[], normalize: (value: unknown) => unknown = (value) => value) {
  return {
    matches: () => before === null || stableJson(normalize(JSON.parse(before))) === stableJson(next) ||
      (empty !== undefined && (Array.isArray(empty) ? empty : [empty]).some((candidate) =>
        stableJson(normalize(JSON.parse(before))) === stableJson(candidate))),
    async apply() {
      const target = await store.replaceIfCurrent(before, next);
      return () => store.rollbackIfCurrent(target, before);
    },
  };
}

export const isOverwriteConfirmationValid = (value: string) => value === "RESTORE";

export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES)
    throw new Error("Backup is larger than the 32 MiB import limit.");
  return validateBackup(JSON.parse(text));
}

export async function requiresOverwriteRestore(sources: RestoreSources = browserSources) {
  const [foundation, bindings, theme, preset, regex, worldBooks, chat] = await snapshot(sources);
  let customPreset = false, customRegex = false, customWorldBooks = false;
  try { customPreset = preset !== null && stableJson(validatePresetDocument(JSON.parse(preset))) !==
    stableJson(createPresetDocument()); } catch { customPreset = true; }
  try { customRegex = regex !== null && stableJson(validateRegexDocument(JSON.parse(regex))) !==
    stableJson({ version: 1, groups: [defaultRegexGroup()] }) &&
    stableJson(validateRegexDocument(JSON.parse(regex))) !== stableJson(emptyRegexDocument()); }
  catch { customRegex = true; }
  try { customWorldBooks = worldBooks !== null && stableJson(validateWorldBookDocument(JSON.parse(worldBooks))) !==
    stableJson(emptyWorldBookDocument()); } catch { customWorldBooks = true; }
  return foundation !== null || theme !== null || customPreset || customRegex || customWorldBooks ||
    (bindings !== null && stableJson(JSON.parse(bindings)) !== stableJson({ global: {}, characters: {} })) ||
    !!chat.sessions.length || !!chat.messages.length;
}

export async function restoreBackup(backup: Backup, sources: RestoreSources = browserSources,
  overwrite = false): Promise<void> {
  const validated = validateBackup(backup);
  const safe = { ...validated, chat: restorableChat(validated.chat) };
  const [foundation, bindings, theme, preset, regex, worldBooks, chat] = await snapshot(sources);
  const documents = [
    replacement(sources.bindings, bindings, safe.bindings),
    replacement(sources.foundation, foundation, safe.foundation),
    replacement(sources.theme, theme, safe.theme),
    replacement(sources.preset, preset, safe.preset, createPresetDocument(), validatePresetDocument),
    replacement(sources.regex, regex, safe.regex,
      [{ version: 1, groups: [defaultRegexGroup()] }, emptyRegexDocument()], validateRegexDocument),
    replacement(sources.worldBooks, worldBooks, safe.worldBooks,
      emptyWorldBookDocument(), validateWorldBookDocument),
  ];
  if (!overwrite && (documents.some(({ matches }) => !matches()) ||
      ((chat.sessions.length || chat.messages.length) && !sameBackupChat(chat, safe.chat))))
    throw new Error("Restore is only available for an empty installation. Existing data was not changed.");

  const undo: Array<() => Promise<boolean>> = [];
  try {
    for (const document of documents) undo.push(await document.apply());
    await sources.chat.replaceBackup(chat, safe.chat);
    undo.push(async () => { await sources.chat.replaceBackup(safe.chat, chat); return true; });
    const final = await snapshot(sources);
    if (final.slice(0, 6).some((raw, index) => raw === null ||
        stableJson(JSON.parse(raw as string)) !== stableJson([
          safe.foundation, safe.bindings, safe.theme, safe.preset, safe.regex, safe.worldBooks,
        ][index])) || !sameBackupChat(final[6], safe.chat))
      throw new Error("Your data changed during restore.");
  } catch (error) {
    let complete = true;
    for (const rollback of undo.reverse()) {
      try { if (!await rollback()) complete = false; } catch { complete = false; }
    }
    const reason = error instanceof Error ? error.message : "Restore failed.";
    throw new Error(`${reason} ${complete ? "Previous data was restored." : "Rollback was incomplete."} Reload VEIL before trying again.`);
  }
}
