"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { Input } from "../ui/form";
import { canSaveRegexGroup, newRegexDraft, newRegexRule, type RegexMode, type RegexRole, type RegexRule } from "../../../lib/regex";
import { regexPatternError, testRegexGroups, testRegexRule } from "../../../lib/regex-engine";
import { useRegex } from "./use-regex";
import { Switch } from "../ui/switch";

export function RegexNew() {
  const { document, error, busy, loading, loadError, retry, run, change } = useRegex("new");
  const [draft, setDraft] = useState(newRegexDraft);
  const [editing, setEditing] = useState<RegexRule | null>(null);
  const [ruleTest, setRuleTest] = useState("");
  const [groupTest, setGroupTest] = useState("");
  const [role, setRole] = useState<RegexRole>("assistant");
  const [mode, setMode] = useState<RegexMode>("display");
  const router = useRouter();
  const result = testRegexGroups(groupTest, [draft], role, mode);
  function moveRule(from: number, to: number) {
    const rules = [...draft.rules];
    rules.splice(to, 0, ...rules.splice(from, 1));
    setDraft({ ...draft, rules });
  }
  function saveRule() {
    if (!editing) return;
    setDraft((current) => ({ ...current, rules: current.rules.some((item) => item.id === editing.id)
      ? current.rules.map((item) => item.id === editing.id ? editing : item)
      : [...current.rules, editing] }));
    setEditing(null);
    setRuleTest("");
  }
  if (editing) {
    const patternError = regexPatternError(editing.find);
    const test = testRegexRule(editing, ruleTest);
    return <PageShell className="settings-app regex-manager" title="New Rule" backHref="/settings/regex/new" backLabel="Back to new Regex Group"
      onBack={() => { setEditing(null); setRuleTest(""); }}
      rightAction={<button className="settings-header-action" onClick={saveRule}>Save Rule</button>}>
      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {loadError && <button className="settings-button" disabled={loading} onClick={() => void retry()}>{loading ? "Retrying…" : "Retry"}</button>}
      <section className="regex-section"><h2>Rule</h2><div className="settings-editor">
        <label>Name<Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        <label>Find<textarea className="settings-input" rows={3} value={editing.find} onChange={(event) => setEditing({ ...editing, find: event.target.value })} /></label>
        {patternError && <p className="regex-invalid" role="alert">Invalid pattern: {patternError}</p>}
        <label>Replace<textarea className="settings-input" rows={3} value={editing.replace} onChange={(event) => setEditing({ ...editing, replace: event.target.value })} /></label>
        <fieldset><legend>Applies To</legend>{(["user", "assistant"] as const).map((scope) => <label className="regex-check" key={scope}>
          <input type="checkbox" checked={editing.appliesTo.includes(scope)} onChange={() => {
            const appliesTo = editing.appliesTo.includes(scope) ? editing.appliesTo.filter((item) => item !== scope) : [...editing.appliesTo, scope];
            if (appliesTo.length) setEditing({ ...editing, appliesTo });
          }} />{scope === "user" ? "User" : "Assistant"}</label>)}</fieldset>
        <fieldset><legend>Mode</legend>{(["stored", "prompt", "display"] as const).map((stage) => <label className="regex-mode" key={stage}>
          <input type="radio" name="draft-regex-mode" checked={editing.mode === stage} onChange={() => setEditing({ ...editing, mode: stage })} />
          <span><strong>{stage === "stored" ? "Stored" : stage === "prompt" ? "Prompt Only" : "Display Only"}</strong>
            <small>{stage === "stored" ? "Changes the saved message." : stage === "prompt" ? "Only changes what the AI receives." : "Only changes what you see."}</small></span>
        </label>)}</fieldset>
        <label className="regex-check"><span>Enabled</span><Switch checked={editing.enabled}
          onChange={(enabled) => setEditing({ ...editing, enabled })} /></label>
      </div></section>
      <section className="regex-section"><h2>Test Rule</h2><div className="settings-editor">
        <label>Test Input<textarea className="settings-input" rows={4} value={ruleTest} onChange={(event) => setRuleTest(event.target.value)} /></label>
        {ruleTest.trim() && <div className="regex-test-flow"><strong>Before</strong><pre>{ruleTest}</pre><span>↓</span>
          <strong>After · {test.step.status}</strong><pre>{test.output}</pre>
          {test.step.error && <small role="alert">Pattern error: {test.step.error}</small>}</div>}
      </div></section>
    </PageShell>;
  }
  return <PageShell className="settings-app regex-manager" title="New Regex" backHref="/settings/regex" backLabel="Cancel new Regex Group"
    rightAction={<button className="settings-header-action" disabled={!document || busy || !canSaveRegexGroup(draft)} onClick={() => void run(async () => {
      await change((current) => ({ ...current, groups: [...current.groups, { ...draft, name: draft.name.trim(), updatedAt: Date.now() }] }));
      router.replace("/settings/regex");
    })}>Save</button>}>
    {error && <Alert variant="danger">{error}</Alert>}
    {loadError && <button className="settings-button" disabled={loading} onClick={() => void retry()}>{loading ? "Retrying…" : "Retry"}</button>}
    <section className="regex-section"><h2>Regex Group</h2><div className="settings-editor">
      <label>Name *<Input required maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Description<textarea className="settings-input" rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="regex-check"><span>Enabled</span><Switch checked={draft.enabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })} /></label>
    </div></section>
    <section className="regex-section"><div className="regex-section-heading"><h2>Rules</h2>
      <button className="settings-button" onClick={() => setEditing(newRegexRule())}><Plus size={17} />Add Rule</button></div>
      {draft.rules.length === 0 && <p>No Rules yet.</p>}
      <div className="regex-list">{draft.rules.map((item, index) => <article className="regex-card" key={item.id}>
        <button className="regex-card-main regex-card-button" onClick={() => setEditing(item)}><span><strong>{item.name || "Untitled Rule"}</strong>
          <small>{item.find || "Empty Find"}</small></span></button>
        <div className="regex-row-actions"><span className="regex-row-spacer" />
          <button aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => moveRule(index, index - 1)}><ArrowUp size={17} /></button>
          <button aria-label={`Move ${item.name} down`} disabled={index === draft.rules.length - 1} onClick={() => moveRule(index, index + 1)}><ArrowDown size={17} /></button>
          <button aria-label={`Delete ${item.name}`} onClick={() => {
            if (window.confirm(`Delete ${item.name || "this Rule"}?`))
              setDraft({ ...draft, rules: draft.rules.filter((rule) => rule.id !== item.id) });
          }}><Trash2 size={17} /></button></div>
      </article>)}</div>
    </section>
    <section className="regex-section"><h2>Test Group</h2><div className="settings-editor">
      <label>Test Input<textarea className="settings-input" rows={4} value={groupTest} onChange={(event) => setGroupTest(event.target.value)} /></label>
      <strong>Test as</strong><p className="regex-test-hint">Only matching rules in this group will run.</p>
      <label>Message<select className="settings-input" value={role} onChange={(event) => setRole(event.target.value as RegexRole)}>
        <option value="user">User</option><option value="assistant">Assistant</option></select></label>
      <label>Stage<select className="settings-input" value={mode} onChange={(event) => setMode(event.target.value as RegexMode)}>
        <option value="stored">Stored</option><option value="prompt">Prompt Only</option><option value="display">Display Only</option></select></label>
      <div className="regex-test-flow"><strong>Original</strong><pre>{groupTest}</pre>
        {result.steps.map((step, index) => <div key={`${step.ruleId}-${index}`}><span>↓</span><strong>{step.ruleName} · {step.status}</strong>
          <small>Before</small><pre>{step.before}</pre><small>After</small><pre>{step.after}</pre></div>)}
        <span>↓</span><strong>Final</strong><pre>{result.output}</pre></div>
    </div></section>
  </PageShell>;
}
