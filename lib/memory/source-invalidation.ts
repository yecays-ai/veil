import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import type { ChatSession, ChatMessage } from "../chat/types";
import { memorySourceHash } from "./source-hash";
import { cancelClearIntent, completeClear } from "./lifecycle";
import { cursorId, request, type MemoryStorage } from "./storage";
import type { MemoryCursor } from "./types";

/** Durable targeted intent covers same-ID edits and replacements, not just missing message IDs. */
export async function invalidateChatSources<T>(storage: MemoryStorage, session: ChatSession, messages: readonly ChatMessage[],
  operation: () => Promise<T>, scope: PersistenceWriteScope): Promise<T> {
  storage.assertExclusive(scope);
  if (messages.some((m) => m.sessionId !== session.id) || new Set(messages.map((m) => m.id)).size !== messages.length) throw new Error("Invalid source mutation authority.");
  const ids = messages.map((m) => m.id);
  if (!ids.length) return operation();
  const evidence = await Promise.all(messages.map(async (message) => ({ messageId: message.id, hash: await memorySourceHash(message) })));
  const owners = [...new Set(session.type === "group" ? session.participantIds ?? [] : [session.characterId])];
  await storage.transaction("readwrite", async (tx) => {
    for (const characterId of owners) {
      const id = cursorId(characterId, session.id), store = tx.store("cursors");
      const previous = await request<MemoryCursor | undefined>(store.get(id));
      if (previous?.clearRequestedAt !== undefined) throw new Error("Memory source cleanup is still pending. Reload before changing these messages.");
      await request(store.put({ failureCount: 0, ...previous, id, characterId, sessionId: session.id,
        clearRequestedAt: storage.now(), clearToken: crypto.randomUUID(), clearMessageIds: ids,
        sourceInvalidation: { messages: evidence }, updatedAt: storage.now() } satisfies MemoryCursor));
    }
  }, scope);
  let value: T;
  try { value = await operation(); }
  catch (error) {
    // The chat transaction aborted; withdrawal is safe. A crash instead retains the conservative intent.
    for (const characterId of owners) await cancelClearIntent(storage, characterId, session.id, scope);
    throw error;
  }
  for (const characterId of owners) await completeClear(storage, characterId, session.id, new Set(ids), scope);
  return value;
}
