"use client";
import { useEffect, useId, useState } from "react";
import { MEMORY_KIND_LABEL } from "../../lib/memory/bank";
import { resolveInjected, type InjectedMemory } from "../../lib/memory/injected";
import { browserMemoryStorage } from "../../lib/memory/instance";
import type { ChatMessage } from "../../lib/chat/types";
import { BottomSheet } from "../settings/ui/modal";

type Tab = "memories" | "journal";
type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; items: InjectedMemory[] };
const TABS: [Tab, string][] = [["memories", "Long Term Memories"], ["journal", "Journal"]];

/** What this reply was actually given from Memory. Read-only: it changes nothing and makes no request. */
export function MessageMemory({ message, characterId, onClose }: { message: ChatMessage; characterId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("memories");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const tabId = useId();
  const refs = message.memoryRefs;

  useEffect(() => {
    if (!refs?.length) return;
    let current = true;
    void Promise.all([browserMemoryStorage.listMemories(characterId), browserMemoryStorage.listOperations(characterId)])
      .then(([rows, operations]) => resolveInjected(refs, rows, operations))
      .then((items) => { if (current) setLoad({ state: "ready", items }); })
      .catch(() => { if (current) setLoad({ state: "failed" }); });
    return () => { current = false; };
  }, [refs, characterId]);

  const view: Load = refs?.length ? load : { state: "ready", items: [] };
  const items = view.state === "ready" ? view.items.filter((item) => !!item.ref.journal === (tab === "journal")) : [];
  return <BottomSheet title="Long Term Memory" className="chat-memory-sheet" onClose={onClose}>
    <div className="chat-memory-tabs" role="tablist" aria-label="Memory used for this reply">
      {TABS.map(([id, label], index) => <button key={id} type="button" role="tab" id={`${tabId}-${id}`} aria-controls={`${tabId}-panel`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
          setTab(TABS[next][0]); document.getElementById(`${tabId}-${TABS[next][0]}`)?.focus();
        }}>{label}</button>)}
    </div>
    <section role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
    {refs === undefined && <p className="subtle chat-memory-provenance">This reply did not record recalled memory details.</p>}
    {view.state === "loading" ? <p className="subtle">Loading…</p>
      : view.state === "failed" ? <p role="alert">Memory could not be read. Close this and try again.</p>
      : !items.length ? <p className="subtle chat-memory-empty">No recalled memories yet.</p>
      : <ul className="chat-memory-list">{items.map((item) => <li key={item.ref.id} className="chat-memory-item">
        {item.state === "deleted" ? <p className="subtle">This memory has been deleted.</p>
          : item.state === "unavailable" ? <p className="subtle">This version is no longer available.</p>
          : <>
            <p className="chat-memory-text">{item.state === "earlier" ? item.text : item.row.text}</p>
            <small className="subtle">
              {tab === "journal" ? "Journal" : MEMORY_KIND_LABEL[item.state === "earlier" ? item.kind : item.row.kind] ?? "Memory"}
              {item.state === "earlier" ? " · Version before a later edit" : item.row.status !== "active" ? ` · ${item.row.status}` : ""}
            </small>
          </>}
      </li>)}</ul>}
    </section>
  </BottomSheet>;
}
