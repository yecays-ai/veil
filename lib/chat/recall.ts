import type { ChatMessage } from "./types";

export const MESSAGE_RECALL_WINDOW_MS = 120_000;

/** One shared eligibility rule for the UI and storage. Storage repeats it in the final write transaction. */
export function canRecallMessage(message: ChatMessage, by: "user" | "assistant", now: number): boolean {
  if (message.role !== by || message.recalled || !Number.isFinite(message.sentAt)) return false;
  if (by === "user" ? message.status !== "sent" : message.status !== "complete") return false;
  if (message.transfer || message.transferEvent || message.gift || message.giftEvent) return false;
  const age = now - message.sentAt!;
  return age >= 0 && age <= MESSAGE_RECALL_WINDOW_MS;
}

/** A user message nobody has asked the Character about yet. A recalled one is not a question: it reaches the model only as the recall marker in history. */
export const isPendingUserMessage = (message: ChatMessage) =>
  message.role === "user" && message.status === "sent" && !message.requestedBy && !message.recalled;
