"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RegexMode, RegexRole, RegexRule } from "../../../lib/regex";
import { regexPatternError } from "../../../lib/regex-engine";
import { Input } from "../ui/form";
import { Switch } from "../ui/switch";

export function RegexInlineRule({ rule, busy, initiallyOpen = false, onSave }: {
  rule: RegexRule;
  busy: boolean;
  initiallyOpen?: boolean;
  onSave: (rule: RegexRule) => Promise<void>;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [draft, setDraft] = useState(rule);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (next: RegexRule, syncDraft = true, closeAfterSave = false) => {
    setSaving(true);
    setError("");
    try {
      await onSave(next);
      if (syncDraft) setDraft(next);
      else setDraft((current) => ({ ...current, enabled: next.enabled }));
      if (closeAfterSave) setOpen(false);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Rule could not be saved."); }
    finally { setSaving(false); }
  };
  const roles: RegexRole[] = ["user", "assistant"];
  const modes: RegexMode[] = ["stored", "prompt", "display"];
  const invalid = regexPatternError(draft.find);
  return <article className="regex-inline-rule">
    <div className="regex-inline-summary">
      <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${rule.name}`}
        onClick={() => setOpen(!open)}>{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
      <button type="button" className="regex-inline-title" onClick={() => setOpen(!open)}>
        <strong>{rule.name}</strong><small>{rule.mode === "display" ? "Display" : rule.mode === "prompt" ? "Prompt Only" : "Stored"} · {rule.appliesTo.map((role) => role === "assistant" ? "Assistant" : "User").join(" + ")}</small>
      </button>
      <Switch aria-label={`Enable ${rule.name || "rule"}`} checked={rule.enabled} disabled={busy || saving}
        onChange={(enabled) => void save({ ...rule, enabled }, false)} />
    </div>
    {open && <div className="settings-editor regex-inline-editor">
      <label>Name<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Find<textarea className="settings-input" rows={3} value={draft.find}
        onChange={(event) => setDraft({ ...draft, find: event.target.value })} /></label>
      {invalid && <small role="alert">Invalid pattern: {invalid}</small>}
      <label>Replace<textarea className="settings-input" rows={3} value={draft.replace}
        onChange={(event) => setDraft({ ...draft, replace: event.target.value })} /></label>
      <fieldset><legend>Applies To</legend>{roles.map((role) => <label className="regex-check" key={role}>
        <input type="checkbox" checked={draft.appliesTo.includes(role)} onChange={() => {
          const next = draft.appliesTo.includes(role) ? draft.appliesTo.filter((item) => item !== role)
            : [...draft.appliesTo, role];
          if (next.length) setDraft({ ...draft, appliesTo: next });
        }} />{role}</label>)}</fieldset>
      <label>Mode<select className="settings-input" value={draft.mode}
        onChange={(event) => setDraft({ ...draft, mode: event.target.value as RegexMode })}>
        {modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
      </select></label>
      <button type="button" className="settings-button" disabled={busy || saving || !!invalid || !draft.appliesTo.length || !draft.name.trim()}
        onClick={() => void save(draft, true, true)}>Save Rule</button>
      {error && <small role="alert">{error}</small>}
    </div>}
  </article>;
}
