"use client";
import { useState } from "react";
import { useFoundation } from "../foundation-provider";
import { Switch } from "./ui/switch";

export function RuntimeSettings() {
  const { document, ready, commit } = useFoundation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <section>
    <h2 className="settings-section-label">Runtime</h2>
    <label className="settings-runtime-toggle">
      <span><strong>Real-Time Awareness</strong>
        <small>Give characters awareness of the current date, time, and local time differences.</small></span>
      <Switch checked={document.runtime.timeAware} disabled={!ready || saving}
        onChange={async (timeAware) => {
          setSaving(true); setError("");
          try { await commit((current) => ({ ...current, runtime: { ...current.runtime, timeAware } })); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Setting could not be saved."); }
          finally { setSaving(false); }
        }} />
    </label>
    {error && <p role="alert">{error}</p>}
  </section>;
}
