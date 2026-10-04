"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Download, Plus, Trash2 } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Input } from "../ui/form";
import { Alert } from "../ui/feedback";
import { ConfirmDialog } from "../ui/modal";
import { presetFingerprint, type Preset } from "../../../lib/preset";
import { copyPreset, deletePreset, exportPreset, movePrompt, setActivePreset, updatePreset } from "../../../lib/preset-library";
import { usePresetLibrary } from "./use-preset-library";

export function PresetDetail({ presetId }: { presetId: string }) {
  const library = usePresetLibrary();
  const saved = library.document?.presets.find((preset) => preset.id === presetId);
  if (!saved) return <PageShell className="settings-app preset-manager" title="Preset" backHref="/settings/presets" backLabel="Back to Presets">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Preset not found." : "Loading Preset…"}</p>}
  </PageShell>;
  return <DetailEditor key={presetId} saved={saved} library={library} />;
}

function DetailEditor({ saved, library }: { saved: Preset; library: ReturnType<typeof usePresetLibrary> }) {
  const { document, error, notice, busy, run, change, setNotice } = library;
  const [draft, setDraft] = useState(() => structuredClone(saved));
  const [baseline, setBaseline] = useState(saved);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const dirty = presetFingerprint(draft) !== presetFingerprint(baseline);
  const readOnly = saved.builtIn;
  const baseHref = `/settings/presets/${encodeURIComponent(saved.id)}`;
  const entryHref = (identifier: string) => `${baseHref}/prompts/${encodeURIComponent(identifier)}`;
  const directive = draft.prompts.find((entry) => entry.identifier === "response-directive");
  function update(patch: Partial<Preset>) { setDraft({ ...draft, ...patch }); }
  function parameter(key: "temperature" | "maxTokens", value: string) {
    const generation = { ...draft.generation };
    if (value === "") delete generation[key]; else generation[key] = Number(value);
    update({ generation });
  }
  const overlay = deleting ? <ConfirmDialog title="Delete Preset?" confirmLabel="Delete" busy={busy}
    onCancel={() => { if (!busy) setDeleting(false); }} onConfirm={() => void run(async () => {
      await change((current) => deletePreset(current, saved.id)); router.push("/settings/presets");
    })}>Delete {saved.name}? If active, VEIL Default will be used.</ConfirmDialog> : undefined;
  return <div className="preset-route" onClickCapture={(event) => {
    if (dirty && (event.target as HTMLElement).closest("a") && !window.confirm("Discard unsaved changes?")) event.preventDefault();
  }}><PageShell className="settings-app preset-manager" title={draft.name} backHref="/settings/presets" backLabel="Back to Presets" overlay={overlay}
    rightAction={!readOnly && <button className="settings-header-action" disabled={!dirty || busy} onClick={() => void run(async () => {
      const next = await change((current) => updatePreset(current, draft, baseline));
      const stored = next.presets.find((preset) => preset.id === saved.id)!;
      setDraft(structuredClone(stored)); setBaseline(stored); setNotice("Saved.");
    })}>Save</button>}>
    <div className="settings-action-row preset-actions">
      <button className="settings-button" disabled={busy || dirty} onClick={() => void run(async () => {
        const next = await change((current) => copyPreset(current, saved.id));
        router.push(`/settings/presets/${encodeURIComponent(next.presets.at(-1)!.id)}`);
      })}><Copy size={17} />Copy</button>
      <button className="settings-button" disabled={busy || dirty} onClick={() => void run(async () => {
        const url = URL.createObjectURL(new Blob([exportPreset(saved)], { type: "application/json" }));
        const anchor = window.document.createElement("a"); anchor.href = url;
        anchor.download = `${saved.name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "preset"}.json`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}><Download size={17} />Export</button>
      {!readOnly && <button className="settings-button settings-danger" disabled={busy} onClick={() => setDeleting(true)}><Trash2 size={17} />Delete</button>}
    </div>
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    <div className="preset-status"><span className="settings-badge">{readOnly ? "Built-in · Read-only" : "Custom"}</span>
      {document?.activePresetId === saved.id ? <span className="settings-badge">Active</span> :
        <button className="settings-button" disabled={busy || dirty} onClick={() => void run(async () => {
          await change((current) => setActivePreset(current, saved.id)); setNotice("Active Preset updated.");
        })}>Set Active</button>}</div>
    <section className="preset-section"><h2>Preset Info</h2><fieldset disabled={readOnly || busy} className="settings-editor">
      <label>Name<Input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Description<textarea className="settings-input" rows={3} value={draft.description} onChange={(event) => update({ description: event.target.value })} /></label>
    </fieldset></section>
    <section className="preset-section"><h2>Generation Parameters</h2><fieldset disabled={readOnly || busy} className="settings-editor">
      {(["temperature", "maxTokens"] as const).map((key) => <div className="preset-parameter" key={key}>
        <label>{key === "temperature" ? "Temperature" : "Max Tokens"}<Input type="number" min={key === "temperature" ? 0 : 1}
          max={key === "temperature" ? 2 : 1000000} step={key === "temperature" ? "any" : 1} placeholder="Default"
          value={draft.generation[key] ?? ""} onChange={(event) => parameter(key, event.target.value)} /></label>
        <button className="settings-button" type="button" onClick={() => parameter(key, "")}>Default</button>
      </div>)}
    </fieldset></section>
    {directive && <section className="preset-section"><h2>Response Directive</h2>
      <Link className="preset-entry-link" href={entryHref(directive.identifier)}>{readOnly ? "View" : "Edit"} Response Directive</Link>
    </section>}
    <section className="preset-section"><div className="preset-section-heading"><h2>Prompt Entries</h2>
      {!readOnly && <Link className="preset-entry-link" href={`${baseHref}/new-prompt`}><Plus size={17} />Add Prompt</Link>}</div>
      <div className="preset-rows">{draft.prompts.map((entry) => <div className="preset-row" key={entry.identifier}>
        <Link className="preset-copy" href={entryHref(entry.identifier)}><strong>{entry.name}</strong><small>{entry.source === "marker" ? `Marker · ${entry.marker}` : entry.role}</small></Link>
        <input type="checkbox" aria-label={`Enable Prompt ${entry.name}`} checked={entry.enabled} disabled={readOnly || busy}
          onChange={(event) => update({ prompts: draft.prompts.map((item) => item.identifier === entry.identifier ? { ...item, enabled: event.target.checked } : item) })} />
      </div>)}</div>
    </section>
    <section className="preset-section"><h2>Prompt Order</h2><ol className="preset-rows">
      {draft.promptOrder.map((entry, index) => <li className="preset-row" key={entry.identifier}>
        <span className="preset-copy"><strong>{draft.prompts.find((item) => item.identifier === entry.identifier)?.name}</strong></span>
        <input type="checkbox" aria-label={`Enable Order ${entry.identifier}`} checked={entry.enabled} disabled={readOnly || busy}
          onChange={(event) => update({ promptOrder: draft.promptOrder.map((item) => item.identifier === entry.identifier ? { ...item, enabled: event.target.checked } : item) })} />
        <button className="preset-order-button" disabled={readOnly || busy || index === 0} aria-label={`Move ${entry.identifier} up`} onClick={() => setDraft(movePrompt(draft, entry.identifier, -1))}><ArrowUp size={18} /></button>
        <button className="preset-order-button" disabled={readOnly || busy || index === draft.promptOrder.length - 1} aria-label={`Move ${entry.identifier} down`} onClick={() => setDraft(movePrompt(draft, entry.identifier, 1))}><ArrowDown size={18} /></button>
      </li>)}
    </ol></section>
  </PageShell></div>;
}
