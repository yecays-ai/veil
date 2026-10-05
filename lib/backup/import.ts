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
import { BACKUP_MAX_BYTES, type Backup, type BackupChat, type BackupV1, type BackupV2 } from "./types";
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
  bindings?: RestoreDocument<import("../bindings").BindingDocument>;
  theme: RestoreDocument<Backup["theme"]>;
  preset: RestoreDocument<Backup["preset"]>;
  regex?: RestoreDocument<BackupV2["regex"]>;
  worldBooks?: RestoreDocument<BackupV2["worldBooks"]>;
  chat: {
    exportBackup(): Promise<BackupChat>;
    replaceBackup(expected: BackupChat, backup: BackupChat): Promise<void>;
  };
};
const browserSources: RestoreSources = {
  foundation: browserFoundationStorage,
  bindings: browserBindingStorage,
  theme: browserThemeStorage,
  preset: browserPresetStorage,
  regex: browserRegexStorage,
  worldBooks: browserWorldBookStorage,
  chat: chatStorage,
};
const snapshot = (sources: RestoreSources) => Promise.all([
  sources.foundation.readRaw(), sources.bindings?.readRaw(), sources.theme.readRaw(),
  sources.preset.readRaw(), sources.regex?.readRaw() ?? Promise.resolve(null),
  sources.worldBooks?.readRaw() ?? Promise.resolve(null),
  sources.chat.exportBackup(),
]);
function replacement<T>(
  store: RestoreDocument<T>,
  before: string | null,
  next: T,
  empty?: T | T[],
  normalize: (value: unknown) => unknown = (value) => value,
) {
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

/** @deprecated V1 callers should use parseBackup; only V1 input is accepted here. */
export function parseBackupV1(text: string): BackupV1 {
  const backup = parseBackup(text);
  if (backup.version !== 1) throw new Error("This backup requires VEIL Backup V2 support.");
  return backup;
}

export async function requiresOverwriteRestore(sources = browserSources) {
  const [foundation, bindings, theme, preset, regex, worldBooks, chat] = await snapshot(sources);
  let customPreset = false;
  try {
    customPreset = preset !== null && stableJson(validatePresetDocument(JSON.parse(preset))) !==
      stableJson(createPresetDocument());
  } catch { customPreset = true; }
  let customRegex = false, customWorldBooks = false;
  try {
    customRegex = regex !== null && stableJson(validateRegexDocument(JSON.parse(regex))) !==
      stableJson({ version: 1, groups: [defaultRegexGroup()] }) &&
      stableJson(validateRegexDocument(JSON.parse(regex))) !== stableJson(emptyRegexDocument());
  } catch { customRegex = true; }
  try {
    customWorldBooks = worldBooks !== null && stableJson(validateWorldBookDocument(JSON.parse(worldBooks))) !==
      stableJson(emptyWorldBookDocument());
  } catch { customWorldBooks = true; }
  return foundation !== null || theme !== null || customPreset || customRegex || customWorldBooks ||
    (bindings != null && stableJson(JSON.parse(bindings)) !== stableJson({ global: {}, characters: {} })) ||
    !!chat.sessions.length || !!chat.messages.length;
}

/** Both empty and confirmed overwrite restores use the same guarded writes and rollback. */
export async function restoreBackup(
  backup: Backup, sources = browserSources, overwrite = false,
): Promise<void> {
  const validated = validateBackup(backup);
  const safe = { ...validated, chat: restorableChat(validated.chat) };
  if (safe.bindings && !sources.bindings) throw new Error("Binding storage is required to restore these bindings.");
  if (safe.version === 2 && (!sources.regex || !sources.worldBooks))
    throw new Error("Regex and WorldBook storage are required to restore a V2 backup.");
  const [foundation, bindings, theme, preset, regex, worldBooks, chat] = await snapshot(sources);
  const documents = [
    ...(sources.bindings ? [replacement(sources.bindings, bindings ?? null, safe.bindings ?? { global: {}, characters: {} })] : []),
    replacement(sources.foundation, foundation, safe.foundation),
    replacement(sources.theme, theme, safe.theme),
    replacement(sources.preset, preset, safe.preset, createPresetDocument(), validatePresetDocument),
  ];
  if (safe.version === 2) {
    const regexStore = sources.regex!;
    const worldBookStore = sources.worldBooks!;
    documents.push(
      replacement(regexStore, regex, safe.regex,
        [{ version: 1, groups: [defaultRegexGroup()] }, emptyRegexDocument()], validateRegexDocument),
      replacement(worldBookStore, worldBooks, safe.worldBooks, emptyWorldBookDocument(), validateWorldBookDocument),
    );
  }
  if (!overwrite && (
    documents.some(({ matches }) => !matches()) ||
    ((chat.sessions.length || chat.messages.length) && !sameBackupChat(chat, safe.chat))
  )) throw new Error("Restore is only available for an empty installation. Existing data was not changed.");

  const undo: Array<() => Promise<boolean>> = [];
  try {
    for (const document of documents) undo.push(await document.apply());
    await sources.chat.replaceBackup(chat, safe.chat);
    undo.push(async () => {
      await sources.chat.replaceBackup(safe.chat, chat);
      return true;
    });
    // Per-store CAS alone cannot detect an earlier store changing during a later write.
    const [finalFoundation, finalBindings, finalTheme, finalPreset, finalRegex, finalWorldBooks, finalChat] = await snapshot(sources);
    if (finalFoundation === null || finalTheme === null || finalPreset === null ||
        stableJson(JSON.parse(finalFoundation)) !== stableJson(safe.foundation) ||
        stableJson(JSON.parse(finalTheme)) !== stableJson(safe.theme) ||
        stableJson(JSON.parse(finalPreset)) !== stableJson(safe.preset) ||
        (safe.version === 2 && (finalRegex === null || finalWorldBooks === null ||
          stableJson(validateRegexDocument(JSON.parse(finalRegex))) !== stableJson(safe.regex) ||
          stableJson(validateWorldBookDocument(JSON.parse(finalWorldBooks))) !== stableJson(safe.worldBooks))) ||
        !sameBackupChat(finalChat, safe.chat) ||
        (sources.bindings && (finalBindings == null || stableJson(JSON.parse(finalBindings)) !==
          stableJson(safe.bindings ?? { global: {}, characters: {} }))))
      throw new Error("Your data changed during restore.");
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

/** V1 restores deliberately leave Regex and WorldBooks untouched: those fields never existed in V1. */
export async function restoreBackupV1(
  backup: Backup, sources = browserSources, overwrite = false,
): Promise<void> {
  return restoreBackup(backup, sources, overwrite);
}
