import type { ChatMessage } from "./chat/types";
import { messageHistoryContent } from "./chat/quote";
import type { WorldBook, WorldBookEntry } from "./worldbook";

export type TimedEntryState = {
  firstMatch?: number;
  stickyUntil?: number;
  cooldownUntil?: number;
};
export type WorldBookActivationState = {
  cycle: number;
  prefix: string[];
  signature?: string;
  entries: Record<string, TimedEntryState>;
};
export type ActivatedEntry = { bookId: string; entry: WorldBookEntry };
export type WorldBookActivation = {
  before: ActivatedEntry[];
  after: ActivatedEntry[];
  nextState: WorldBookActivationState;
};

// This excludes transient generation claims while retaining identity, order and
// the actual conversational text (including the quoted message snapshot).
export function realChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((message) =>
    (message.role === "user" && message.status === "sent") ||
    (message.role === "assistant" && message.status === "complete"),
  ).sort((a, b) => a.order - b.order);
}
export const historyFingerprint = (messages: readonly ChatMessage[]) =>
  realChatMessages(messages).map((message) => JSON.stringify([
    message.id, message.role, message.order, message.createdAt, messageHistoryContent(message),
  ]));

export function compatibleActivationState(state: WorldBookActivationState | null, messages: readonly ChatMessage[]): WorldBookActivationState {
  const current = historyFingerprint(messages);
  if (!state || state.prefix.length > current.length ||
      state.prefix.some((item, index) => item !== current[index]))
    return { cycle: 0, prefix: [], entries: {} };
  return state;
}

function matches(entry: WorldBookEntry, context: readonly string[]) {
  if (entry.constant) return true;
  if (!entry.keywords.length) return false;
  const haystack = context.slice(-entry.scanDepth).join("\n");
  for (const keyword of entry.keywords) {
    if (!keyword.trim()) continue;
    if (entry.matchMode === "literal") {
      if (entry.caseSensitive ? haystack.includes(keyword) : haystack.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
        return true;
    } else {
      try { if (new RegExp(keyword, entry.caseSensitive ? "u" : "iu").test(haystack)) return true; }
      catch { /* A malformed keyword cannot block unrelated entries. */ }
    }
  }
  return false;
}

export function evaluateWorldBooks(
  books: readonly WorldBook[],
  messages: readonly ChatMessage[],
  state: WorldBookActivationState | null,
): WorldBookActivation {
  const valid = compatibleActivationState(state, messages);
  const signature = JSON.stringify(books);
  const current = valid.signature === signature ? valid : { cycle: 0, prefix: [], entries: {} };
  const cycle = current.cycle + 1;
  const entries: Record<string, TimedEntryState> = structuredClone(current.entries);
  const context = realChatMessages(messages).map(messageHistoryContent);
  const candidates: (ActivatedEntry & { index: number })[] = [];
  books.forEach((book, bookOrder) => {
    if (!book.enabled) return;
    book.entries.forEach((entry, entryOrder) => {
      if (!entry.enabled || !entry.content.trim()) return;
      const key = `${book.id}:${entry.id}`;
      const previous = entries[key] ?? {};
      const matched = matches(entry, context);
      const next = { ...previous };
      if (matched) next.firstMatch ??= cycle;
      else delete next.firstMatch;
      const sticky = (previous.stickyUntil ?? 0) >= cycle;
      const delayed = matched && cycle - (next.firstMatch ?? cycle) >= entry.delay;
      const blocked = (previous.cooldownUntil ?? 0) >= cycle;
      if (sticky || (delayed && !blocked)) {
        candidates.push({ bookId: book.id, entry, index: bookOrder * 1_000_000 + entryOrder });
        if (delayed && !sticky) {
          next.stickyUntil = cycle + entry.sticky;
          next.cooldownUntil = cycle + entry.cooldown;
          delete next.firstMatch;
        }
      }
      entries[key] = next;
    });
  });
  candidates.sort((a, b) => b.entry.priority - a.entry.priority || a.index - b.index);
  const before: ActivatedEntry[] = [], after: ActivatedEntry[] = [];
  for (const { bookId, entry } of candidates) (entry.position === "before" ? before : after).push({ bookId, entry });
  return { before, after, nextState: { cycle, prefix: historyFingerprint(messages), signature, entries } };
}
