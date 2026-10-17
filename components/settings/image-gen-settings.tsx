"use client";
import { useEffect, useRef, useState } from "react";
import { PageShell } from "../page-shell";
import { Alert } from "./ui/feedback";
import { Input } from "./ui/form";
import { browserImageGenConfigStorage, EMPTY_IMAGEGEN_CONFIG, imageGenConfigProblem, type ImageGenConfig } from "../../lib/imagegen/config";

export function ImageGenSettings() {
  const [saved, setSaved] = useState<ImageGenConfig | null>(null);
  const [draft, setDraft] = useState<ImageGenConfig>(EMPTY_IMAGEGEN_CONFIG);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void browserImageGenConfigStorage.load().then((config) => {
      if (!mounted.current) return;
      setSaved(config); setDraft(config);
    }).catch(() => { if (mounted.current) setError("Could not load Image settings. Saved settings have not been changed."); });
    return () => { mounted.current = false; };
  }, []);

  const unchanged = !!saved && JSON.stringify(saved) === JSON.stringify(draft);
  const update = (patch: Partial<ImageGenConfig>) => { setDraft((current) => ({ ...current, ...patch })); setNotice(""); setError(""); };
  async function run(action: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try { await work(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "The operation failed."); }
    finally { if (mounted.current) setBusy(""); }
  }
  const save = () => run("Saving…", async () => {
    const problem = imageGenConfigProblem(draft);
    if (problem) throw new Error(problem);
    const next = await browserImageGenConfigStorage.save(draft);
    if (mounted.current) { setSaved(next); setDraft(next); setNotice("Saved on this device. The key is not included in backups."); }
  });
  const clear = () => run("Clearing…", async () => {
    await browserImageGenConfigStorage.clear();
    if (mounted.current) { setSaved(EMPTY_IMAGEGEN_CONFIG); setDraft(EMPTY_IMAGEGEN_CONFIG); setNotice("Image settings cleared."); }
  });

  return (
    <PageShell className="settings-app" title="Images" backHref="/settings" backLabel="Back to Settings">
      {!saved && !error && <Alert>Loading Image settings…</Alert>}
      <form className="settings-editor" autoComplete="off" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Base URL
          <Input type="url" required placeholder="https://api.example.com/v1" value={draft.baseUrl} disabled={!saved || !!busy}
            onChange={(e) => update({ baseUrl: e.target.value })} />
        </label>
        <label>API Key
          <Input type="password" required autoComplete="new-password" value={draft.apiKey} disabled={!saved || !!busy}
            onChange={(e) => update({ apiKey: e.target.value })} />
        </label>
        <label>Model
          <Input required placeholder="gpt-image-1" value={draft.model} disabled={!saved || !!busy}
            onChange={(e) => update({ model: e.target.value })} />
        </label>
        <label>Size (optional)
          <Input placeholder="1024x1024" value={draft.size ?? ""} disabled={!saved || !!busy}
            onChange={(e) => update({ size: e.target.value })} />
        </label>
        <div className="settings-action-row">
          <button className="settings-button" type="submit" disabled={!saved || !!busy || unchanged}>{busy === "Saving…" ? busy : "Save"}</button>
          <button className="settings-button settings-danger" type="button" disabled={!saved || !!busy} onClick={() => void clear()}>Clear</button>
        </div>
        <p className="settings-hint">{unchanged ? "Saved" : "Unsaved changes"}. With Images set up, a Character may send a picture it takes (each one is one paid request to this service). Pictures that show the Character use its look from the Character page and, when it is stored on this device, its avatar as the reference. The key stays on this device and is not included in backups.</p>
      </form>
      {notice && <Alert>{notice}</Alert>}
      {error && <Alert variant="danger">{error}</Alert>}
    </PageShell>
  );
}
