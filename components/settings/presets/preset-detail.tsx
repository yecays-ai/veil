"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, Copy, Download, Plus, Trash2 } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Input, Select } from "../ui/form";
import { Alert } from "../ui/feedback";
import { ConfirmDialog } from "../ui/modal";
import { presetFingerprint, type Preset, type PresetPrompt } from "../../../lib/preset";
import { buildDisplayedPrompts, copyPreset, deletePrompt, exportPreset, movePrompt,
  promptEnabled, setActivePreset, updatePreset } from "../../../lib/preset-library";
import { usePresetLibrary } from "./use-preset-library";
import { Switch } from "../ui/switch";

export function PresetDetail({ presetId }: { presetId: string }) {
  const library = usePresetLibrary();
  const saved = library.document?.presets.find((preset) => preset.id === presetId);
  if (!saved) return <PageShell className="settings-app preset-manager" title="Preset" backHref="/settings/presets" backLabel="Back to Presets">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Preset not found." : "Loading Preset…"}</p>}
    {library.loadError && <button className="settings-button" disabled={library.loading} onClick={() => void library.retry()}>{library.loading ? "Retrying…" : "Retry"}</button>}
  </PageShell>;
  return <DetailEditor key={presetId} saved={saved} library={library} />;
}

function DetailEditor({ saved, library }: { saved: Preset; library: ReturnType<typeof usePresetLibrary> }) {
  const { document, error, notice, busy, run, change, remove, setNotice } = library;
  const [draft, setDraft] = useState(() => structuredClone(saved));
  const [baseline] = useState(saved);
  const [deleting, setDeleting] = useState(false);
  const [deletingPrompt, setDeletingPrompt] = useState<string>();
  const [editingPromptId, setEditingPromptId] = useState<string>();
  const router = useRouter();
  const dirty = presetFingerprint(draft) !== presetFingerprint(baseline);
  const readOnly = saved.builtIn;
  const baseHref = `/settings/presets/${encodeURIComponent(saved.id)}`;
  const displayedPrompts = buildDisplayedPrompts(draft);
  function update(patch: Partial<Preset>) { setDraft({ ...draft, ...patch }); }
  function parameter(key: "temperature" | "maxTokens", value: string) {
    const generation = { ...draft.generation };
    if (value === "") delete generation[key]; else generation[key] = Number(value);
    update({ generation });
  }
  function updatePrompt(identifier: string, next: PresetPrompt) {
    setDraft((current) => ({ ...current,
      prompts: current.prompts.map((entry) => entry.identifier === identifier ? next : entry),
      promptOrder: current.promptOrder.map((entry) => entry.identifier === identifier
        ? { ...entry, identifier: next.identifier } : entry),
    }));
    if (identifier !== next.identifier) setEditingPromptId(next.identifier);
  }
  function togglePrompt(identifier: string, enabled: boolean) {
    setDraft((current) => ({ ...current,
      prompts: current.prompts.map((entry) => entry.identifier === identifier ? { ...entry, enabled } : entry),
      promptOrder: current.promptOrder.map((entry) => entry.identifier === identifier ? { ...entry, enabled } : entry),
    }));
  }
  const overlay = deletingPrompt ? <ConfirmDialog title="Delete Prompt?" confirmLabel="Delete" busy={busy}
    onCancel={() => setDeletingPrompt(undefined)} onConfirm={() => {
      setDraft((current) => deletePrompt(current, deletingPrompt));
      setEditingPromptId(undefined); setDeletingPrompt(undefined);
    }}>Delete {draft.prompts.find((entry) => entry.identifier === deletingPrompt)?.name} from this Preset?</ConfirmDialog>
    : deleting ? <ConfirmDialog title="Delete Preset?" confirmLabel="Delete" busy={busy}
    onCancel={() => { if (!busy) setDeleting(false); }} onConfirm={() => void run(async () => {
      await remove(saved.id); router.push("/settings/presets");
    })}>Delete {saved.name}? If active, VEIL Default will be used.</ConfirmDialog> : undefined;
  return <div className="preset-route" onClickCapture={(event) => {
    if (dirty && (event.target as HTMLElement).closest("a") && !window.confirm("Discard unsaved changes?")) event.preventDefault();
  }}><PageShell className="settings-app preset-manager" title={draft.name} backHref="/settings/presets" backLabel="Back to Presets" overlay={overlay}
    rightAction={!readOnly && <button className="settings-header-action" disabled={!dirty || busy} onClick={() => void run(async () => {
      await change((current) => updatePreset(current, draft, baseline));
      router.push("/settings/presets");
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
    <details className="preset-section preset-generation"><summary>Generation Parameters<ChevronDown size={18} aria-hidden="true" /></summary>
      <fieldset disabled={readOnly || busy} className="settings-editor">
      {(["temperature", "maxTokens"] as const).map((key) => <div className="preset-parameter" key={key}>
        <label>{key === "temperature" ? "Temperature" : "Max Tokens"}<Input type="number" min={key === "temperature" ? 0 : 1}
          max={key === "temperature" ? 2 : 1000000} step={key === "temperature" ? "any" : 1} placeholder="Default"
          value={draft.generation[key] ?? ""} onChange={(event) => parameter(key, event.target.value)} /></label>
        <button className="settings-button" type="button" onClick={() => parameter(key, "")}>Default</button>
      </div>)}
    </fieldset></details>
    <section className="preset-section"><div className="preset-section-heading"><h2>Prompt Entries</h2>
      {!readOnly && <Link className="preset-entry-link" href={`${baseHref}/new-prompt`}><Plus size={17} />Add Prompt</Link>}</div>
      <div className="preset-pipeline">{displayedPrompts.map((entry, index) => {
        const expanded = editingPromptId === entry.identifier;
        const enabled = promptEnabled(draft, entry.identifier);
        return <article className="preset-prompt" data-expanded={expanded || undefined} data-enabled={enabled || undefined} key={entry.identifier}>
          <div className="preset-prompt-summary">
            <button className="preset-prompt-expand" type="button" aria-expanded={expanded}
              aria-controls={`prompt-${entry.identifier}`} onClick={() => setEditingPromptId(expanded ? undefined : entry.identifier)}>
              <ChevronDown size={17} aria-hidden="true" /><span className="preset-copy"><strong>{entry.name}</strong>
                <small>{entry.source === "marker" ? `Marker · ${entry.marker}` : entry.role}</small></span>
            </button>
            <Switch aria-label={`Enable Prompt ${entry.name}`} checked={enabled} disabled={readOnly || busy}
              onChange={(nextEnabled) => togglePrompt(entry.identifier, nextEnabled)} />
          </div>
          {expanded && <div className="preset-prompt-editor" id={`prompt-${entry.identifier}`}>
            {entry.source === "prompt" ? <fieldset disabled={readOnly || busy} className="settings-editor">
              <label>Name<Input value={entry.name} onChange={(event) => updatePrompt(entry.identifier, { ...entry, name: event.target.value })} /></label>
              <label>Identifier<Input value={entry.identifier} onChange={(event) => updatePrompt(entry.identifier, { ...entry, identifier: event.target.value })} /></label>
              <label>Role<Select value={entry.role} onChange={(event) => updatePrompt(entry.identifier, { ...entry, role: event.target.value as PresetPrompt["role"] })}>
                <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option>
              </Select></label>
              <label>Content<textarea className="settings-input preset-prompt-content" rows={10} value={entry.content}
                onChange={(event) => updatePrompt(entry.identifier, { ...entry, content: event.target.value })} /></label>
            </fieldset> : <div className="preset-marker-note"><strong>Runtime marker · {entry.marker}</strong>
              <p>Content is supplied dynamically by VEIL.</p></div>}
            <div className="preset-prompt-controls"><span>Move</span>
              <button className="preset-order-button" disabled={readOnly || busy || index === 0} aria-label={`Move ${entry.identifier} up`} onClick={() => setDraft(movePrompt(draft, entry.identifier, -1))}><ArrowUp size={18} /></button>
              <button className="preset-order-button" disabled={readOnly || busy || index === displayedPrompts.length - 1} aria-label={`Move ${entry.identifier} down`} onClick={() => setDraft(movePrompt(draft, entry.identifier, 1))}><ArrowDown size={18} /></button>
              {!readOnly && entry.source === "prompt" && <button className="preset-delete-prompt" type="button" onClick={() => setDeletingPrompt(entry.identifier)}>Delete</button>}
            </div>
          </div>}
        </article>;
      })}</div>
    </section>
  </PageShell></div>;
}
