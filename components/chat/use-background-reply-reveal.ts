"use client";
import { useEffect, useRef } from "react";
import type { BubbleRevealQueue } from "../../lib/chat/bubble-pacing";
import type { BubbleTiming, ChatMessage } from "../../lib/chat/types";

type Options = {
  sessionId?: string;
  generationId?: string;
  messages: readonly ChatMessage[];
  streaming: boolean;
  /** True while this page runs its own reply, which already paces its bubbles. */
  owned: boolean;
  /** Whether a reply is still running here; a generation the room only sees after it ended is not paced. */
  running: (sessionId: string) => boolean;
  timing: BubbleTiming;
};

/**
 * Paces the bubbles of a reply this page did not start (Life Mode, a proactive message) with the same queue and
 * timing as a requested reply. Display only: storage still writes the whole reply at once.
 */
export function useBackgroundReplyReveal(queue: BubbleRevealQueue, { sessionId, generationId, messages, streaming, owned, running, timing }: Options) {
  const watch = useRef<{ sessionId: string; generationId: string; token?: number; known: ReadonlySet<string> } | null>(null);
  useEffect(() => {
    const current = watch.current;
    if (current && current.sessionId === sessionId && current.generationId === generationId) return;
    watch.current = null;
    if (current?.token !== undefined) {
      const reply = current.sessionId === sessionId
        ? messages.filter((message) => message.role === "assistant" && !current.known.has(message.id)) : [];
      if (reply.length) queue.complete(current.sessionId, reply, performance.now(), current.token);
      else queue.settle(current.sessionId, current.token);
    }
    if (!sessionId || !generationId) return;
    // The unfinished draft is not part of what was already on screen, so its bubbles stay hidden until paced.
    const settled = messages.filter((message) => message.status !== "streaming");
    // A reply this page owns is decided once, at the first sight of its generation, so its own pacing is never replaced.
    const token = owned || streaming || !running(sessionId) ? undefined : queue.begin(sessionId, settled, false, performance.now(), timing);
    watch.current = { sessionId, generationId, token, known: new Set(settled.map((message) => message.id)) };
  }, [queue, sessionId, generationId, messages, streaming, owned, running, timing]);
}
