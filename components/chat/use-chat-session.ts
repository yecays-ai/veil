"use client";
import { useEffect, useRef, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";
import { createChatSessionLifecycle } from "../../lib/chat/session-lifecycle";
import { prefetchedChatSession } from "../../lib/chat/session-prefetch";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";

export function useChatSession(characterId: string, enabled: boolean) {
  // A read that started when the chat was pressed in the list seeds the first frame; the lifecycle below replaces it.
  const [seed] = useState(() => ({ characterId, snapshot: prefetchedChatSession(characterId, chatStorage) }));
  const [state, setState] = useState<{ characterId: string; session: ChatSession | null; messages: ChatMessage[]; error: string }>(() => ({
    characterId, session: seed.snapshot?.session ?? null, messages: seed.snapshot?.messages ?? [], error: "",
  }));
  const lifecycle = useRef<ReturnType<typeof createChatSessionLifecycle> | null>(null);
  useEffect(() => {
    const owner = createChatSessionLifecycle(characterId, chatStorage, (next, error) => {
      setState({ characterId, session: next?.session ?? null, messages: next?.messages ?? [], error });
    }, (id) => chatEngine.stop(id));
    owner.seed(seed.characterId === characterId ? seed.snapshot : null);
    lifecycle.current = owner;
    owner.mount(false);
    return () => { owner.unmount(); lifecycle.current = null; };
  // The seed is read once at mount; a different character never reuses it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);
  useEffect(() => { lifecycle.current?.setEnabled(enabled); }, [characterId, enabled]);
  const current = enabled && state.characterId === characterId;
  return { session: current ? state.session : null, messages: current ? state.messages : [], loadError: current ? state.error : "" };
}
