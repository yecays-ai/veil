"use client";

import { useState } from "react";
import { exportBackupV1 } from "../../lib/backup/export";
import { PageShell } from "../page-shell";
import { Alert } from "./ui/feedback";

export function DataBackupSettings() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

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
          Text API configurations, API keys and other provider credentials are never included. Import and restore are not available yet.
        </p>
        <button className="settings-button" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing backup…" : "Download backup"}
        </button>
        {status && <Alert variant={status.startsWith("Backup downloaded") ? "success" : "danger"}>{status}</Alert>}
      </section>
    </PageShell>
  );
}
