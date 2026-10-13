"use client";

import { useEffect, useState } from "react";
import type { Character } from "../lib/foundation-types";
import { readBrowserCharacterState } from "../lib/memory/state-browser";
import { subscribeCharacterState } from "../lib/memory/state-events";
import type { StateView } from "../lib/memory/state-runtime";
import { chatStorage } from "../lib/chat/storage";

type Snapshot = { characterId: string; background: string | null; view?: StateView; error?: string };
/** Read-only current facts. Each effect instance owns its async responses and subscriptions. */
export function CharacterStatePanel({ character, load = readBrowserCharacterState }: {
  character: Pick<Character, "characterId" | "backstory">;
  load?: (character: Pick<Character, "characterId" | "backstory">) => Promise<StateView>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const { characterId, backstory } = character;
  useEffect(() => {
    let active = true, request = 0;
    const refresh = async () => {
      const owner = ++request;
      // Yield initial work; role changes hide the previous view synchronously through the render identity check.
      await Promise.resolve();
      if (!active || owner !== request) return;
      setSnapshot({ characterId, background: backstory });
      try {
        const view = await load({ characterId, backstory });
        if (active && owner === request) {
          if (view.characterId !== characterId || view.background !== backstory) throw new Error("Character authority changed.");
          setSnapshot({ characterId, background: backstory, view });
        }
      } catch {
        if (active && owner === request) setSnapshot({ characterId, background: backstory, error: "Could not load Character State." });
      }
    };
    const wake = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const stopState = subscribeCharacterState(characterId, wake);
    const stopChat = chatStorage.subscribe((change) => { if (change.domain === "messages" || change.domain === "session") wake(); });
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    void refresh();
    return () => {
      active = false; request++; stopState(); stopChat();
      window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake);
    };
  }, [characterId, backstory, load, revision]);
  const current = snapshot?.characterId === characterId && snapshot.background === backstory ? snapshot : null;
  return <section className="profile-details" aria-label="Character State">
    <h2>Character State</h2>
    {!current || (!current.view && !current.error) ? <p role="status">Loading State…</p>
      : current.error ? <p role="alert">{current.error} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>
      : !current.view!.entries.length ? <p>No lasting changes recorded.</p>
      : <dl>{current.view!.entries.map((row) => <div key={row.id}>
        <dt>{row.key.replace(/[_-]/g, " ")} {row.status !== "active" && <small>({row.status === "pending" ? "Pending review · not active" : "Suspended · not active"})</small>}</dt>
        <dd>{row.value}</dd>
      </div>)}</dl>}
  </section>;
}
