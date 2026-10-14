import { isAssistantBlankLinePlaceholder } from "./reply-splitter";
import type { ChatMessage, ChatSession, ChatSummary, PromptTurn } from "./types";

/** Messages the prompt sends as History. Everything older is only represented by the rolling summary. */
export const RECENT_MESSAGES = 40;
/** The stored summary is bounded; a longer model answer is rejected, never truncated into a different meaning. */
export const SUMMARY_CHARACTERS = 2000;
/**
 * A summary request starts once this many messages have left the History window without being summarized: one
 * maintenance batch (`MAINTENANCE_BATCH_SEQUENCES`) of messages. This is a budget borrowed from the existing
 * maintenance limits, not a measured optimum; tune it with a usage baseline.
 */
export const SUMMARY_TRIGGER_MESSAGES = 20;
/** One request reads at most this much message text (the same bound as one maintenance batch); the rest rolls on. */
export const SUMMARY_CHUNK_CHARACTERS = 12_000;

/** The same message set the prompt uses for History, oldest first, before the pending/recent cut. */
export function historyEligible(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.content && message.role !== "system" && (message.role !== "assistant" || message.status === "complete")
    && (message.role !== "assistant" || !isAssistantBlankLinePlaceholder(message.content)))
    .sort((a, b) => a.order - b.order);
}

/** Integrity check, not a security measure: any edit, deletion or insertion inside the covered range changes it. */
export function summaryDigest(covered: readonly Pick<ChatMessage, "id" | "content">[]): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
    }
  };
  for (const message of covered) { feed(message.id); feed("\u0000"); feed(message.content); feed("\u0001"); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${covered.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

const coveredBy = (history: readonly ChatMessage[], throughOrder: number) => history.filter((message) => message.order <= throughOrder);

/** True only while every covered message is still exactly what was summarized. */
export function validSummary(summary: ChatSummary | undefined, messages: readonly ChatMessage[]): summary is ChatSummary {
  if (!summary || !summary.text.trim() || summary.text.length > SUMMARY_CHARACTERS || !Number.isSafeInteger(summary.throughOrder) || summary.throughOrder < 1) return false;
  return summaryDigest(coveredBy(historyEligible(messages), summary.throughOrder)) === summary.digest;
}

/** Cheap pre-check from the session row alone, so wakeups never read messages when nothing could be due. */
export function summaryPossiblyDue(session: ChatSession): boolean {
  if (session.type === "group" || session.generation) return false;
  return session.nextOrder - 1 - (session.summary?.throughOrder ?? 0) - RECENT_MESSAGES >= SUMMARY_TRIGGER_MESSAGES;
}

export type SummaryPlan =
  | { kind: "none" }
  /** The stored summary no longer matches its messages: discard it, then plan again from nothing. */
  | { kind: "invalid" }
  | { kind: "due"; previous?: string; expectedDigest?: string; chunk: ChatMessage[]; throughOrder: number; digest: string };

export function planSummary(session: ChatSession, messages: readonly ChatMessage[]): SummaryPlan {
  if (session.type === "group" || session.generation) return { kind: "none" };
  const history = historyEligible(messages);
  if (session.summary && !validSummary(session.summary, messages)) return { kind: "invalid" };
  const through = session.summary?.throughOrder ?? 0;
  const uncovered = history.slice(0, Math.max(0, history.length - RECENT_MESSAGES)).filter((message) => message.order > through);
  if (uncovered.length < SUMMARY_TRIGGER_MESSAGES) return { kind: "none" };
  const chunk: ChatMessage[] = [];
  let used = 0;
  for (const message of uncovered) {
    if (chunk.length && used + message.content.length > SUMMARY_CHUNK_CHARACTERS) break;
    chunk.push(message); used += message.content.length;
  }
  const throughOrder = chunk[chunk.length - 1].order;
  return { kind: "due", previous: session.summary?.text, expectedDigest: session.summary?.digest, chunk, throughOrder,
    digest: summaryDigest(coveredBy(history, throughOrder)) };
}

/** Sent as one system turn at the head of History. The Character reads it as its own earlier recollection. */
export function summaryTurn(summary: ChatSummary): PromptTurn {
  return { role: "system", content: `[conversation-summary]\nMy own summary of this conversation before the messages below:\n${summary.text}` };
}
