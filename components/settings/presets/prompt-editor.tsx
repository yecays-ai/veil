"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "../../page-shell";
import { Input, Select } from "../ui/form";
import { Alert } from "../ui/feedback";
import { ConfirmDialog } from "../ui/modal";
import { deletePrompt, savePrompt, updatePreset } from "../../../lib/preset-library";
import { presetFingerprint, type Preset, type PresetPrompt } from "../../../lib/preset";
import { usePresetLibrary } from "./use-preset-library";

export function PromptEditor({ presetId, identifier }: { presetId: string; identifier?: string }) {
  const library = usePresetLibrary();
  const preset = library.document?.presets.find((item) => item.id === presetId);
  const entry = preset?.prompts.find((item) => item.identifier === identifier);
  const backHref = `/settings/presets/${encodeURIComponent(presetId)}`;
  if (!preset || (identifier && !entry)) return <PageShell className="settings-app preset-manager" title="Prompt" backHref={backHref} backLabel="Back to Preset">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Prompt not found." : "Loading Prompt…"}</p>}
  </PageShell>;
  return <EntryEditor key={`${presetId}:${identifier ?? "new"}`} preset={preset} entry={entry} library={library} backHref={backHref} />;
}

function EntryEditor({ preset, entry, library, backHref }: {
  preset: Preset; entry?: PresetPrompt; library: ReturnType<typeof usePresetLibrary>; backHref: string;
}) {
  const [baseline] = useState(preset);
  const [draft, setDraft] = useState<PresetPrompt>(() => entry ? structuredClone(entry) : {
    identifier: "", name: "", source: "prompt", role: "system", enabled: true, content: "",
  });
  const [deleting, setDeleting] = useState(false);
  const { busy, error, run, change } = library;
  const router = useRouter();
  const readOnly = preset.builtIn;
  const dirty = !entry || presetFingerprint(entry) !== presetFingerprint(draft);
  function update(patch: Partial<PresetPrompt>) { setDraft({ ...draft, ...patch } as PresetPrompt); }
  const overlay = deleting ? <ConfirmDialog title="Delete Prompt?" confirmLabel="Delete" busy={busy}
    onCancel={() => { if (!busy) setDeleting(false); }} onConfirm={() => void run(async () => {
      await change((current) => updatePreset(current, deletePrompt(baseline, entry!.identifier), baseline));
      router.push(backHref);
    })}>Delete {entry?.name} from the pipeline?</ConfirmDialog> : undefined;
  return <div className="preset-route" onClickCapture={(event) => {
    if (!readOnly && dirty && (event.target as HTMLElement).closest("a") && !window.confirm("Discard unsaved changes?")) event.preventDefault();
  }}><PageShell className="settings-app preset-manager" title={entry ? "Prompt Entry" : "New Prompt"} backHref={backHref} backLabel="Back to Preset" overlay={overlay}
    rightAction={!readOnly && <button className="settings-header-action" disabled={busy || !dirty} onClick={() => void run(async () => {
      const next = savePrompt(baseline, entry?.identifier, draft);
      await change((current) => updatePreset(current, next, baseline));
      router.push(backHref);
    })}>Save</button>}>
    {readOnly && <p className="settings-hint">Built-in · Read-only</p>}
    {error && <Alert variant="danger">{error}</Alert>}
    <fieldset className="settings-editor" disabled={readOnly || busy}>
      <label>Name<Input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Identifier<Input value={draft.identifier} disabled={draft.source === "marker"} onChange={(event) => update({ identifier: event.target.value })} /></label>
      <label>Role<Select value={draft.role} onChange={(event) => update({ role: event.target.value as PresetPrompt["role"] })}>
        <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option>
      </Select></label>
      <label className="preset-toggle"><span>Enabled</span><input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} /></label>
      {draft.source === "prompt" ? <label>Content<textarea className="settings-input preset-prompt-content" rows={14} value={draft.content} onChange={(event) => update({ content: event.target.value })} /></label> :
        <p className="settings-hint">Marker · {draft.marker}</p>}
    </fieldset>
    {!readOnly && entry?.source === "prompt" && <button className="settings-button settings-danger preset-delete" disabled={busy} onClick={() => setDeleting(true)}>Delete Prompt</button>}
  </PageShell></div>;
}
