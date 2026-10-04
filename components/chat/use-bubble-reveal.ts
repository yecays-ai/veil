"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BubbleRevealQueue } from "../../lib/chat/bubble-pacing";
import type { ChatMessage } from "../../lib/chat/types";

export function useBubbleReveal(sessionId: string | undefined, messages: readonly ChatMessage[], streaming: boolean, unavailable: boolean) {
  const [queue] = useState(() => new BubbleRevealQueue());
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => () => queue.cancel(), [queue, sessionId]);
  useEffect(() => {
    if (streaming || unavailable) queue.cancel();
  }, [queue, streaming, unavailable]);
  useEffect(() => { queue.reconcile(messages); }, [queue, messages]);
  return { queue, state: snapshot.sessionId === sessionId ? snapshot : undefined };
}
