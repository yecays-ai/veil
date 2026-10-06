import type { ChatSession } from "./types";

export function sortChatSessions(sessions: readonly ChatSession[]): ChatSession[] {
  return [...sessions].sort((left, right) =>
    Number(right.pinned === true) - Number(left.pinned === true) || right.updatedAt - left.updatedAt,
  );
}
