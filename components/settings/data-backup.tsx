"use client";

import { useState } from "react";
import { exportBackupV1 } from "../../lib/backup/export";
import {
  parseBackupV1,
  overwriteRestoreBackupV1,
  isOverwriteConfirmationValid,
  requiresOverwriteRestore,
  restoreBackupV1,
  summarizeBackupV1,
  type BackupSummary,
} from "../../lib/backup/import";
import { BACKUP_MAX_BYTES, type BackupV1 } from "../../lib/backup/types";
import { PageShell } from "../page-shell";
import { Alert } from "./ui/feedback";

export function DataBackupSettings() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<{
    backup: BackupV1;
    summary: BackupSummary;
    overwrite: boolean;
  } | null>(null);
  const [confirmation, setConfirmation] = useState("");

  async function download() {
    setBusy(true);
    setStatus("");
    try {
      const { json } = await exportBackupV1();
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `veil-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Backup downloaded. Keep it somewhere private and safe.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create a backup.");
    } finally {
      setBusy(false);
    }
  }

  async function selectBackup(file: File | undefined) {
    setStatus("");
    setCandidate(null);
    setConfirmation("");
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) {
      setStatus("Backup is larger than the 32 MiB import limit.");
      return;
    }
    try {
      const backup = parseBackupV1(await file.text());
      setCandidate({
        backup,
        summary: summarizeBackupV1(backup),
        overwrite: await requiresOverwriteRestore(),
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Backup file could not be read.");
    }
  }

  async function restore() {
    if (!candidate) return;
    if (candidate.overwrite && !isOverwriteConfirmationValid(confirmation)) {
      setStatus("Type RESTORE exactly before replacing existing data.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      if (candidate.overwrite) await overwriteRestoreBackupV1(candidate.backup);
      else await restoreBackupV1(candidate.backup);
      setStatus("Restore completed. Reload VEIL to use the restored data.");
      setCandidate(null);
      setConfirmation("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Restore could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      className="settings-app"
      title="Data & Backup"
      backHref="/settings"
      backLabel="Back to Settings"
    >
      <section className="settings-editor" aria-labelledby="backup-heading">
        <h2 id="backup-heading">Export backup</h2>
        <p className="settings-intro">
          Download your profile, characters, appearance, chat sessions and messages as a V1 JSON backup.
        </p>
        <p className="settings-hint">
          Text API configurations, API keys and other provider credentials are never included.
        </p>
        <button className="settings-button" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing backup…" : "Download backup"}
        </button>
        <label>
          Restore from backup
          <input
            className="settings-input"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void selectBackup(event.target.files?.[0])}
          />
        </label>
        {candidate && (
          <div className="settings-alert" data-variant="info">
            <strong>Ready to restore</strong>
            <p>
              Exported {new Date(candidate.summary.exportedAt).toLocaleString()}: {candidate.summary.characters} characters, {candidate.summary.sessions} chat sessions, and {candidate.summary.messages} messages.
            </p>
            <p>{candidate.summary.note}</p>
            {candidate.overwrite ? (
              <>
                <p>
                  Overwrite mode will replace this device&apos;s profile, appearance and chats. Text API configurations and API keys are retained.
                </p>
                <p>Close any other VEIL tabs before continuing so they cannot change local data during the restore.</p>
                <label>
                  Type RESTORE to enable overwrite
                  <input
                    className="settings-input"
                    value={confirmation}
                    disabled={busy}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <p>Restore will add this backup to an empty VEIL installation.</p>
            )}
            <button
              className="settings-button"
              disabled={busy || (candidate.overwrite && !isOverwriteConfirmationValid(confirmation))}
              onClick={() => void restore()}
            >
              {busy
                ? "Restoring…"
                : candidate.overwrite
                  ? "Replace local VEIL data"
                  : "Restore backup"}
            </button>
          </div>
        )}
        {status && (
          <Alert
            variant={
              status.startsWith("Backup downloaded") || status.startsWith("Restore completed")
                ? "success"
                : "danger"
            }
          >
            {status}
          </Alert>
        )}
      </section>
    </PageShell>
  );
}
