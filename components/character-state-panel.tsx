"use client";

import type { Character } from "../lib/foundation-types";
import { readBrowserCharacterState } from "../lib/memory/state-browser";
import type { StateView } from "../lib/memory/state-runtime";
import { useCharacterState } from "./use-character-state";

const viewOf = (view: StateView) => view;
/** Read-only current facts. */
export function CharacterStatePanel({ character, load = readBrowserCharacterState }: {
  character: Pick<Character, "characterId" | "backstory">;
  load?: (character: Pick<Character, "characterId" | "backstory">) => Promise<StateView>;
}) {
  const { current: state, retry } = useCharacterState(character, load, viewOf);
  const current = state && { ...state, view: state.data };
  return <section className="profile-details" aria-label="Character State">
    <h2>Character State</h2>
    {!current || (!current.view && !current.error) ? <p role="status">Loading State…</p>
      : current.error ? <p role="alert">{current.error} <button type="button" onClick={retry}>Retry</button></p>
      : !current.view!.entries.length ? <p>No lasting changes recorded.</p>
      : <dl>{current.view!.entries.map((row) => <div key={row.id}>
        <dt>{row.key.replace(/[_-]/g, " ")} {row.status !== "active" && <small>({row.status === "pending" ? "Pending review · not active" : "Suspended · not active"})</small>}</dt>
        <dd>{row.value}</dd>
      </div>)}</dl>}
  </section>;
}
