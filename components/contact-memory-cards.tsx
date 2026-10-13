"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Character } from "../lib/foundation-types";
import { countActiveMemories } from "../lib/memory/bank";
import { browserMemoryStorage } from "../lib/memory/browser";
import { readBrowserCharacterState } from "../lib/memory/state-browser";
import type { StateView } from "../lib/memory/state-runtime";
import type { MemoryStorage } from "../lib/memory/storage";
import { useCharacterState } from "./use-character-state";

const STATE_PREVIEW = 3;
const viewOf = (view: StateView) => view;
const label = (key: string) => key.replace(/[_-]/g, " ");

type Count = { characterId: string; value: number | null };

/**
 * Contact Info shortcuts into the Memory app for this Character: a short read-only State preview and the Active memory
 * count. Both reuse the Memory app's own reads (no second system); the full lists stay in the Memory app.
 */
export function ContactMemoryCards({ character, disabled = false, storage = browserMemoryStorage, loadState = readBrowserCharacterState }: {
  character: Pick<Character, "characterId" | "backstory">; disabled?: boolean; storage?: MemoryStorage;
  loadState?: (character: Pick<Character, "characterId" | "backstory">) => Promise<StateView>;
}) {
  const { characterId } = character;
  const [count, setCount] = useState<Count | null>(null);
  useEffect(() => {
    let active = true;
    const read = () => {
      storage.listMemories(characterId).then((rows) => countActiveMemories(rows), () => null)
        .then((value) => { if (active) setCount({ characterId, value }); });
    };
    read();
    const visible = () => { if (window.document.visibilityState === "visible") read(); };
    window.document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    return () => { active = false; window.document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [characterId, storage]);
  const { current } = useCharacterState(character, loadState, viewOf);
  // A result belongs to one Character; switching Contact never shows the previous one's numbers.
  const shown = count?.characterId === characterId ? count.value : undefined;
  const entries = current?.data?.entries.filter((row) => row.status === "active") ?? [];
  const href = (tab: string) => `/memory/${encodeURIComponent(characterId)}?tab=${tab}`;
  const wrap = (tab: string, body: React.ReactNode) => disabled
    ? <div className="contact-card-link" aria-disabled="true">{body}</div>
    : <Link className="contact-card-link" href={href(tab)}>{body}</Link>;
  return <>
    <section className="contact-info-section" aria-labelledby="contact-state-title">
      <h2 id="contact-state-title">Character State</h2>
      {wrap("state", <>
        {!current || (!current.data && !current.error) ? <span className="subtle" role="status">Loading…</span>
          : current.error ? <span className="subtle" role="alert">Could not load State.</span>
          : !entries.length ? <span className="subtle">No lasting changes recorded.</span>
          : <span className="contact-card-lines">
            {entries.slice(0, STATE_PREVIEW).map((row) => <span key={row.id}><b>{label(row.key)}</b>: {row.value}</span>)}
            {entries.length > STATE_PREVIEW && <span className="subtle">+{entries.length - STATE_PREVIEW} more</span>}
          </span>}
        <span className="subtle" aria-hidden="true">›</span>
      </>)}
    </section>
    <section className="contact-info-section" aria-labelledby="contact-memory-title">
      <h2 id="contact-memory-title">Memory</h2>
      {wrap("memories", <>
        <span>{shown === undefined ? "Loading…" : shown === null ? "Unavailable" : `${shown} ${shown === 1 ? "memory" : "memories"}`}</span>
        <span className="subtle" aria-hidden="true">›</span>
      </>)}
    </section>
  </>;
}
