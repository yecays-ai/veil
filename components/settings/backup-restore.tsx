"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_ARCHIVE_BYTES } from "../../lib/backup/archive";
import { applyBackup, browserBackup, createBackupFile, describeBackupError, inspectBackupFile,
  type InspectedBackup } from "../../lib/backup/backup-flow";
import { RestoreError } from "../../lib/backup/restore";
import type { RestoreBlocker } from "../../lib/backup/restore-preview";
import { BackupValidationError } from "../../lib/backup/format";

const DOMAIN_LABELS: Record<string, string> = {
  foundation: "Profiles", appearance: "Appearance", bindings: "Bindings", presets: "Presets", regex: "Regex",
  worldbooks: "World books", contacts: "Contacts", presence: "Presence", chat: "Chat records", apiConfigs: "API settings",
};
const BLOCKER_TEXT: Record<RestoreBlocker["code"], string> = {
  "backup-invalid": "This backup file is damaged or not supported.",
  "backup-generation-marker": "This backup contains an unfinished reply marker and cannot be used.",
  "target-unreadable": "This device's data could not be read safely.",
  "local-generation-active": "A reply is being generated on this device. Wait for it to finish.",
  "local-generation-stale": "A conversation has an unfinished reply from an earlier crash. Open that conversation once, then try again.",
};

type View =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "inspected"; fileName: string; inspected: InspectedBackup }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

export function BackupRestoreSettings() {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [understood, setUnderstood] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const next = () => { abort.current?.abort(); abort.current = new AbortController(); return abort.current.signal; };
  const fail = (error: unknown) => setView({ kind: "error", text: describeBackupError(error) });

  async function exportBackup() {
    setView({ kind: "busy", label: "Preparing backup…" });
    try {
      const { bytes, fileName } = await createBackupFile(browserBackup(), { signal: next() });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url; link.download = fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setView({ kind: "done", text: `Backup saved as ${fileName}. API keys are not included.` });
    } catch (error) { fail(error); }
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setUnderstood(false);
    if (file.size > MAX_ARCHIVE_BYTES) { setView({ kind: "error", text: "This file is too large to be a VEIL backup." }); return; }
    setView({ kind: "busy", label: "Checking backup…" });
    try {
      const inspected = await inspectBackupFile(new Uint8Array(await file.arrayBuffer()), browserBackup(), { signal: next() });
      setView({ kind: "inspected", fileName: file.name, inspected });
    } catch (error) { fail(error); }
  }

  async function apply(inspected: InspectedBackup) {
    setView({ kind: "busy", label: "Restoring…" });
    try {
      await applyBackup(inspected, browserBackup(), { signal: next() });
      setView({ kind: "done", text: "Restore complete. Reload VEIL to use the restored data. Re-enter your API keys in API settings." });
    } catch (error) {
      // An unfinished restore leaves a journal; the app tree mounted before it, so only a reload puts RestoreGate in front of it.
      if (error instanceof RestoreError && error.journal === "kept") { window.location.reload(); return; }
      fail(error);
    }
  }

  const busy = view.kind === "busy";
  return (
    <section>
      <h2 className="settings-section-label">Backup &amp; Restore</h2>
      <div className="settings-backup-grid">
        <button className="settings-card settings-backup-action" disabled={busy} onClick={() => void exportBackup()} type="button">
          <span className="settings-card-copy"><strong>Export Backup</strong><span>Save all data to a file. API keys are not included.</span></span>
        </button>
        <button className="settings-card settings-backup-action" disabled={busy} onClick={() => input.current?.click()} type="button">
          <span className="settings-card-copy"><strong>Import Backup</strong><span>Choose a VEIL backup file.</span></span>
        </button>
      </div>
      <input accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void chooseFile(file); }}
        ref={input} type="file" />
      <div aria-live="polite" className="settings-backup-result">
        {view.kind === "busy" ? <p>{view.label}</p> : null}
        {view.kind === "error" ? <p role="alert">{view.text}</p> : null}
        {view.kind === "done" ? (
          <p>{view.text} {view.text.startsWith("Restore") ? <button onClick={() => window.location.reload()} type="button">Reload VEIL</button> : null}</p>
        ) : null}
        {view.kind === "inspected" ? <Inspection understood={understood} setUnderstood={setUnderstood} view={view} onApply={() => void apply(view.inspected)} onCancel={() => setView({ kind: "idle" })} /> : null}
      </div>
    </section>
  );
}

function Inspection({ view, understood, setUnderstood, onApply, onCancel }: { view: Extract<View, { kind: "inspected" }>;
  understood: boolean; setUnderstood: (value: boolean) => void; onApply: () => void; onCancel: () => void }) {
  const { preview } = view.inspected;
  const replace = preview.mode === "replace-required";
  return (
    <div className="settings-card settings-backup-preview">
      <strong>{view.fileName}</strong>
      {preview.blockers.map((blocker, index) => <p key={index} role="alert">{blocker.code === "target-unreadable"
        ? describeBackupError(new BackupValidationError(blocker.error, blocker.path)) : BLOCKER_TEXT[blocker.code]}</p>)}
      {Object.entries(preview.domains).length ? (
        <ul>
          {Object.entries(preview.domains).map(([domain, count]) => (
            <li key={domain}>{DOMAIN_LABELS[domain] ?? domain}: {count.backup} in backup, {count.current} on this device</li>
          ))}
          {preview.assets ? <li>Images: {preview.assets.appearance.backup + preview.assets.chat.backup} in backup, {preview.assets.appearance.current + preview.assets.chat.current} on this device</li> : null}
        </ul>
      ) : null}
      {preview.warnings.some((warning) => warning.code === "credentials-required") ? <p>API keys are not in the backup. Enter them again afterwards.</p> : null}
      {replace ? (
        <label>
          <input checked={understood} onChange={(event) => setUnderstood(event.target.checked)} type="checkbox" />
          {" "}This replaces everything currently on this device. A safety copy is kept until the restore finishes.
        </label>
      ) : null}
      {preview.mode === "empty-restore" || replace ? (
        <button disabled={replace && !understood} onClick={onApply} type="button">{replace ? "Replace everything" : "Restore"}</button>
      ) : null}
      <button onClick={onCancel} type="button">Cancel</button>
    </div>
  );
}
