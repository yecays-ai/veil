import type { ChatMessage, ChatSession } from "../chat/types";

/** M5a installs the protocol only. No production caller activates tracking. */
export const MEMORY_TRACKING_ENABLED = false;
export type SessionMemorySequence = { epoch: string; nextSeq: number };
export type MessageMemorySequence = { epoch: string; seq?: number };

export function memoryMessageEligible(message: ChatMessage): boolean {
  if (!message.content.trim() || message.attemptFor) return false;
  if (message.role === "user") return message.status === "sent" || message.status === "complete";
  return message.role === "assistant" && message.status === "complete" && message.confirmed === true
    && (!message.outcome || message.outcome === "success" || message.outcome === "truncated");
}

/** Called only within the chat write transaction. Birth marks prevent historical backfill. */
export function allocateMemorySequence(session: ChatSession, message: ChatMessage): ChatMessage {
  const tracking = session.memorySequence;
  if (!tracking || message.memorySequence?.epoch !== tracking.epoch || !memoryMessageEligible(message)) return message;
  if (message.memorySequence.seq !== undefined) return message;
  if (!Number.isSafeInteger(tracking.nextSeq) || tracking.nextSeq < 1 || tracking.nextSeq >= Number.MAX_SAFE_INTEGER)
    throw new Error("Memory sequence exhausted.");
  const seq = tracking.nextSeq++;
  return { ...message, memorySequence: { epoch: tracking.epoch, seq } };
}

export function memoryBirth(session: ChatSession): { memorySequence?: MessageMemorySequence } {
  return session.memorySequence ? { memorySequence: { epoch: session.memorySequence.epoch } } : {};
}
