"use client";
import type { Character } from "../lib/foundation-types";
import { readBrowserCharacterStateDetail } from "../lib/memory/state-browser";
import type { StateChange, StateDetail } from "../lib/memory/state-runtime";
import { useCharacterState } from "./use-character-state";

const viewOf = (detail: StateDetail) => detail.view;
const label = (key: string) => key.replace(/[_-]/g, " ");

/** State tab of a Character's memory page: current lasting facts and how they changed. Read-only; the Character owns State. */
export function MemoryState({ character, load = readBrowserCharacterStateDetail }: {
  character: Pick<Character, "characterId" | "backstory" | "name">;
  load?: (character: Pick<Character, "characterId" | "backstory">) => Promise<StateDetail>;
}) {
  const { current, retry } = useCharacterState(character, load, viewOf);
  if (!current || (!current.data && !current.error)) return <p role="status">Loading State…</p>;
  if (current.error || !current.data) return <p role="alert">{current.error} <button type="button" className="text-button" onClick={retry}>Retry</button></p>;
  const { view, changes } = current.data;
  const keys = [...new Set(changes.map((change) => change.key))];
  return <>
    <p className="subtle">Lasting changes in {character.name}&apos;s life. {character.name} keeps this up to date; you can read it here.</p>
    {!view.entries.length ? <p className="empty-copy subtle">No lasting changes recorded.</p>
      : <dl className="memory-state-list" aria-label="Current State">{view.entries.map((row) => <div key={row.id} className="profile-card">
        <dt>{label(row.key)} {row.status !== "active" && <small>({row.status === "pending" ? "Pending review · not active" : "Suspended · not active"})</small>}</dt>
        <dd>{row.value}</dd>
      </div>)}</dl>}
    {changes.some((change) => !change.current) && <section aria-label="State changes">
      <h2>Changes</h2>
      {keys.map((key) => {
        const versions = changes.filter((change: StateChange) => change.key === key);
        if (versions.length < 2) return null;
        return <ol key={key} className="memory-state-changes" aria-label={`Changes to ${label(key)}`}>
          {versions.map((change) => <li key={change.id}>
            <strong>{label(key)}</strong>{change.current ? " · now" : ""}
            <p className="memory-bank-text">{change.value}</p>
            <small className="subtle">{new Date(change.createdAt).toLocaleString()}</small>
          </li>)}
        </ol>;
      })}
    </section>}
  </>;
}
