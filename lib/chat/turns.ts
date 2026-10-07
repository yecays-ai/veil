import type { ChatMessage } from "./types";

/** Legacy split replies share createdAt and their first bubble's requestedBy ID. */
export function assistantTurn(messages: readonly ChatMessage[], id: string): ChatMessage[] {
  const target = messages.find((message) => message.id === id) ??
    messages.find((message) => !message.attemptFor && (message.turnId ?? message.id) === id);
  if (!target || target.role !== "assistant") return [];
  const key = target.attemptFor ?? target.turnId ?? target.id;
  const explicit = messages.filter((message) => message.role === "assistant" && !message.attemptFor &&
    (message.turnId ?? message.id) === key);
  const first = explicit[0] ?? target;
  if (first.turnId) return explicit.sort((a, b) => a.order - b.order);
  // Do not merge unrelated adjacent attempts just because they have the same millisecond.
  const ordered = [...messages].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((message) => message.id === first.id);
  let start = index, end = index;
  while (start > 0 && ordered[start - 1].role === "assistant" && !ordered[start - 1].attemptFor &&
    !ordered[start - 1].turnId && ordered[start - 1].createdAt === first.createdAt) start--;
  while (end + 1 < ordered.length && ordered[end + 1].role === "assistant" && !ordered[end + 1].attemptFor &&
    !ordered[end + 1].turnId && ordered[end + 1].createdAt === first.createdAt) end++;
  return ordered.slice(start, end + 1);
}
export function canRegenerateTurn(messages: readonly ChatMessage[], id: string) {
  const turn = assistantTurn(messages, id);
  if (!turn.length || turn.some((message) => message.status === "streaming" || message.confirmed)) return false;
  const last = turn.at(-1)!.order;
  return !messages.some((message) => message.order > last &&
    (message.role === "user" || (message.role === "assistant" && !message.attemptFor && message.status !== "streaming")));
}
export function canContinueTurn(messages: readonly ChatMessage[], id: string) {
  return canRegenerateTurn(messages, id) && assistantTurn(messages, id).some((message) => message.outcome === "truncated");
}
