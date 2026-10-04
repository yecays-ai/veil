"use client";
import { useState } from "react";
import { exportBackupV1 } from "../../lib/backup/export";
import { parseBackupV1, restoreBackupV1, requiresOverwriteRestore, isOverwriteConfirmationValid } from "../../lib/backup/import";
import { BACKUP_MAX_BYTES, type BackupV1 } from "../../lib/backup/types";
import { PageShell } from "../page-shell";
import { Alert } from "./ui/feedback";

export function DataBackupSettings() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [candidate, setCandidate] = useState<{ backup: BackupV1; overwrite: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    setFailed(false);
    try { await action(); }
    catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "Backup operation failed.");
    } finally { setBusy(false); }
  }
  async function download() {
    const { json } = await exportBackupV1();
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `veil-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Backup downloaded. Keep it somewhere private and safe.");
  }
  async function selectBackup(file?: File) {
    setCandidate(null);
    setConfirmation("");
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) throw new Error("Backup is larger than the 32 MiB import limit.");
    const backup = parseBackupV1(await file.text());
    setCandidate({ backup, overwrite: await requiresOverwriteRestore() });
  }
  const confirmed = !candidate?.overwrite || isOverwriteConfirmationValid(confirmation);
  async function restore() {
    if (!candidate || !confirmed) return;
    await restoreBackupV1(candidate.backup, undefined, candidate.overwrite);
    setCandidate(null);
    setConfirmation("");
    setStatus("Restore completed. Reload VEIL to use the restored data.");
  }
  return (
    <PageShell className="settings-app" title="Data & Backup" backHref="/settings" backLabel="Back to Settings">
      <section className="settings-editor" aria-labelledby="backup-heading">
        <h2 id="backup-heading">Export backup</h2>
        <p>Download your profile, characters, appearance and chats as a JSON backup.</p>
        <p>Text API configurations and API keys are excluded from backups and retained during restore.</p>
        <button className="settings-button" disabled={busy} onClick={() => void run(download)}>Download backup</button>
        <label>
          Restore from backup
          <input className="settings-input" type="file" accept="application/json,.json" disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void run(() => selectBackup(file));
            }} />
        </label>
        {candidate && (
          <div className="settings-alert" data-variant="info">
            <strong>Ready to restore</strong>
            <p>Exported {new Date(candidate.backup.exportedAt).toLocaleString()}: {candidate.backup.foundation.characters.length} characters,
              {candidate.backup.chat.sessions.length} sessions, {candidate.backup.chat.messages.length} messages.</p>
            <p>Close other VEIL tabs before restoring.</p>
            {candidate.overwrite ? (
              <label>
                This replaces local profiles, appearance and chats. Type RESTORE to confirm.
                <input className="settings-input" value={confirmation} disabled={busy}
                  onChange={(event) => setConfirmation(event.target.value)} />
              </label>
            ) : <p>Restore this backup into the empty installation.</p>}
            <button className="settings-button" disabled={busy || !confirmed} onClick={() => void run(restore)}>
              {candidate.overwrite ? "Replace local VEIL data" : "Restore backup"}
            </button>
          </div>
        )}
        {busy && <p role="status">Working…</p>}
        {status && <Alert variant={failed ? "danger" : "success"}>{status}</Alert>}
      </section>
    </PageShell>
  );
}
