import type { ChatSession } from "../chat/types";
import { cancelClearIntent, completeClear, recordClearIntent } from "./lifecycle";
import { MemoryStorage } from "./storage";

/** The app's one Memory handle. The database opens lazily on first use and is covered by full backup. */
export const browserMemoryStorage = new MemoryStorage();

/** Characters whose Memory may be sourced from this conversation: the direct Character, or each group member. */
const owners = (session: Pick<ChatSession, "characterId" | "type" | "participantIds">) =>
  [...new Set(session.type === "group" ? session.participantIds ?? [] : [session.characterId])].filter(Boolean);

/**
 * Clear or delete a conversation with Memory cleanup. The clear intent is saved first, then the chat operation
 * runs, then the cleanup completes. If the chat operation fails, the intent is withdrawn and the error rethrown
 * (nothing was cleared). If cleanup is cut short after the chat operation succeeded, the saved intent lets
 * `resumePendingClears` finish it; the user-visible operation has already succeeded and is not reported as failed.
 */
export async function withMemoryClear<T>(session: Pick<ChatSession, "id" | "characterId" | "type" | "participantIds">,
  chatOperation: () => Promise<T>, storage: MemoryStorage = browserMemoryStorage): Promise<T> {
  const characterIds = owners(session);
  let result: T;
  try {
    for (const characterId of characterIds) await recordClearIntent(storage, characterId, session.id);
    result = await chatOperation();
  }
  catch (error) {
    await Promise.allSettled(characterIds.map((characterId) => cancelClearIntent(storage, characterId, session.id)));
    throw error;
  }
  await Promise.allSettled(characterIds.map((characterId) => completeClear(storage, characterId, session.id)));
  return result;
}
