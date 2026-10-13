"use client";
import { useCallback, useEffect, useState } from "react";
import { browserApiConfigStorage } from "../../lib/api-config-storage";
import { browserBindingStorage } from "../../lib/binding-storage";
import { chatStorage } from "../../lib/chat/storage";
import { readUsageBaseline, type UsageBaselineRecord } from "../../lib/chat/usage-baseline";
import { browserMemoryStorage } from "../../lib/memory/browser";
import {
  MAINTENANCE_CONFIG_EVENT, MAINTENANCE_CONSENT_KEY, maintenanceConsentStored, maintenanceReleaseApproved,
  maintenanceReleaseChecks, setMaintenanceConsent,
} from "../../lib/memory/maintenance-config";
import {
  maintenanceModelStatus, summarizeMaintenanceProgress, summarizeRollingSummary, type MaintenanceModelStatus, type MaintenanceProgressSummary,
  type RollingSummaryStatus,
} from "../../lib/memory/maintenance-status";
import { useFoundation } from "../foundation-provider";
import { Switch } from "./ui/switch";

type Release = { approved: boolean; missing: string[]; locks: boolean; consent: boolean };
type CharacterRow = { id: string; name: string; model: MaintenanceModelStatus; progress: MaintenanceProgressSummary | null; summary: RollingSummaryStatus };

/** Build-time conditions are read after mount: the static page is prerendered in a different environment. */
function readRelease(): Release {
  const checks = maintenanceReleaseChecks();
  const missing = [
    !checks.productionBuild && "Production build",
    !checks.approvalFlag && "Release approval (NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED)",
    !checks.vercelProduction && "Vercel Production deployment",
    !checks.notCi && "Non-CI build",
  ].filter((item): item is string => !!item);
  return { approved: maintenanceReleaseApproved(), missing, locks: typeof navigator !== "undefined" && !!navigator.locks,
    consent: maintenanceConsentStored() };
}

const time = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function headline(release: Release): string {
  if (!release.approved) return "Unavailable in this build";
  if (!release.locks) return "Unavailable in this browser";
  return release.consent ? "On for this device" : "Off for this device";
}

function summaryLine(summary: RollingSummaryStatus): string {
  const base = summary.chats ? `Chat summary: ${summary.chats} ${summary.chats === 1 ? "chat" : "chats"} · updated ${time(summary.updatedAt!)}` : "Chat summary: none yet";
  return summary.due ? `${base} · a new summary is due` : base;
}

function progressLine(progress: MaintenanceProgressSummary): string {
  const parts = [`Tracked ${progress.tracked}`, `Processed ${progress.processed}`];
  if (progress.running) parts.push(`Running ${progress.running}`);
  if (progress.waiting) parts.push(`Waiting ${progress.waiting}`);
  if (progress.failed) parts.push(`Failed ${progress.failed}`);
  if (progress.uncertain) parts.push(`Uncertain ${progress.uncertain}`);
  if (progress.tooLarge) parts.push(`Too large ${progress.tooLarge}`);
  return parts.join(" · ");
}

export function MemoryMaintenanceSettings() {
  const { document, ready } = useFoundation();
  const [release, setRelease] = useState<Release | null>(null);
  const [rows, setRows] = useState<CharacterRow[] | null>(null);
  const [requests, setRequests] = useState<UsageBaselineRecord[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const sync = () => setRelease(readRelease());
    const storage = (event: StorageEvent) => { if (event.key === MAINTENANCE_CONSENT_KEY) sync(); };
    sync();
    window.addEventListener(MAINTENANCE_CONFIG_EVENT, sync); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(MAINTENANCE_CONFIG_EVENT, sync); window.removeEventListener("storage", storage); };
  }, []);

  useEffect(() => {
    if (!ready || !release) return;
    let current = true;
    void (async () => {
      const bindings = await browserBindingStorage.load();
      if (!current) return;
      const sessions = await chatStorage.listSessions();
      if (!current) return;
      const next = await Promise.all(document.characters.map(async (character): Promise<CharacterRow> => ({
        id: character.characterId, name: character.name,
        model: await maintenanceModelStatus(bindings, character.characterId, (id) => browserApiConfigStorage.getApiConfig(id)),
        summary: summarizeRollingSummary(character.characterId, sessions),
        // Memory progress is only read once the release is approved, like the root gate.
        progress: release.approved
          ? summarizeMaintenanceProgress(character.characterId, sessions, await browserMemoryStorage.listCursors(character.characterId))
          : null,
      })));
      if (!current) return;
      setRows(next); setError("");
      setRequests(readUsageBaseline().filter((row) => row.source === "memory-maintenance").slice(-5).reverse());
    })().catch(() => { if (current) setError("Status could not be read. Try Refresh."); });
    return () => { current = false; };
  }, [ready, release, document.characters, revision]);

  const toggle = (enabled: boolean) => {
    setError("");
    try { setMaintenanceConsent(enabled); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Setting could not be saved."); }
  };

  return <section className="settings-memory-maintenance">
    <h2 className="settings-section-label">Automatic Memory</h2>
    <label className="settings-runtime-toggle">
      <span><strong>Memory Maintenance</strong>
        <small>{release ? headline(release) : "Checking…"}. When on, a Character&apos;s new messages are organized into
          Memory once enough of them have piled up (no timer) while VEIL is open. Each batch is one paid request
          to the Memory model.</small></span>
      <Switch checked={!!release?.consent && release.approved} disabled={!release?.approved || !release.locks}
        aria-label="Memory Maintenance on this device" onChange={toggle} />
    </label>
    {release && !release.approved && <div className="settings-card settings-memory-status" role="status">
      <strong>Not approved for this build</strong>
      <span>Missing: {release.missing.join(", ")}.</span>
    </div>}
    {release?.approved && !release.locks && <div className="settings-card settings-memory-status" role="status">
      <strong>This browser does not support Web Locks, so maintenance cannot run safely.</strong>
    </div>}
    <div className="settings-card settings-memory-status">
      <strong>Characters</strong>
      {!rows ? <span>Loading…</span> : !rows.length ? <span>No Characters yet.</span> : <ul>
        {rows.map((row) => <li key={row.id}>
          <b>{row.name}</b>
          <span>{row.model.state === "ready" ? `Model: ${row.model.label}` : `Model unavailable: ${row.model.reason}`}</span>
          {row.progress && <span>{progressLine(row.progress)}</span>}
          {row.progress && <span>{summaryLine(row.summary)}</span>}
          {row.progress && <span>{!release?.consent || !release.approved || !release.locks ? "Waiting for Memory Maintenance to be available on this device." : row.progress.due ? "A check is due and starts on its own." : `A check starts once ${row.progress.trigger} new messages are waiting (${row.progress.pending} now).`}</span>}
        </li>)}
      </ul>}
    </div>
    <div className="settings-card settings-memory-status">
      <strong>Recent maintenance requests</strong>
      {!requests.length ? <span>None on this device yet.</span> : <ul>
        {requests.map((row) => <li key={`${row.at}-${row.durationMs}`}>
          <span>{time(row.at)} · {row.outcome} · {row.totalTokens === null ? "tokens unknown" : `${row.totalTokens} tokens`} · {(row.durationMs / 1000).toFixed(1)} s</span>
        </li>)}
      </ul>}
    </div>
    <button className="settings-card settings-backup-action settings-memory-refresh" type="button" onClick={refresh}>
      <span className="settings-card-copy"><strong>Refresh</strong></span>
    </button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
