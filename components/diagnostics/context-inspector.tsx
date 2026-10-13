"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { contextInspector, type InspectorRecord } from "../../lib/chat/context-inspector";

const QUERY_KEY = "veilInspector";
const EMPTY: readonly InspectorRecord[] = [];

/** M6 P5: development-only, read-only view of redacted request summaries. Production renders nothing. */
export function ContextInspectorGate() {
  if (process.env.NODE_ENV !== "development") return null;
  return <ContextInspectorEntry />;
}

function ContextInspectorEntry() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    // Deferred for hydration parity: the server never renders the panel.
    const timer = window.setTimeout(() => {
      setEnabled(new URLSearchParams(window.location.search).get(QUERY_KEY) === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (!enabled) return null;
  return <ContextInspectorPanel onClose={() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(QUERY_KEY);
    window.history.replaceState(window.history.state, "", url);
    setEnabled(false);
  }} />;
}

function ContextInspectorPanel({ onClose }: { onClose: () => void }) {
  const records = useSyncExternalStore(contextInspector.subscribe, contextInspector.snapshot, () => EMPTY);
  const [open, setOpen] = useState(false);
  return <aside data-context-inspector="" style={{
    position: "fixed", bottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
    left: "calc(env(safe-area-inset-left, 0px) + 4px)", zIndex: 2147483000,
    pointerEvents: "none", color: "#fff", font: "12px/1.35 system-ui, sans-serif",
  }}>
    {open && <section aria-label="Context inspector" style={{
      pointerEvents: "auto", width: "min(340px, calc(100vw - 16px))", maxHeight: "50vh",
      overflow: "auto", marginBottom: 4, padding: 10, borderRadius: 10, background: "#101820f2",
      border: "1px solid #ffffff55", boxShadow: "0 4px 18px #0008",
    }}>
      <strong>Context Inspector · dev only</strong>
      <p style={{ margin: "4px 0", opacity: .8 }}>
        Redacted summaries of the last {records.length} real requests, in memory only. No message text, keywords or keys.
      </p>
      <div style={{ display: "flex", gap: 6, position: "sticky", top: 0, background: "#101820" }}>
        <button type="button" onClick={() => contextInspector.clear()}>Clear</button>
        <button type="button" onClick={onClose}>Stop</button>
        <button type="button" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {records.length === 0 && <p>No requests yet.</p>}
      {records.map((record) => <InspectorEntry key={record.requestId} record={record} />)}
    </section>}
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
      style={{ pointerEvents: "auto", minHeight: 22, border: "1px solid #ffffff66", borderRadius: 12,
        padding: "2px 8px", color: "#fff", background: "#111d", font: "11px system-ui" }}>
      CTX · {records.length}
    </button>
  </aside>;
}

function InspectorEntry({ record }: { record: InspectorRecord }) {
  const { prompt, usage, terminal, start } = record;
  return <details style={{ marginTop: 8, borderTop: "1px solid #ffffff33", paddingTop: 6 }}>
    <summary>
      {record.source} · {terminal?.outcome ?? "running"}
      {terminal ? ` · ${terminal.durationMs}ms` : ""}
      {usage?.total_tokens != null ? ` · ${usage.total_tokens} tok` : ""}
    </summary>
    <div>request {record.requestId.slice(0, 8)}{record.sessionIdHash ? ` · session#${record.sessionIdHash}` : ""}</div>
    {record.model && <div>model {record.model}</div>}
    {start && <div>messages {start.messageCount} · {start.totalCharacters} chars · ~{start.estimatedInputTokens} tok est.</div>}
    {usage && <div>usage in {usage.prompt_tokens ?? "?"} / out {usage.completion_tokens ?? "?"}
      {" "}· cache hit {usage.prompt_cache_hit_tokens ?? "?"} / miss {usage.prompt_cache_miss_tokens ?? "?"}</div>}
    {terminal && (terminal.finishReason || terminal.errorCategory) && <div>
      {terminal.finishReason ? `finish ${terminal.finishReason}` : ""}
      {terminal.errorCategory ? ` error ${terminal.errorCategory}${terminal.httpStatus ? ` ${terminal.httpStatus}` : ""}` : ""}
      {terminal.timeoutPhase ? ` (${terminal.timeoutPhase})` : ""}
    </div>}
    {prompt?.memory && <div>memory {prompt.memory.outcome} · {prompt.memory.ids.length} entries · {prompt.memory.characterLength} chars
      {prompt.memory.ids.length > 0 && <small> [{prompt.memory.ids.map((id) => id.slice(0, 8)).join(", ")}]</small>}</div>}
    {prompt && <table style={{ width: "100%", marginTop: 4, borderCollapse: "collapse" }}>
      <tbody>{prompt.sections.map((section, index) => <tr key={index}>
        <td>{section.identifier}</td><td>{section.role}</td><td style={{ textAlign: "right" }}>{section.characterLength}</td>
      </tr>)}</tbody>
    </table>}
  </details>;
}
