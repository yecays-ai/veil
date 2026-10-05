"use client";
import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { PageShell } from "../../page-shell";
import { Alert } from "../ui/feedback";
import { importRegexGroup, newRegexGroup, exportRegexGroup } from "../../../lib/regex";
import { useRegex } from "./use-regex";
import { downloadRegex } from "./files";

export function RegexList() {
  const { document, error, notice, busy, run, change, removeGroup, setNotice } = useRegex();
  const file = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return <PageShell className="settings-app regex-manager" title="Regex Groups" backHref="/settings" backLabel="Back to Settings">
    <div className="settings-action-row regex-actions">
      <button className="settings-button" disabled={!document || busy} onClick={() => file.current?.click()}><Upload size={17} />Import</button>
      <button className="settings-button" disabled={!document || busy} onClick={() => void run(async () => {
        const group = newRegexGroup();
        await change((current) => ({ ...current, groups: [...current.groups, group] }));
        router.push(`/settings/regex/${group.id}`);
      })}><Plus size={17} />New Regex</button>
    </div>
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
    {error && <Alert variant="danger">{error}</Alert>}{notice && <Alert variant="success">{notice}</Alert>}
    {!document && !error && <p role="status">Loading Regex Groups…</p>}
    {document?.groups.length === 0 && <p>No Regex Groups yet.</p>}
    <div className="regex-list">{document?.groups.map((group) => <article className="regex-card" key={group.id}>
      <Link className="regex-card-main" href={`/settings/regex/${group.id}`}>
        <span><strong>{group.name}</strong>{group.description && <small>{group.description}</small>}
          <small>{group.rules.length} Rules · {group.enabled ? "Enabled" : "Disabled"}</small></span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
      <div className="regex-row-actions">
        <label><input type="checkbox" checked={group.enabled} disabled={busy} onChange={(event) => void run(async () => {
          await change((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id
            ? { ...item, enabled: event.target.checked, updatedAt: Date.now() } : item) }));
        })} />Enabled</label>
        <button aria-label={`Export ${group.name}`} onClick={() => downloadRegex(exportRegexGroup(group), group.name)}><Download size={17} /></button>
        <button aria-label={`Delete ${group.name}`} disabled={busy} onClick={() => {
          if (!window.confirm(`Delete ${group.name} and its Rules?`)) return;
          void run(async () => { await removeGroup(group.id); });
        }}><Trash2 size={17} /></button>
      </div>
    </article>)}</div>
  </PageShell>;
}
