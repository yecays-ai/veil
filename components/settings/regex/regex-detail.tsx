"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { Input } from "../ui/form";
import { canSaveRegexGroup, exportRegexGroup, importRegexRule, newRegexRule, type RegexGroup, type RegexMode, type RegexRole } from "../../../lib/regex";
import { testRegexGroups } from "../../../lib/regex-engine";
import { downloadRegex } from "./files";
import { useRegex } from "./use-regex";
import { DEFAULT_REGEX_GROUP_ID } from "../../../lib/regex-defaults";
import { Switch } from "../ui/switch";

export function RegexDetail({ groupId }: { groupId: string }) {
  const library = useRegex();
  const saved = library.document?.groups.find((group) => group.id === groupId);
  if (!saved) return <PageShell className="settings-app regex-manager" title="Regex Group" backHref="/settings/regex" backLabel="Back to Regex Groups">
    {library.error ? <Alert variant="danger">{library.error}</Alert> : <p>{library.document ? "Regex Group not found." : "Loading Regex Group…"}</p>}
  </PageShell>;
  return <Detail key={groupId} saved={saved} library={library} />;
}

function Detail({ saved, library }: { saved: RegexGroup; library: ReturnType<typeof useRegex> }) {
  const { error, notice, busy, run, change, removeGroup, setNotice } = library;
  const [draft, setDraft] = useState(saved);
  const [testInput, setTestInput] = useState("");
  const [role, setRole] = useState<RegexRole>("assistant");
  const [mode, setMode] = useState<RegexMode>("display");
  const [dragged, setDragged] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const dirty = draft.name !== saved.name || draft.description !== saved.description || draft.enabled !== saved.enabled;
  const base = `/settings/regex/${saved.id}`;
  const test = testRegexGroups(testInput, [saved], role, mode);
  function reorder(from: number, to: number) {
    if (from === to || to < 0 || to >= saved.rules.length) return;
    void run(async () => { await change((current) => ({ ...current, groups: current.groups.map((group) => {
      if (group.id !== saved.id) return group;
      const rules = [...group.rules];
      rules.splice(to, 0, ...rules.splice(from, 1));
      return { ...group, rules, updatedAt: Date.now() };
    }) })); });
  }
  return <PageShell className="settings-app regex-manager" title={saved.name} backHref="/settings/regex" backLabel="Back to Regex Groups"
    rightAction={<button className="settings-header-action" disabled={!dirty || busy || !canSaveRegexGroup(draft)} onClick={() => void run(async () => {
      await change((current) => ({ ...current, groups: current.groups.map((group) => group.id === saved.id
        ? { ...group, name: draft.name.trim(), description: draft.description, enabled: draft.enabled, updatedAt: Date.now() } : group) }));
      router.push("/settings/regex");
    })}>Save</button>}>
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    <section className="regex-section"><h2>Regex Group</h2><div className="settings-editor">
      <label>Name *<Input required maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Description<textarea className="settings-input" rows={3} value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label className="regex-check"><span>Enabled</span><Switch checked={draft.enabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })} /></label>
    </div></section>
    <input hidden ref={file} type="file" accept=".json,application/json" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (selected) void run(async () => {
        const json = await selected.text();
        const warnings: string[] = [];
        await change((current) => {
          const result = importRegexRule(current, saved.id, json); warnings.push(...result.warnings);
          return result.document;
        });
        setNotice(warnings.length ? `Imported. ${warnings.join(" ")}` : "Rule imported.");
      });
    }} />
    <section className="regex-section"><div className="regex-section-heading"><h2>Rules</h2>
      <button className="settings-button" disabled={busy || dirty || saved.id === DEFAULT_REGEX_GROUP_ID} onClick={() => void run(async () => {
        const rule = newRegexRule();
        await change((current) => ({ ...current, groups: current.groups.map((group) => group.id === saved.id
          ? { ...group, rules: [...group.rules, rule], updatedAt: Date.now() } : group) }));
        router.push(`${base}/rules/${rule.id}`);
      })}><Plus size={17} />Add Rule</button></div>
      {saved.rules.length === 0 && <p>No Rules yet.</p>}
      <div className="regex-list">{saved.rules.map((rule, index) => <article className="regex-card" key={rule.id}
        draggable={!busy && !dirty} onDragStart={() => setDragged(rule.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); const from = saved.rules.findIndex((item) => item.id === dragged);
          if (from >= 0) reorder(from, index); setDragged(null); }} onDragEnd={() => setDragged(null)}>
        <Link className="regex-card-main" href={`${base}/rules/${rule.id}`}>
          <span><strong>{rule.name || "Untitled Rule"}</strong><small>{rule.find || "Empty Find"}</small>
            <small>{rule.mode === "display" ? "Display" : rule.mode === "prompt" ? "Prompt Only" : "Stored"} · {rule.appliesTo.map((role) => role === "assistant" ? "Assistant" : "User").join(" + ")}</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
        <div className="regex-row-actions">
          <Switch aria-label={`Enable ${rule.name || "rule"}`} checked={rule.enabled} disabled={busy || dirty} onChange={(enabled) => void run(async () => {
            await change((current) => ({ ...current, groups: current.groups.map((group) => group.id !== saved.id ? group : {
              ...group, rules: group.rules.map((item) => item.id === rule.id ? { ...item, enabled } : item),
              updatedAt: Date.now(),
            }) }));
          })} />
          <button aria-label={`Move ${rule.name} up`} disabled={busy || dirty || index === 0} onClick={() => reorder(index, index - 1)}><ArrowUp size={17} /></button>
          <button aria-label={`Move ${rule.name} down`} disabled={busy || dirty || index === saved.rules.length - 1} onClick={() => reorder(index, index + 1)}><ArrowDown size={17} /></button>
          {saved.id !== DEFAULT_REGEX_GROUP_ID && <button aria-label={`Delete ${rule.name}`} disabled={busy || dirty} onClick={() => {
            if (!window.confirm(`Delete ${rule.name || "this Rule"}?`)) return;
            void run(async () => { await change((current) => ({ ...current, groups: current.groups.map((group) => group.id !== saved.id ? group : {
              ...group, rules: group.rules.filter((item) => item.id !== rule.id), updatedAt: Date.now(),
            }) })); });
          }}><Trash2 size={17} /></button>}
        </div>
      </article>)}</div>
      <button className="settings-button" disabled={busy || dirty} onClick={() => file.current?.click()}><Upload size={17} />Import Rule</button>
    </section>
    <section className="regex-section"><h2>Test Group</h2><div className="settings-editor">
      <label>Test Input<textarea className="settings-input" rows={4} value={testInput} onChange={(event) => setTestInput(event.target.value)} /></label>
      <strong>Test as</strong><p className="regex-test-hint">Only matching rules in this group will run.</p>
      <label>Message<select className="settings-input" value={role} onChange={(event) => setRole(event.target.value as RegexRole)}>
        <option value="user">User</option><option value="assistant">Assistant</option></select></label>
      <label>Stage<select className="settings-input" value={mode} onChange={(event) => setMode(event.target.value as RegexMode)}>
        <option value="stored">Stored</option><option value="prompt">Prompt Only</option><option value="display">Display Only</option></select></label>
      <div className="regex-test-flow"><strong>Original</strong><pre>{testInput}</pre>
        {test.steps.map((step, index) => <div key={`${step.ruleId}-${index}`}><span>↓</span><strong>{step.ruleName || "Rule"} · {step.status}</strong>
          <small>Before</small><pre>{step.before}</pre><small>After</small><pre>{step.after}</pre>
          {step.error && <small role="alert">{step.error}</small>}</div>)}
        <span>↓</span><strong>Final</strong><pre>{test.output}</pre>
      </div>
    </div></section>
    <section className="regex-section"><h2>Group Actions</h2><div className="settings-action-row regex-actions">
      <button className="settings-button" onClick={() => downloadRegex(exportRegexGroup(saved), saved.name)}><Download size={17} />Export Group</button>
    {saved.id !== DEFAULT_REGEX_GROUP_ID && <button className="settings-button settings-danger" disabled={busy} onClick={() => {
      if (!window.confirm(`Delete ${saved.name} and all its Rules?`)) return;
      void run(async () => { await removeGroup(saved.id); router.push("/settings/regex"); });
    }}><Trash2 size={17} />Delete Regex Group</button>}</div></section>
  </PageShell>;
}
