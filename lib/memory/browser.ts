import type { ChatSession } from "../chat/types";
import { chatStorage } from "../chat/storage";
import { browserFoundationStorage } from "../foundation-storage";
import { resumeStartupClears, type StartupClearDeps } from "./startup";
import { cancelClearIntent, completeClear, recordClearIntent } from "./lifecycle";
import { MemoryStorage } from "./storage";

/** The app's one Memory handle. The database opens lazily on first use and is covered by full backup. */
export const browserMemoryStorage = new MemoryStorage();

/** Characters whose Memory may be sourced from this conversation: the direct Character, or each group member. */
const owners = (session: Pick<ChatSession, "characterId" | "type" | "participantIds">) =>
  [...new Set(session.type === "group" ? session.participantIds ?? [] : [session.characterId])].filter(Boolean);

export type MemoryClearOutcome<T> = { value: T; cleanupIncomplete: boolean };

/**
 * Clear or delete a conversation with Memory cleanup. The clear intent is saved first, then the chat operation
 * runs, then the cleanup completes. If the chat operation fails, only the intents this attempt created are
 * withdrawn (an intent from an earlier attempt is kept) and the error is rethrown. If cleanup fails after the chat
 * operation succeeded, `cleanupIncomplete` is true: the chat operation did succeed, and the saved intent stays so
 * `resumePendingClears` can finish it later.
 */
export async function withMemoryClear<T>(session: Pick<ChatSession, "id" | "characterId" | "type" | "participantIds">,
  chatOperation: () => Promise<T>, storage: MemoryStorage = browserMemoryStorage): Promise<MemoryClearOutcome<T>> {
  const characterIds = owners(session), created: string[] = [];
  let value: T;
  try {
    for (const characterId of characterIds) {
      const existing = (await storage.listCursors(characterId)).find((row) => row.sessionId === session.id);
      await recordClearIntent(storage, characterId, session.id);
      if (existing?.clearRequestedAt === undefined) created.push(characterId);
    }
    value = await chatOperation();
  }
  catch (error) {
    const cancelled = await Promise.allSettled(created.map((characterId) => cancelClearIntent(storage, characterId, session.id)));
    if (cancelled.some((item) => item.status === "rejected"))
      throw new Error("The conversation was not changed, but a Memory clear marker could not be withdrawn.", { cause: error });
    throw error;
  }
  const done = await Promise.allSettled(characterIds.map((characterId) => completeClear(storage, characterId, session.id)));
  return { value, cleanupIncomplete: done.some((item) => item.status === "rejected") };
}

/** The one startup entry point: finish unfinished clears. Cancel it with the signal when the page goes away. */
export function resumeBrowserClears(signal?: AbortSignal) {
  const deps: StartupClearDeps = {
    aliveCharacters: async () => {
      try {
        const { characters } = await browserFoundationStorage.load();
        return characters.length ? new Set(characters.map((item) => item.characterId)) : null;
      } catch { return null; }
    },
    sessionIds: async () => new Set((await chatStorage.listSessions()).map((session) => session.id)),
    countMessages: (sessionId) => chatStorage.countMessages(sessionId),
  };
  return resumeStartupClears(browserMemoryStorage, deps, signal);
}
