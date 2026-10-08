"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { Input } from "../ui/form";
import { exportRegexRule, type RegexMode, type RegexRole, type RegexRule } from "../../../lib/regex";
import { regexPatternError, testRegexRule } from "../../../lib/regex-engine";
import { downloadRegex } from "./files";
import { useRegex } from "./use-regex";
import { DEFAULT_REGEX_GROUP_ID } from "../../../lib/regex-defaults";
import { Switch } from "../ui/switch";

const modes: { value: RegexMode; label: string; description: string }[] = [
  { value: "stored", label: "Stored", description: "Changes the saved message." },
  { value: "prompt", label: "Prompt Only", description: "Only changes what the AI receives." },
  { value: "display", label: "Display Only", description: "Only changes what you see." },
];
export function RegexRuleEditor({ groupId, ruleId }: { groupId: string; ruleId: string }) {
  const library = useRegex(`${groupId}/${ruleId}`);
  const group = library.document?.groups.find((item) => item.id === groupId);
  const saved = group?.rules.find((item) => item.id === ruleId);
  const back = `/settings/regex/${groupId}`;
  if (!saved) return <PageShell className="settings-app regex-manager" title="Regex Rule" backHref={back} backLabel="Back to Regex Group">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Regex Rule not found." : "Loading Regex Rule…"}</p>}
  </PageShell>;
  return <Editor key={`${groupId}/${ruleId}`} saved={saved} groupId={groupId} library={library} />;
}
function Editor({ saved, groupId, library }: { saved: RegexRule; groupId: string; library: ReturnType<typeof useRegex> }) {
  const { error, busy, run, change } = library;
  const [draft, setDraft] = useState(saved);
  const [testInput, setTestInput] = useState("");
  const router = useRouter();
  const back = `/settings/regex/${groupId}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patternError = regexPatternError(draft.find);
  const test = testRegexRule(draft, testInput);
  const toggleRole = (role: RegexRole) => {
    const appliesTo = draft.appliesTo.includes(role)
      ? draft.appliesTo.filter((item) => item !== role) : [...draft.appliesTo, role];
    if (appliesTo.length) setDraft({ ...draft, appliesTo });
  };
  return <PageShell className="settings-app regex-manager" title={saved.name || "Regex Rule"} backHref={back} backLabel="Back to Regex Group"
    rightAction={<button className="settings-header-action" disabled={!dirty || busy || !draft.appliesTo.length} onClick={() => void run(async () => {
      await change((current) => ({ ...current, groups: current.groups.map((group) => group.id !== groupId ? group : {
        ...group, updatedAt: Date.now(), rules: group.rules.map((rule) => rule.id === saved.id ? draft : rule),
      }) }));
      router.push(back);
    })}>Save</button>}>
    {error && <Alert variant="danger">{error}</Alert>}
    <section className="regex-section"><h2>Rule</h2><div className="settings-editor">
      <label>Name<Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Find<textarea className="settings-input" rows={3} value={draft.find}
        onChange={(event) => setDraft({ ...draft, find: event.target.value })} /></label>
      {patternError && <p className="regex-invalid" role="alert">Invalid pattern: {patternError}</p>}
      <label>Replace<textarea className="settings-input" rows={3} value={draft.replace}
        onChange={(event) => setDraft({ ...draft, replace: event.target.value })} /></label>
      <fieldset><legend>Applies To</legend>{(["user", "assistant"] as const).map((role) =>
        <label className="regex-check" key={role}><input type="checkbox" checked={draft.appliesTo.includes(role)}
          onChange={() => toggleRole(role)} />{role === "user" ? "User" : "Assistant"}</label>)}</fieldset>
      <fieldset><legend>Mode</legend>{modes.map((mode) => <label className="regex-mode" key={mode.value}>
        <input type="radio" name="regex-mode" checked={draft.mode === mode.value}
          onChange={() => setDraft({ ...draft, mode: mode.value })} />
        <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
      </label>)}</fieldset>
      <label className="regex-check"><span>Enabled</span><Switch checked={draft.enabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })} /></label>
    </div></section>
    <section className="regex-section"><h2>Test Rule</h2><div className="settings-editor">
      <label>Test Input<textarea className="settings-input" rows={4} value={testInput}
        onChange={(event) => setTestInput(event.target.value)} /></label>
      {testInput.trim() && <div className="regex-test-flow"><strong>Before</strong><pre>{testInput}</pre>
        <span>↓</span><strong>After · {test.step.status}</strong><pre>{test.output}</pre>
        {test.step.error && <small role="alert">Pattern error: {test.step.error}</small>}
      </div>}
    </div></section>
    <div className="settings-action-row regex-actions">
      <button className="settings-button" onClick={() => downloadRegex(exportRegexRule(saved), saved.name)}><Download size={17} />Export Rule</button>
      {groupId !== DEFAULT_REGEX_GROUP_ID && <button className="settings-button settings-danger" disabled={busy} onClick={() => {
        if (!window.confirm(`Delete ${saved.name || "this Rule"}?`)) return;
        void run(async () => {
          await change((current) => ({ ...current, groups: current.groups.map((group) => group.id !== groupId ? group : {
            ...group, rules: group.rules.filter((rule) => rule.id !== saved.id), updatedAt: Date.now(),
          }) }));
          router.push(back);
        });
      }}><Trash2 size={17} />Delete Rule</button>}
    </div>
  </PageShell>;
}
