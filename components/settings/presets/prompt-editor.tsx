"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "../../page-shell";
import { Input, Select } from "../ui/form";
import { Alert } from "../ui/feedback";
import { savePrompt, updatePreset } from "../../../lib/preset-library";
import { type Preset, type PresetPrompt } from "../../../lib/preset";
import { usePresetLibrary } from "./use-preset-library";
import { Switch } from "../ui/switch";

export function NewPromptEditor({ presetId }: { presetId: string }) {
  const library = usePresetLibrary();
  const preset = library.document?.presets.find((item) => item.id === presetId);
  const backHref = `/settings/presets/${encodeURIComponent(presetId)}`;
  if (!preset) return <PageShell className="settings-app preset-manager" title="New Prompt" backHref={backHref} backLabel="Back to Preset">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Preset not found." : "Loading Preset…"}</p>}
    {library.loadError && <button className="settings-button" disabled={library.loading} onClick={() => void library.retry()}>{library.loading ? "Retrying…" : "Retry"}</button>}
  </PageShell>;
  return <CreatePromptEditor key={presetId} preset={preset} library={library} backHref={backHref} />;
}

function CreatePromptEditor({ preset, library, backHref }: {
  preset: Preset; library: ReturnType<typeof usePresetLibrary>; backHref: string;
}) {
  const [baseline] = useState(preset);
  const [blank] = useState<PresetPrompt>(() => ({
    identifier: "", name: "", source: "prompt", role: "system", enabled: true, content: "",
  }));
  const [draft, setDraft] = useState<PresetPrompt>(blank);
  const dirty = JSON.stringify(draft) !== JSON.stringify(blank);
  const { busy, error, run, change } = library;
  const router = useRouter();
  const operationOwner = useRef<object | null>(null);
  useLayoutEffect(() => {
    const owner = {};
    operationOwner.current = owner;
    return () => { if (operationOwner.current === owner) operationOwner.current = null; };
  }, []);
  const readOnly = preset.builtIn;
  function update(patch: Partial<PresetPrompt>) { setDraft({ ...draft, ...patch } as PresetPrompt); }
  return <div className="preset-route" onClickCapture={(event) => {
    if (!readOnly && dirty && (event.target as HTMLElement).closest("a") && !window.confirm("Discard unsaved changes?")) event.preventDefault();
  }}><PageShell className="settings-app preset-manager" title="New Prompt" backHref={backHref} backLabel="Back to Preset"
    rightAction={!readOnly && <button className="settings-header-action" disabled={busy} onClick={() => void run(async () => {
      const owner = operationOwner.current;
      const next = savePrompt(baseline, undefined, draft);
      await change((current) => updatePreset(current, next, baseline));
      if (owner && operationOwner.current === owner) router.push(backHref);
    })}>Save</button>}>
    {readOnly && <p className="settings-hint">Built-in · Read-only</p>}
    {error && <Alert variant="danger">{error}</Alert>}
    <fieldset className="settings-editor" disabled={readOnly || busy}>
      <label>Name<Input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>Identifier<Input value={draft.identifier} disabled={draft.source === "marker"} onChange={(event) => update({ identifier: event.target.value })} /></label>
      <label>Role<Select value={draft.role} onChange={(event) => update({ role: event.target.value as PresetPrompt["role"] })}>
        <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option>
      </Select></label>
      <label className="preset-toggle"><span>Enabled</span><Switch checked={draft.enabled} onChange={(enabled) => update({ enabled })} /></label>
      {draft.source === "prompt" ? <label>Content<textarea className="settings-input preset-prompt-content" rows={14} value={draft.content} onChange={(event) => update({ content: event.target.value })} /></label> :
        draft.source === "marker" ? <p className="settings-hint">Marker · {draft.marker}</p> : null}
    </fieldset>
  </PageShell></div>;
}
