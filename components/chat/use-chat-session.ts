"use client";
import { useEffect, useState } from "react";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";
import type { ChatMessage, ChatSession } from "../../lib/chat/types";

export function useChatSession(conversationId: string, enabled: boolean) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true,
      revision = 0;
    const sessionId = conversationId;
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
      .readSession(conversationId)
      .then(async () => {
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
  }, [conversationId, enabled]);
  return { session: session?.id === conversationId ? session : null,
    messages: session?.id === conversationId ? messages : [], loadError: error };
}
