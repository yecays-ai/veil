"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageShell } from "../page-shell";
import { chatStorage } from "../../lib/chat/storage";
import { defaultChatFormatting, type ChatFormattingSettings } from "../../lib/chat/formatting";

const toggles: { key: keyof Omit<ChatFormattingSettings, "id">; label: string }[] = [
  { key: "hideActions", label: "Hide Actions" },
  { key: "hideSpeakerName", label: "Hide Speaker Name" },
  { key: "hideQuotesAroundReplies", label: "Hide Quotes Around Replies" },
  { key: "cleanFormattingArtifacts", label: "Clean Formatting Artifacts" },
];
export function ChatFormattingSettingsPage() {
  const [settings, setSettings] = useState(defaultChatFormatting);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void chatStorage.readChatFormatting().then((value) => {
      if (active) { setSettings(value); setReady(true); }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Chat Formatting could not be loaded.");
    });
    return () => { active = false; };
  }, []);
  return <PageShell className="settings-app" title="Chat Formatting" backHref="/settings" backLabel="Back to Settings">
    <section>
      {toggles.map(({ key, label }) => <label className="settings-runtime-toggle" key={key}>
        <span><strong>{label}</strong></span>
        <input type="checkbox" checked={settings[key]} disabled={!ready || saving}
          onChange={(event) => {
            const checked = event.target.checked;
            setSaving(true); setError("");
            void chatStorage.updateChatFormatting({ [key]: checked }).then(setSettings)
              .catch((reason) => setError(reason instanceof Error ? reason.message : "Setting could not be saved."))
              .finally(() => setSaving(false));
          }} />
      </label>)}
      {error && <p role="alert">{error}</p>}
    </section>
    <section><h2 className="settings-section-label">Advanced</h2>
      <Link className="settings-button" href="/settings/regex">Advanced Regex</Link>
    </section>
  </PageShell>;
}
