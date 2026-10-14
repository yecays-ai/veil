"use client";

import { useEffect, useState } from "react";
import type { Character } from "../lib/foundation-types";
import { subscribeCharacterState } from "../lib/memory/state-events";
import type { StateView } from "../lib/memory/state-runtime";
import { chatStorage } from "../lib/chat/storage";

type Subject = Pick<Character, "characterId" | "backstory">;
export type CharacterStateSnapshot<T> = { characterId: string; background: string | null; data?: T; error?: string };

/**
 * Read-only current State for one Character. Each effect instance owns its async responses and subscriptions: a role or
 * Background change hides the previous result synchronously, a newer wake invalidates an older response, and a read
 * that fails is reported, never shown as "no State".
 */
export function useCharacterState<T>(character: Subject, load: (character: Subject) => Promise<T>, viewOf: (data: T) => StateView) {
  const [snapshot, setSnapshot] = useState<CharacterStateSnapshot<T> | null>(null);
  const [revision, setRevision] = useState(0);
  const { characterId, backstory } = character;
  useEffect(() => {
    let active = true, request = 0, running = false, queued = false, initial = true;
    const refresh = async (owner: number) => {
      // Yield initial work; role changes hide the previous view synchronously through the render identity check.
      await Promise.resolve();
      if (!active || owner !== request) return;
      if (initial) { setSnapshot({ characterId, background: backstory }); initial = false; }
      try {
        const data = await load({ characterId, backstory });
        if (active && owner === request) {
          const view = viewOf(data);
          if (view.characterId !== characterId || view.background !== backstory) throw new Error("Character authority changed.");
          setSnapshot({ characterId, background: backstory, data });
        }
      } catch {
        if (active && owner === request) setSnapshot({ characterId, background: backstory, error: "Could not load Character State." });
      }
    };
    const wake = () => {
      if (!active || document.visibilityState === "hidden") return;
      request++; // New evidence invalidates the current result even when the next read is queued.
      if (running) { queued = true; return; }
      running = true;
      void refresh(request).finally(() => {
        running = false;
        if (queued && active) { queued = false; wake(); }
      });
    };
    const stopState = subscribeCharacterState(characterId, wake);
    const stopChat = chatStorage.subscribe((change) => { if (change.domain === "messages" || change.domain === "session") wake(); });
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      active = false; request++; stopState(); stopChat();
      window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake);
    };
    // `load` and `viewOf` are stable inputs per mount, as in the panel this was taken from.
  }, [characterId, backstory, load, viewOf, revision]);
  const current = snapshot?.characterId === characterId && snapshot.background === backstory ? snapshot : null;
  return { current, retry: () => setRevision((value) => value + 1) };
}
