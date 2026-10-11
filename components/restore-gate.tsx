"use client";

import { useRef, useState, type ReactNode } from "react";
import { MAX_ARCHIVE_BYTES, decodeBackupArchive } from "../lib/backup/archive";
import { browserBackup, describeBackupError, hasRestoreJournal, recoverBackup } from "../lib/backup/backup-flow";
import { PhoneShell } from "./phone-shell";

/**
 * While an interrupted restore left its journal, nothing else may mount: providers and bootstrap write default
 * data on load and would change what the recovery checks. The initial state is read on the client only.
 */
export function RestoreGate({ children }: { children: ReactNode }) {
  const [blocked] = useState(() => typeof window !== "undefined" && hasRestoreJournal());
  return blocked ? <main className="app-root"><PhoneShell><RestoreRecovery /></PhoneShell></main> : <>{children}</>;
}

function RestoreRecovery() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function run(action: "resume" | "rollback", file?: File) {
    setBusy(true); setMessage(null);
    try {
      if (file && file.size > MAX_ARCHIVE_BYTES) throw new Error("too-large");
      const pack = file ? decodeBackupArchive(new Uint8Array(await file.arrayBuffer())) : null;
      await recoverBackup(action, browserBackup(), pack);
      window.location.reload();
    } catch (error) { setMessage(describeBackupError(error)); setBusy(false); }
  }
  return (
    <section className="settings-app" style={{ padding: 20 }}>
      <h1>Restore interrupted</h1>
      <p>A restore did not finish. VEIL is paused so your data is not changed further. Choose one:</p>
      <p><button disabled={busy} onClick={() => void run("rollback")} type="button">Roll back to how it was</button></p>
      <p><button disabled={busy} onClick={() => input.current?.click()} type="button">Finish the restore (choose the same backup file)</button></p>
      <input accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run("resume", file); }}
        ref={input} type="file" />
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}
