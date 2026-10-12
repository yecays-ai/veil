import { decodeBackupArchive, encodeBackupArchive } from "./archive";
import type { BackupLockManager, BackupLockOptions } from "./coordination";
import { BackupValidationError } from "./format";
import { recoverRestore, replaceWithBackup, restoreIntoEmpty, RestoreError, RESTORE_JOURNAL_KEY, type RestoreDevice } from "./restore";
import { previewRestore, type RestorePreview } from "./restore-preview";
import { exportStaticBackupSnapshot } from "./snapshot-export";

export type BackupBrowser = { device: RestoreDevice; locks: BackupLockManager | undefined };
export type BackupPack = { manifestJson: string; files: ReadonlyMap<string, Uint8Array> };
export type InspectedBackup = { pack: BackupPack; preview: RestorePreview };

const UNKNOWN_COMMIT = "0".repeat(40);

export function browserBackup(): BackupBrowser {
  return { device: { indexedDB: window.indexedDB, localStorage: window.localStorage }, locks: window.navigator?.locks };
}

/** True while an interrupted restore or replace has left its journal; normal app use must not continue. */
export function hasRestoreJournal(storage: Pick<Storage, "getItem"> = window.localStorage): boolean {
  try { return storage.getItem(RESTORE_JOURNAL_KEY) !== null; } catch { return false; }
}

export function backupFileName(createdAt: number): string {
  return `veil-backup-${new Date(createdAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
}

/** Consistent export of all data (no API keys) as one ZIP. Refused while a reply is generating. */
export async function createBackupFile(env: BackupBrowser, options: BackupLockOptions & { now?: () => number; newId?: () => string;
  commit?: string } = {}): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { now = Date.now, newId = () => globalThis.crypto.randomUUID(), commit = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, ...lockOptions } = options;
  const createdAt = now();
  const pack = await exportStaticBackupSnapshot(env.device, { backupId: newId(), createdAt,
    sourceCommit: /^[a-f0-9]{40}$/.test(commit ?? "") ? commit! : UNKNOWN_COMMIT }, env.locks, lockOptions);
  return { bytes: encodeBackupArchive(pack), fileName: backupFileName(createdAt) };
}

/** Decode, validate and compare; only the authorized obsolete test database may be deleted. */
export async function inspectBackupFile(bytes: Uint8Array, env: BackupBrowser, options: BackupLockOptions = {}): Promise<InspectedBackup> {
  const pack = decodeBackupArchive(bytes);
  return { pack, preview: await previewRestore(pack.manifestJson, pack.files, env.device, env.locks, options) };
}

/** Applies the previewed mode: empty device → restore; device with data → explicit replace. Anything else is refused. */
export function applyBackup(inspected: InspectedBackup, env: BackupBrowser, options: BackupLockOptions = {}) {
  const { pack, preview } = inspected;
  if (preview.mode === "empty-restore") return restoreIntoEmpty(pack.manifestJson, pack.files, env.device, env.locks, { ...options, confirmed: preview });
  if (preview.mode === "replace-required") return replaceWithBackup(pack.manifestJson, pack.files, env.device, env.locks, { ...options, confirmed: preview });
  return Promise.reject(new RestoreError("not-empty-restore", "none", undefined, preview));
}

export function recoverBackup(action: "resume" | "rollback", env: BackupBrowser, pack: BackupPack | null, options: BackupLockOptions = {}) {
  return recoverRestore(action, env.device, env.locks, pack, options);
}

/** One plain sentence per failure; no keys, paths or user content. */
export function describeBackupError(error: unknown): string {
  if (error instanceof RestoreError) {
    const kept = error.journal === "kept" ? " The restore is unfinished: reopen this page to resume or roll back." : "";
    const text: Partial<Record<RestoreError["code"], string>> = {
      "restore-failed-rolled-back": "Restoring failed and your data was put back as it was.",
      "verify-failed-rolled-back": "The restored data did not verify and your data was put back as it was.",
      "preview-changed": "Your data changed after the check. Choose the file again.",
      "not-empty-restore": "This backup cannot be restored right now. See the check above.",
      "replace-not-confirmed": "Confirm the replacement first.",
      "safety-copy-failed": "Not enough space to keep a safety copy, so nothing was changed.",
      "safety-copy-missing": "The safety copy is missing, so the restore cannot be rolled back. Choose the same backup file to finish it.",
      "package-mismatch": "This is not the backup file that was being restored.",
      "target-changed": "Data changed during recovery, so VEIL stopped without overwriting it.",
      "rollback-failed": "Rolling back did not finish.",
      "restore-in-progress": "An earlier restore is unfinished.",
      "journal-write-failed": "Could not start the restore, so nothing was changed.",
    };
    return (text[error.code] ?? `Restore failed (${error.code}).`) + kept;
  }
  if (error instanceof BackupValidationError) {
    if (error.code.startsWith("archive-")) return "This file is not a valid VEIL backup.";
    switch (error.code) {
      case "legacy-cleanup-failed": return "Could not remove an old test database. Close other VEIL tabs and try again.";
      case "unsupported-source-database": return "This device has an unregistered database. Backup and restore are blocked.";
      case "source-catalog-unavailable":
      case "source-unavailable":
      case "source-read-failed":
      case "unsupported-source-schema":
      case "unsupported-source-document":
      case "invalid-source-document":
      case "invalid-source-data":
      case "invalid-source-json": return "This device's data could not be checked safely. Backup and restore are blocked.";
      case "coordination-timeout": return "Another VEIL tab is busy. Close other VEIL tabs and try again.";
      case "coordination-unavailable": return "This browser cannot coordinate VEIL tabs, so backups are unavailable here.";
      case "coordination-cancelled": return "Cancelled.";
      case "generation-active": return "A reply is being generated. Wait for it to finish and try again.";
      case "invalid-data": {
        // Only this one rule is an unfinished reply; every other failure names its own path and rule (never a value).
        const unfinished = "A conversation has an unfinished reply from an earlier crash. Open that conversation once, then try again.";
        if (error.path.startsWith("chat.sessions") && error.detail === "unexpected-field:generation") return unfinished;
        // generation is listed first, so it is never cut by the field-name cap; other blockers are still shown.
        if (error.path.startsWith("chat.sessions") && error.detail?.startsWith("unexpected-field:generation,"))
          return `${unfinished} Also blocking (${error.path}: ${error.detail}).`;
        const where = error.path.match(/^chat\.sessions\[(\d+)\]$/);
        const rule = error.detail ? `: ${error.detail}` : "";
        return where
          ? `Stored conversation ${Number(where[1]) + 1} cannot be backed up (${error.path}${rule}). Nothing was changed.`
          : `Some stored data cannot be backed up (${error.path}${rule}). Nothing was changed.`;
      }
      default: return "This file is not a valid VEIL backup.";
    }
  }
  return "Something went wrong. Nothing was reported as completed.";
}
