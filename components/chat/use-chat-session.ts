"use client";
import { useEffect, useRef, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";
import { createChatSessionLifecycle } from "../../lib/chat/session-lifecycle";
import { prefetchedChatSessionEntry, takePrefetchedChatSession } from "../../lib/chat/session-prefetch";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";
import { recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";

export function useChatSession(characterId: string, enabled: boolean) {
  const [seed] = useState(() => prefetchedChatSessionEntry(characterId, chatStorage));
  const [state, setState] = useState<{ characterId: string; session: ChatSession | null; messages: ChatMessage[]; error: string }>(() => ({
    characterId, session: seed?.snapshot.session ?? null, messages: seed?.snapshot.messages ?? [], error: "",
  }));
  const claimedSeed = useRef<{ characterId: string; revision: number; snapshot: { session: ChatSession; messages: ChatMessage[] } } | null>(null);
  const lifecycle = useRef<ReturnType<typeof createChatSessionLifecycle> | null>(null);
  useEffect(() => {
    const consumed = takePrefetchedChatSession(characterId, chatStorage);
    if (consumed) claimedSeed.current = { characterId, ...consumed };
    const replayed = claimedSeed.current?.characterId === characterId &&
      claimedSeed.current.revision === chatStorage.changeRevision() ? claimedSeed.current : null;
    const initial = consumed?.revision === chatStorage.changeRevision() ? consumed : replayed;
    const owner = createChatSessionLifecycle(characterId, chatStorage, (next, error) => {
      recordChatDiagnostic("session-messages-published", { characterId, hasSession: !!next, messageCount: next?.messages.length ?? 0, error: !!error });
      setState({ characterId, session: next?.session ?? null, messages: next?.messages ?? [], error });
    }, (id) => chatEngine.stop(id));
    owner.seed(initial?.snapshot ?? null);
    setState({ characterId, session: initial?.snapshot.session ?? null, messages: initial?.snapshot.messages ?? [], error: "" });
    lifecycle.current = owner;
    owner.mount(false);
    return () => { owner.unmount(); lifecycle.current = null; };
  // The initial seed is a pure render snapshot; its revision is checked before route ownership and again on effect replay.
  }, [characterId]);
  useEffect(() => { lifecycle.current?.setEnabled(enabled); }, [characterId, enabled]);
  const switchedSeed = state.characterId === characterId ? null : prefetchedChatSessionEntry(characterId, chatStorage);
  const current = enabled && (state.characterId === characterId || !!switchedSeed);
  return {
    session: current ? (state.characterId === characterId ? state.session : switchedSeed?.snapshot.session ?? null) : null,
    messages: current ? (state.characterId === characterId ? state.messages : switchedSeed?.snapshot.messages ?? []) : [],
    loadError: current && state.characterId === characterId ? state.error : "",
  };
}
