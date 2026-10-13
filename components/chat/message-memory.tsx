"use client";
import { useEffect, useState } from "react";
import { MEMORY_KIND_LABEL } from "../../lib/memory/bank";
import { resolveInjected, type InjectedMemory } from "../../lib/memory/injected";
import { browserMemoryStorage } from "../../lib/memory/instance";
import type { ChatMessage } from "../../lib/chat/types";
import { BottomSheet } from "../settings/ui/modal";

type Tab = "memories" | "journal";
type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; items: InjectedMemory[] };

/** What this reply was actually given from Memory. Read-only: it changes nothing and makes no request. */
export function MessageMemory({ message, characterId, onClose }: { message: ChatMessage; characterId: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("memories");
  const [load, setLoad] = useState<Load>({ state: "loading" });
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
  return <BottomSheet title="Memory" onClose={onClose}>
    <div className="chat-memory-tabs" role="tablist" aria-label="Memory used for this reply">
      <button role="tab" aria-selected={tab === "memories"} onClick={() => setTab("memories")}>Long Term Memories</button>
      <button role="tab" aria-selected={tab === "journal"} onClick={() => setTab("journal")}>Journal</button>
    </div>
    {refs === undefined ? <p className="subtle">Nothing was recorded for this reply. It was written before this feature existed, or Memory could not be read at the time.</p>
      : view.state === "loading" ? <p className="subtle">Loading…</p>
      : view.state === "failed" ? <p role="alert">Memory could not be read. Close this and try again.</p>
      : !items.length ? <p className="subtle">{tab === "journal" ? "No Journal entry was used for this reply." : "No long term memory was used for this reply."}</p>
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
  </BottomSheet>;
}
