const CHANNEL = "veil-character-state-v1", EVENT = "veil-character-state-changed";

/** Post-commit invalidation contains only Character identity, never State or message text. */
export function notifyCharacterStateChanged(characterId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new window.CustomEvent(EVENT, { detail: characterId }));
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL);
      try { channel.postMessage({ characterId }); } finally { channel.close(); }
    }
  } catch { /* Observation cannot undo an already committed write. */ }
}

/** One bounded subscription per mounted view; no polling or storage/model calls. */
export function subscribeCharacterState(characterId: string, refresh: () => void): () => void {
  const local = (event: Event) => { if ((event as CustomEvent).detail === characterId) refresh(); };
  window.addEventListener(EVENT, local);
  let channel: BroadcastChannel | undefined;
  try { channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel(CHANNEL); } catch { /* local events/focus remain available */ }
  if (channel) channel.onmessage = (event) => { if (event.data?.characterId === characterId) refresh(); };
  return () => { window.removeEventListener(EVENT, local); channel?.close(); };
}
