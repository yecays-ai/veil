import { memorySourceHash } from "./source-hash";
import type { ChatSession } from "../chat/types";
import type { PersistenceWriteScope } from "../backup/persistence-write-gate";
import { chatStorage } from "../chat/storage";
import { browserDocumentStorage } from "../core-document-storage";
import { FOUNDATION_STORAGE_KEY } from "../foundation-storage";
import { normalizeFoundation } from "../foundation-types";
import { resumeStartupClears, type StartupClearDeps } from "./startup";
import { cancelClearIntent, completeClear, recordClearIntent } from "./lifecycle";
import { MemoryStorage, request } from "./storage";
import type { MemoryCursor } from "./types";

/** The app's one Memory handle. The database opens lazily on first use and is covered by full backup. */
export { browserMemoryStorage } from "./instance";
import { browserMemoryStorage } from "./instance";

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
  chatOperation: (scope: PersistenceWriteScope) => Promise<T>, storage: MemoryStorage = browserMemoryStorage): Promise<MemoryClearOutcome<T>> {
  let completed: MemoryClearOutcome<T> | undefined;
  try { return await storage.withShared(async (scope) => {
      const characterIds = owners(session), created: { characterId: string; token: string }[] = [];
      const replaced: { before: MemoryCursor; token: string }[] = [];
      let value: T;
      try {
        for (const characterId of characterIds) {
          const existing = (await storage.listCursors(characterId, scope)).find((row) => row.sessionId === session.id);
          if (existing?.sourceInvalidation && !existing.clearToken) throw new Error("Source cleanup authority is unavailable.");
          const token = await recordClearIntent(storage, characterId, session.id, scope, existing?.sourceInvalidation ? existing.clearToken : undefined);
          if (existing?.sourceInvalidation) replaced.push({ before: existing, token });
          if (existing?.clearRequestedAt === undefined) created.push({ characterId, token });
        }
        value = await chatOperation(scope);
      }
      catch (error) {
        const cancelled = await Promise.allSettled([
          ...created.map(({ characterId, token }) => cancelClearIntent(storage, characterId, session.id, scope, token)),
          ...replaced.map(({ before, token }) => storage.transaction("readwrite", async (tx) => {
            const store = tx.store("cursors"), current = await request<MemoryCursor | undefined>(store.get(before.id));
            // Restore earlier cleanup evidence only while this replacement still owns the intent.
            if (current?.clearToken === token && current.sourceInvalidation === undefined) await request(store.put(before));
          }, scope)),
        ]);
        if (cancelled.some((item) => item.status === "rejected"))
          throw new Error("The conversation was not changed, but a Memory clear marker could not be withdrawn.", { cause: error });
        throw error;
      }
      const done = await Promise.allSettled(characterIds.map((characterId) => completeClear(storage, characterId, session.id, undefined, scope)));
      completed = { value, cleanupIncomplete: done.some((item) => item.status === "rejected") };
      return completed;
  }); } catch (error) {
    // The scope collects failed children after releasing only completed/aborted transactions.
    if (completed?.cleanupIncomplete) return completed;
    throw error;
  }
}

/**
 * Existing Characters, or null when that is not proven. A read error, or a Foundation document that was never
 * saved (not bootstrapped yet), proves nothing and yields null. A saved document with an empty character list is
 * the legitimate "last Character was deleted" state and yields an empty set.
 */
export async function readAliveCharacters(scope?: PersistenceWriteScope): Promise<ReadonlySet<string> | null> {
  try {
    const raw = await browserDocumentStorage.readExisting(FOUNDATION_STORAGE_KEY, scope);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.characters) || parsed.characters.some((item: { characterId?: unknown } | null) =>
      !item || typeof item.characterId !== "string" || !item.characterId)) return null;
    return new Set(normalizeFoundation(parsed).characters.map((item) => item.characterId));
  } catch { return null; }
}

/** The one startup entry point: finish unfinished clears. Cancel it with the signal when the page goes away. */
export function resumeBrowserClears(signal?: AbortSignal) {
  const deps: StartupClearDeps = {
    aliveCharacters: readAliveCharacters,
    sessionIds: async (scope) => {
      if (!scope) throw new Error("Startup Memory cleanup requires an exclusive scope.");
      return new Set((await chatStorage.listExistingSessions(scope)).map((session) => session.id));
    },
    countMessages: (sessionId, scope) => chatStorage.countMessages(sessionId, scope),
    existingMessageIds: (sessionId, ids, scope) => chatStorage.existingMessageIds(sessionId, ids, scope),
    sourceHashes: async (sessionId, ids, scope) => {
      const view = await chatStorage.readMemorySources(sessionId, scope);
      return new Map(await Promise.all(view.messages.filter((m) => ids.includes(m.id)).map(async (m) => [m.id, await memorySourceHash(m)] as const)));
    },
  };
  return resumeStartupClears(browserMemoryStorage, deps, signal);
}
