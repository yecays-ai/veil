import { browserBindingStorage } from "../binding-storage";
import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { browserThemeStorage } from "../theme-storage";
import { browserPresetStorage } from "../preset-storage";
import { createPresetDocument, validatePresetDocument } from "../preset";
import { BACKUP_MAX_BYTES, type BackupChat, type BackupV1 } from "./types";
import { validateBackupV1 } from "./validate";
import { sameBackupChat, stableJson } from "./equality";
import { restorableChat } from "./restorable-chat";

type RestoreDocument<T> = {
  readRaw(): Promise<string | null>;
  replaceIfCurrent(expected: string | null, document: T): Promise<string>;
  rollbackIfCurrent(expected: string, previous: string | null): Promise<boolean>;
};
export type RestoreSources = {
  bindings?: RestoreDocument<import("../bindings").BindingDocument>;
  foundation: RestoreDocument<BackupV1["foundation"]>;
  theme: RestoreDocument<BackupV1["theme"]>;
  preset: RestoreDocument<BackupV1["preset"]>;
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
  chat: chatStorage,
};
const snapshot = (sources: RestoreSources) => Promise.all([
  sources.foundation.readRaw(), sources.theme.readRaw(), sources.preset.readRaw(),
  sources.chat.exportBackup(), sources.bindings?.readRaw(),
]);
function replacement<T>(
  store: RestoreDocument<T>,
  before: string | null,
  next: T,
  empty?: T,
  normalize: (value: unknown) => unknown = (value) => value,
) {
  return {
    matches: () => before === null || stableJson(normalize(JSON.parse(before))) === stableJson(next) ||
      (empty !== undefined && stableJson(normalize(JSON.parse(before))) === stableJson(empty)),
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
  const [foundation, theme, preset, chat, bindings] = await snapshot(sources);
  let customPreset = false;
  try {
    customPreset = preset !== null && stableJson(validatePresetDocument(JSON.parse(preset))) !==
      stableJson(createPresetDocument());
  } catch { customPreset = true; }
  return foundation !== null || theme !== null || customPreset ||
    (bindings != null && stableJson(JSON.parse(bindings)) !== stableJson({ global: {}, characters: {} })) ||
    !!chat.sessions.length || !!chat.messages.length;
}

/** Both empty and confirmed overwrite restores use the same guarded writes and rollback. */
export async function restoreBackupV1(
  backup: BackupV1, sources = browserSources, overwrite = false,
): Promise<void> {
  const validated = validateBackupV1(backup);
  const safe = { ...validated, chat: restorableChat(validated.chat) };
  if (safe.bindings && !sources.bindings) throw new Error("Binding storage is required to restore these bindings.");
  const [foundation, theme, preset, chat, bindings] = await snapshot(sources);
  const documents = [
    ...(sources.bindings ? [replacement(sources.bindings, bindings ?? null, safe.bindings ?? { global: {}, characters: {} })] : []),
    replacement(sources.foundation, foundation, safe.foundation),
    replacement(sources.theme, theme, safe.theme),
    replacement(sources.preset, preset, safe.preset, createPresetDocument(), validatePresetDocument),
  ];
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
    const [finalFoundation, finalTheme, finalPreset, finalChat, finalBindings] = await snapshot(sources);
    if (finalFoundation === null || finalTheme === null || finalPreset === null ||
        stableJson(JSON.parse(finalFoundation)) !== stableJson(safe.foundation) ||
        stableJson(JSON.parse(finalTheme)) !== stableJson(safe.theme) ||
        stableJson(JSON.parse(finalPreset)) !== stableJson(safe.preset) ||
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
