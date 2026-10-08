"use client";
import Link from "next/link";
import { useRef } from "react";
import { ChevronRight, Plus, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { importPreset, newPreset } from "../../../lib/preset-library";
import { usePresetLibrary } from "./use-preset-library";

export function PresetList() {
  const { document, error, notice, busy, loading, loadError, retry, run, change, setNotice } = usePresetLibrary();
  const file = useRef<HTMLInputElement>(null);
  return <PageShell className="settings-app preset-manager" title="Presets" backHref="/settings" backLabel="Back to Settings">
    <div className="settings-action-row preset-actions">
      <button className="settings-button" disabled={!document || busy} onClick={() => file.current?.click()}><Upload size={17} />Import Preset</button>
      <button className="settings-button" disabled={!document || busy} onClick={() => void run(async () => {
        await change(newPreset);
      })}><Plus size={17} />New Preset</button>
    </div>
    <input ref={file} type="file" accept=".json,application/json" hidden onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (selected) void run(async () => {
        const json = await selected.text();
        await change((current) => importPreset(current, json));
        setNotice("Preset imported.");
      });
    }} />
    {error && <Alert variant="danger">{error}</Alert>}
    {loadError && <button className="settings-button" disabled={loading} onClick={() => void retry()}>{loading ? "Retrying…" : "Retry"}</button>}
    {notice && <Alert variant="success">{notice}</Alert>}
    {!document && !error && <p role="status">Loading Presets…</p>}
    <nav className="preset-list" aria-label="Preset Library">
      {document?.presets.map((preset) => <Link className="preset-list-item" key={preset.id} href={`/settings/presets/${encodeURIComponent(preset.id)}`}>
        <span className="preset-copy"><strong>{preset.name}</strong><span>{preset.description}</span>
          <span className="settings-config-meta"><span className="settings-badge">{preset.builtIn ? "Built-in" : "Custom"}</span>
            {preset.id === document.activePresetId && <span className="settings-badge">Active</span>}
            <span>{preset.prompts.length} Prompt Entries</span></span>
        </span><ChevronRight size={20} aria-hidden="true" />
      </Link>)}
    </nav>
  </PageShell>;
}
