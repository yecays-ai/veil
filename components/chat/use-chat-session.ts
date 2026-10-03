"use client";
import { useEffect, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";

export function useChatSession(characterId: string, enabled: boolean) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      revision = 0;
    let sessionId: string | undefined;
    let unsubscribe = () => {};
    async function refresh() {
      if (!sessionId) return;
      const current = ++revision;
      try {
        const data = await chatStorage.readSession(sessionId);
        if (active && current === revision) {
          setSession(data.session);
          setMessages(data.messages);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "Could not load this conversation. Existing messages have not been changed.",
          );
      }
    }
    chatStorage
      .openSession(characterId)
      .then(async (opened) => {
        sessionId = opened.id;
        if (!active) return;
        unsubscribe = chatStorage.subscribe(() => {
          void refresh();
        });
        await refresh();
      })
      .catch(() => {
        if (active)
          setError(
            "Chat storage is unavailable. Existing messages have not been changed.",
          );
      });
    return () => {
      active = false;
      unsubscribe();
      if (sessionId) chatEngine.stop(sessionId);
    };
  }, [characterId, enabled]);
  return { session, messages, loadError: error };
}
