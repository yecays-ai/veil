import type { ChatSession } from "./types";

// The Chats list as it was last read in this page's lifetime. It only fills the first frame of the next visit;
// the list is always read again, so a stale row is replaced as soon as that read finishes.
const lists = new WeakMap<object, ChatSession[]>();

export function lastSessionList(owner: object): ChatSession[] | null {
  return lists.get(owner) ?? null;
}

export function rememberSessionList(owner: object, rows: ChatSession[]) {
  lists.set(owner, rows);
}
