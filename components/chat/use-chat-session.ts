"use client";
import { useEffect, useRef, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";
import { createChatSessionLifecycle } from "../../lib/chat/session-lifecycle";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";
import { recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";

export function useChatSession(characterId: string, enabled: boolean) {
  const [state, setState] = useState<{ characterId: string; session: ChatSession | null; messages: ChatMessage[]; error: string }>({
    characterId, session: null, messages: [], error: "",
  });
  const lifecycle = useRef<ReturnType<typeof createChatSessionLifecycle> | null>(null);
  useEffect(() => {
    const owner = createChatSessionLifecycle(characterId, chatStorage, (next, error) => {
      recordChatDiagnostic("session-messages-published", { characterId, hasSession: !!next, messageCount: next?.messages.length ?? 0, error: !!error });
      setState({ characterId, session: next?.session ?? null, messages: next?.messages ?? [], error });
    }, (id) => chatEngine.stop(id));
    lifecycle.current = owner;
    owner.mount(false);
    return () => { owner.unmount(); lifecycle.current = null; };
  }, [characterId]);
  useEffect(() => { lifecycle.current?.setEnabled(enabled); }, [characterId, enabled]);
  const current = enabled && state.characterId === characterId;
  return { session: current ? state.session : null, messages: current ? state.messages : [], loadError: current ? state.error : "" };
}
