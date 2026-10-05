"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { importRegexGroup, newRegexGroup, newRegexRule, type RegexRule } from "../../../lib/regex";
import { DEFAULT_REGEX_GROUP_ID } from "../../../lib/regex-defaults";
import { useRegex } from "./use-regex";
import { RegexInlineRule } from "./regex-inline-rule";

export function RegexList() {
  const { document, error, notice, busy, run, change, setNotice } = useRegex();
  const file = useRef<HTMLInputElement>(null);
  const [newRuleId, setNewRuleId] = useState<string | null>(null);
  const defaults = document?.groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
  const custom = document?.groups.filter((group) => group.id !== DEFAULT_REGEX_GROUP_ID) ?? [];
  async function saveRule(groupId: string, next: RegexRule) {
    await change((current) => ({ ...current, groups: current.groups.map((group) => group.id !== groupId ? group : {
      ...group, updatedAt: Date.now(), rules: group.rules.map((rule) => rule.id === next.id ? next : rule),
    }) }));
  }
  return <PageShell className="settings-app regex-manager" title="Regex" backHref="/settings" backLabel="Back to Settings">
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    {!document && !error && <p role="status">Loading Regex Rules…</p>}
    <section className="regex-section"><h2>Default Rules</h2>
      {defaults?.rules.map((rule) => <RegexInlineRule key={rule.id} rule={rule} busy={busy}
        onSave={(next) => saveRule(DEFAULT_REGEX_GROUP_ID, next)} />)}
    </section>
    <section className="regex-section"><h2>Custom Rules</h2>
      {custom.length === 0 && <p>No custom rules yet.</p>}
      {custom.map((group) => <div key={group.id} className="regex-custom-group">
        <Link href={`/settings/regex/${group.id}`}>{group.name} · Group settings</Link>
        {group.rules.map((rule) => <RegexInlineRule key={rule.id} rule={rule} busy={busy}
          initiallyOpen={rule.id === newRuleId}
          onSave={(next) => saveRule(group.id, next)} />)}
        <Link className="settings-button" href={`/settings/regex/${group.id}`}>Add Rule to {group.name}</Link>
      </div>)}
      <div className="settings-action-row regex-actions">
        <button className="settings-button" disabled={!document || busy} onClick={() => void run(async () => {
          const rule = newRegexRule();
          const first = custom.find((item) => item.enabled);
          const group = first ?? { ...newRegexGroup(), name: "My Rules" };
          await change((current) => ({ ...current, groups: first
            ? current.groups.map((item) => item.id === first.id
              ? { ...item, rules: [...item.rules, rule], updatedAt: Date.now() } : item)
            : [...current.groups, { ...group, rules: [rule] }] }));
          setNewRuleId(rule.id);
        })}><Plus size={17} />Add Rule</button>
        <Link className="settings-button" href="/settings/regex/new">New Group</Link>
        <button className="settings-button" disabled={!document || busy} onClick={() => file.current?.click()}><Upload size={17} />Import</button>
      </div>
    </section>
    <input hidden ref={file} type="file" accept=".json,application/json" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = "";
      if (selected) void run(async () => {
        const json = await selected.text();
        const warnings: string[] = [];
        await change((current) => {
          const result = importRegexGroup(current, json); warnings.push(...result.warnings);
          return result.document;
        });
        setNotice(warnings.length ? `Imported. ${warnings.join(" ")}` : "Regex Group imported.");
      });
    }} />
  </PageShell>;
}
