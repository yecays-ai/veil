import type { ChatMessage } from "./types";

export const SEARCH_RESULT_LIMIT = 80;
export const SEARCH_SCAN_CHUNK_SIZE = 120;
export const SEARCH_TEXT_SCAN_LIMIT = 20_000;

export function isSearchVisibleMessage(message: ChatMessage): boolean {
  return !message.recalled && (message.role === "user" || message.role === "assistant") &&
    message.status !== "streaming" && !!getSearchResultText(message);
}

export function getSearchResultText(message: ChatMessage): string {
  return message.content.trim().slice(0, SEARCH_TEXT_SCAN_LIMIT);
}

export function getSearchHaystack(message: ChatMessage): string {
  return getSearchResultText(message);
}

export async function searchConversationMessages(
  messages: readonly ChatMessage[], sessionId: string, rawQuery: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const needle = rawQuery.trim().toLowerCase();
  if (!needle || signal?.aborted) return [];
  const results: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && results.length < SEARCH_RESULT_LIMIT;) {
    const stop = Math.max(-1, index - SEARCH_SCAN_CHUNK_SIZE);
    for (; index > stop && results.length < SEARCH_RESULT_LIMIT; index--) {
      if (signal?.aborted) return [];
      const message = messages[index];
      if (message.sessionId !== sessionId || !isSearchVisibleMessage(message)) continue;
      if (getSearchHaystack(message).toLowerCase().includes(needle)) results.push(message);
    }
    if (index >= 0 && results.length < SEARCH_RESULT_LIMIT) {
      await new Promise<void>((resolve) => {
        let removeAbort = () => {};
        const timer = setTimeout(() => { removeAbort(); resolve(); }, 0);
        const finish = () => {
          clearTimeout(timer);
          removeAbort();
          resolve();
        };
        signal?.addEventListener("abort", finish, { once: true });
        removeAbort = () => signal?.removeEventListener("abort", finish);
        if (signal?.aborted) finish();
      });
      if (signal?.aborted) return [];
    }
  }
  return results;
}
