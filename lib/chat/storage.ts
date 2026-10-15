import { browserMemoryStorage } from "../memory/instance";
import { invalidateChatSources } from "../memory/source-invalidation";
import { allocateMemorySequence, memoryBirth } from "../memory/sequence";
import { maintenanceEnabled } from "../memory/maintenance-config";
import { readExistingMemorySource } from "../memory/source-read";
import {
  type ChatMessage,
  type ChatSummary,
  type MemoryRef,
  MEMORY_REF_LIMIT,
  type ChatBackgroundSettings,
  type ChatImageAsset,
  type ChatSession,
  type ReplyBatch,
  type GlobalProfileSettings,
  type BubbleTiming,
  isValidBubbleTimingDelay,
  normalizeBubbleTiming,
  isTruncatedReason,
} from "./types";
import { splitAssistantReply } from "./reply-splitter";
import { attemptsAllow, recentAttempts } from "./proactive";
import { quoteMessage } from "./quote";
import { canReactTo, isReactionEmoji, withReaction, type ReactionSide } from "./reactions";
import { historyEligible, summaryDigest, SUMMARY_CHARACTERS } from "./summary";
import { historyFingerprint, type WorldBookActivationState } from "../worldbook-activation";
import { normalizeBackgroundBlur } from "./types";
import { acquireGenerationLock } from "./generation-lock";
import { assistantTurn, canContinueTurn, canRegenerateTurn } from "./turns";
import { isMessageSticker, stickerContent, stickerPreview, type MessageSticker } from "./sticker-message";
import { assertExclusivePersistenceScope, browserPersistenceWriteGate, runPersistenceWrite, withPersistenceWriteScope, type PersistenceWriteGate, type PersistenceWriteScope } from "../backup/persistence-write-gate";
import { canApplyTransferAction, normalizeTransferAmount, normalizeTransferNote, transferEventContent, transferMessageContent,
  type TransferAction, type TransferActor, type TransferEvent, type VirtualTransfer } from "./transfer";
import { canApplyGiftAction, giftEventContent, giftMessageContent, normalizeGiftContent, normalizeGiftIcon,
  type ChatGift, type GiftAction, type GiftActor, type GiftEvent } from "./gift";

export const CHAT_DATABASE_NAME = "veil-chat-v2";
export const CHAT_DATABASE_VERSION = 1;
const STORES = ["sessions", "messages", "chatSettings", "assets", "worldBookStates"];
const CHAT_BACKGROUND_SETTINGS_ID = "chat-background";
const GLOBAL_PROFILE_SETTINGS_ID = "global-profile-settings";
// The window the next Here & There opportunity is drawn from; the schedule lives here, so this is its only definition.
export const HERE_THERE_COMMENT_MIN_DELAY_MS = 60 * 60 * 1000;
export const HERE_THERE_COMMENT_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
function randomDelay(random: () => number) {
  const value = random();
  const unit = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0.5;
  return HERE_THERE_COMMENT_MIN_DELAY_MS + Math.floor(unit * (HERE_THERE_COMMENT_MAX_DELAY_MS - HERE_THERE_COMMENT_MIN_DELAY_MS));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The one place that builds the stored global-profile record. Every writer starts from the saved record, so a
// field it does not change is carried over (and normalised) here rather than re-spelled in each writer.
function globalProfileRecord(
  current: Partial<GlobalProfileSettings> | undefined,
  change: Partial<Pick<GlobalProfileSettings, "bubbleTiming" | "hereThereEnabled" | "nextCommentAt">> = {},
): GlobalProfileSettings {
  return { id: GLOBAL_PROFILE_SETTINGS_ID,
    bubbleTiming: change.bubbleTiming ?? normalizeBubbleTiming(current?.bubbleTiming),
    hereThereEnabled: change.hereThereEnabled ?? (current?.hereThereEnabled !== false),
    nextCommentAt: change.nextCommentAt !== undefined ? change.nextCommentAt : finiteOrNull(current?.nextCommentAt) };
}
const MAX_CHAT_IMAGE_BYTES = 25 * 1024 * 1024;

function directSessionFor(sessions: ChatSession[], characterId: string) {
  return sessions.find((session) => session.type !== "group" && session.characterId === characterId);
}

export type ChatStorageChange =
  | { domain: "session"; sessionId: string; backgroundChanged?: boolean }
  | { domain: "messages" | "worldbook-state"; sessionId: string; generationChanged?: boolean }
  | { domain: "chat-background" | "global-profile" | "asset" };
type ChangeFor<T> = ChatStorageChange | readonly ChatStorageChange[] |
  ((result: T) => ChatStorageChange | readonly ChatStorageChange[] | null) | null;

export function affectsChatSession(change: ChatStorageChange, sessionId: string) {
  return (change.domain === "session" || change.domain === "messages") && change.sessionId === sessionId;
}
export function affectsChatBackground(change: ChatStorageChange, sessionId: string) {
  return change.domain === "chat-background" ||
    (change.domain === "session" && change.sessionId === sessionId && change.backgroundChanged === true);
}

function logOpenFailure(stage: string, error: unknown) {
  const names = ["AbortError", "ConstraintError", "DataError", "InvalidAccessError", "InvalidStateError",
    "NotFoundError", "QuotaExceededError", "SecurityError", "TransactionInactiveError", "UnknownError", "VersionError"];
  const name = error instanceof Error && names.includes(error.name) ? error.name : "Error";
  // Never log the exception object/message: only a fixed stage and error name.
  console.warn(`[Chat storage] ${stage}: ${name}`);
}

function storeForUpgrade(
  db: IDBDatabase,
  transaction: IDBTransaction,
  name: string,
) {
  return db.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : db.createObjectStore(name, { keyPath: "id" });
}

function ensureCurrentSchema(db: IDBDatabase, transaction: IDBTransaction) {
  storeForUpgrade(db, transaction, "sessions");
  const messages = storeForUpgrade(db, transaction, "messages");
  messages.createIndex("sessionId", "sessionId");
  storeForUpgrade(db, transaction, "chatSettings");
  storeForUpgrade(db, transaction, "assets");
  storeForUpgrade(db, transaction, "worldBookStates");
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Chat storage could not be read or written."));
  });

// The only references to a chat image are session wallpapers and the global wallpaper setting.
async function referencedChatImageIds(tx: IDBTransaction): Promise<Set<string>> {
  const sessions: ChatSession[] = await request(tx.objectStore("sessions").getAll());
  const global: ChatBackgroundSettings | undefined = await request(
    tx.objectStore("chatSettings").get(CHAT_BACKGROUND_SETTINGS_ID));
  const ids = new Set<string>();
  for (const session of sessions) if (session.backgroundImage) ids.add(session.backgroundImage);
  if (global?.globalChatBackgroundImage) ids.add(global.globalChatBackgroundImage);
  return ids;
}

async function deleteUnusedChatImage(tx: IDBTransaction, id: string | undefined) {
  if (!id) return;
  if ((await referencedChatImageIds(tx)).has(id)) return;
  await request(tx.objectStore("assets").delete(id));
}

// An image is saved before a later transaction attaches it, so a crash, reload or failed attach in
// between leaves an unreferenced asset. This runs inside the transaction that saves the next image: the
// reference check and the delete share one transaction with every attach, so a reference cannot appear
// between them, and an attach that loses the race fails because its asset is gone. The grace period
// covers the gap between "saved" and "attached". Assets of unknown age are kept.
export const CHAT_IMAGE_ORPHAN_GRACE_MS = 60 * 60 * 1000;
async function deleteOrphanedChatImages(tx: IDBTransaction, now: number) {
  const assets: Partial<ChatImageAsset>[] = await request(tx.objectStore("assets").getAll());
  const old = assets.filter((asset) => typeof asset.id === "string" && typeof asset.createdAt === "number"
    && Number.isFinite(asset.createdAt) && now - asset.createdAt >= CHAT_IMAGE_ORPHAN_GRACE_MS);
  if (!old.length) return;
  const referenced = await referencedChatImageIds(tx);
  for (const asset of old) if (!referenced.has(asset.id!)) await request(tx.objectStore("assets").delete(asset.id!));
}

// Conversation history-derived persistence must be keyed by sessionId and
// cleared here so both Clear and Delete remove the same history scope. Keep
// container settings on the ChatSession; currently this scope is messages and
// WorldBook activation state.
async function resetConversationHistory(tx: IDBTransaction, session: ChatSession, exclusiveOwner = false) {
  const table = tx.objectStore("messages");
  const messages: ChatMessage[] = await request(table.index("sessionId").getAll(session.id));
  if (!exclusiveOwner && (session.generation || messages.some((message) => message.status === "streaming")))
    throw new Error("A reply is in progress. Stop it before clearing this conversation.");
  for (const message of messages) await request(table.delete(message.id));
  await request(tx.objectStore("worldBookStates").delete(session.id));
  // The rolling summary is made of this history's text, so it goes with it.
  const resetSession: ChatSession = { ...session, generation: undefined, summary: undefined, unreadCount: undefined, updatedAt: Date.now(), nextOrder: 1,
    ...(session.memorySequence ? { memorySequence: { epoch: crypto.randomUUID(), nextSeq: 1 } } : {}),
    lastMessageId: undefined, lastMessagePreview: "" };
  await request(tx.objectStore("sessions").put(resetSession));
  return { session: resetSession, deletedCount: messages.length };
}

async function commitWorldBookState(tx: IDBTransaction, sessionId: string, state: WorldBookActivationState) {
  const current: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
  const prefix = historyFingerprint(current);
  if (state.prefix.every((item, index) => item === prefix[index]))
    await request(tx.objectStore("worldBookStates").put({ id: sessionId,
      state: { ...state, prefix } }));
}

// The only whole-store replacement is replaceAllRows, used by restore under the exclusive backup lock.
// Hydration only repairs proven orphans; every other mutation re-reads authoritative records inside an atomic transaction.
export class ChatStorage {
  private database?: Promise<IDBDatabase>;
  private lockFactory?: IDBFactory;
  private listeners = new Set<(change: ChatStorageChange) => void>();
  private channel?: BroadcastChannel;
  private generationLocks = new Map<string, () => Promise<void>>();
  /** Conversations a chat page is showing right now (a count, so a replayed effect cannot unmark an open page). */
  private viewing = new Map<string, number>();
  constructor(private factory: () => IDBFactory = () => window.indexedDB,
    private locks: () => LockManager | undefined = () => globalThis.navigator?.locks,
    private writeGate: PersistenceWriteGate = browserPersistenceWriteGate,
    private memoryTracking: boolean | (() => boolean) = maintenanceEnabled,
    private sourceMemory?: import("../memory/storage").MemoryStorage) {}
  private tracking(): boolean { return typeof this.memoryTracking === "function" ? this.memoryTracking() : this.memoryTracking; }
  private sequence(session: ChatSession, message: ChatMessage): ChatMessage {
    return this.tracking() && session.type !== "group" ? allocateMemorySequence(session, message) : message;
  }

  /** Explicit test/future M5b activation; unavailable on the production handle in M5a. */
  activateMemoryTracking(sessionId: string, scope: PersistenceWriteScope): Promise<void> {
    if (!this.tracking()) return Promise.reject(new Error("Memory tracking is disabled."));
    return this.transaction("readwrite", async (tx) => {
      const store = tx.objectStore("sessions"), session = await request<ChatSession | undefined>(store.get(sessionId));
      if (!session || session.generation || session.type === "group") throw new Error("Memory tracking unavailable.");
      if (!session.memorySequence) await request(store.put({ ...session, memorySequence: { epoch: crypto.randomUUID(), nextSeq: 1 } }));
    }, ["sessions"], null, undefined, scope);
  }
  private async acquireSessionLock(sessionId: string, scope?: PersistenceWriteScope) {
    await this.open(scope);
    return acquireGenerationLock(this.lockFactory!, sessionId, this.locks());
  }

  private async recoverInTransaction(tx: IDBTransaction, sessionId: string) {
    const sessions = tx.objectStore("sessions"), table = tx.objectStore("messages");
    let session: ChatSession | undefined = await request(sessions.get(sessionId));
    if (!session) throw new Error("Conversation not found.");
    const messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
    let changed = false;
    const initiated = session.generation?.initiated === true;
    let dropped: ChatMessage | undefined;
    for (const message of messages) if (message.status === "streaming") {
      // A Character-initiated draft that never held text leaves nothing behind: no one asked for it.
      if (initiated && !message.content && message.id === session.generation?.draftId) {
        await request(table.delete(message.id)); dropped = message; changed = true; continue;
      }
      await request(table.put({ ...message, turnId: message.turnId ?? message.id,
        status: "error", outcome: "interrupted", failureStage: session.generation?.stage,
        error: "Generation interrupted. Retry or delete this attempt." }));
      changed = true;
    }
    if (session.generation && !session.generation.draftId && !initiated) {
      const id = crypto.randomUUID();
      const target = session.generation.targetId ? assistantTurn(messages, session.generation.targetId)[0] : undefined;
      session = await this.append(tx, session, { id, turnId: id, sessionId, role: "assistant", content: "",
        ...(target ? { attemptFor: target.turnId ?? target.id, attemptMode: session.generation.mode } : {}),
        status: "error", outcome: "interrupted", failureStage: "preparing", createdAt: Date.now(),
        order: session.nextOrder, error: "Generation interrupted. Retry or delete this attempt." });
      for (const message of messages) if (message.role === "user" && !message.requestedBy)
        await request(table.put({ ...message, requestedBy: id }));
      changed = true;
    }
    if (session.generation || changed) {
      const last = messages.find((message) => message.id === session.lastMessageId);
      const tail = dropped ? messages.filter((message) => message.id !== dropped!.id && message.role !== "system")
        .sort((a, b) => a.order - b.order).at(-1) : undefined;
      await request(sessions.put({ ...session, generation: undefined,
        ...(dropped ? { lastMessageId: tail?.id, updatedAt: tail?.createdAt ?? session.updatedAt,
          lastMessagePreview: tail ? (tail.sticker ? stickerPreview(tail.sticker) : tail.content.slice(0, 120)) || (tail.status === "error" ? "Reply failed" : "") : "" }
          : last?.status === "streaming" || !last ? { lastMessagePreview: "Generation interrupted" } : {}) }));
      changed = true;
    }
    return changed;
  }
  async recoverGeneration(sessionId: string) {
    const needsRecovery = await this.transaction("readonly", async (tx) => {
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.generation) return true;
      const messages: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
      return messages.some((message) => message.status === "streaming");
    }, ["sessions", "messages"]);
    if (!needsRecovery) return false;
    let release: (() => Promise<void>) | null;
    // Unsupported Web Locks or a lock failure must not turn ordinary reads into rejections.
    try { release = await this.acquireSessionLock(sessionId); } catch { return false; }
    if (!release) return false; // Another document owns it, even if that tab is suspended.
    try {
      return await this.transaction("readwrite", (tx) => this.recoverInTransaction(tx, sessionId), STORES,
        (changed) => changed ? { domain: "messages", sessionId, generationChanged: true } : null);
    } finally { await release(); }
  }
  async claimGeneration(sessionId: string, targetId?: string, mode: "regenerate" | "continue" | "initiate" = "regenerate") {
    const release = await this.acquireSessionLock(sessionId);
    if (!release) throw new Error("A reply is already in progress.");
    try {
      const id = crypto.randomUUID();
      await this.transaction("readwrite", async (tx) => {
        await this.recoverInTransaction(tx, sessionId);
        const sessions = tx.objectStore("sessions");
        const session: ChatSession = await request(sessions.get(sessionId));
        if (targetId) {
          const messages: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
          if (!(mode === "continue" ? canContinueTurn(messages, targetId) : canRegenerateTurn(messages, targetId)))
            throw new Error("Only the latest unconfirmed Assistant turn is eligible.");
        }
        await request(sessions.put({ ...session, generation: { id, stage: "preparing",
          ...(targetId ? { targetId, mode: mode === "initiate" ? "regenerate" : mode } : {}),
          ...(mode === "initiate" ? { initiated: true as const } : {}) } }));
      }, STORES, { domain: "messages", sessionId, generationChanged: true });
      this.generationLocks.set(id, release);
      return id;
    } catch (error) { await release(); throw error; }
  }
  generationIsCurrent(sessionId: string, id: string) {
    return this.transaction("readonly", async (tx) => {
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(sessionId));
      return session?.generation?.id === id;
    }, ["sessions"]);
  }
  async releaseGeneration(sessionId: string, id: string) {
    try {
      await this.transaction("readwrite", async (tx) => {
        const sessions = tx.objectStore("sessions");
        const session: ChatSession | undefined = await request(sessions.get(sessionId));
        if (session?.generation?.id === id) {
          await request(sessions.put({ ...session, generation: undefined }));
          return true;
        }
        return false;
      }, ["sessions"], (changed) => changed ? { domain: "messages", sessionId, generationChanged: true } : null);
    } finally {
      const release = this.generationLocks.get(id);
      this.generationLocks.delete(id);
      await release?.();
    }
  }
  async stopGeneration(sessionId: string, expectedId?: string) {
    await this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions"), table = tx.objectStore("messages");
      let session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session?.generation || (expectedId && session.generation.id !== expectedId)) return;
      if (session.generation.draftId) {
        const draft: ChatMessage | undefined = await request(table.get(session.generation.draftId));
        if (draft?.status === "streaming") await request(table.put({ ...draft, status: "cancelled",
          outcome: "stopped", failureStage: session.generation.stage, error: "Reply stopped. Retry or delete this attempt." }));
      } else {
        const id = crypto.randomUUID();
        const messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
        const target = session.generation.targetId ? assistantTurn(messages, session.generation.targetId)[0] : undefined;
        session = await this.append(tx, session, { id, turnId: id, sessionId, role: "assistant", content: "",
          ...(target ? { attemptFor: target.turnId ?? target.id, attemptMode: session.generation.mode } : {}),
          status: "cancelled", outcome: "stopped", failureStage: "preparing", createdAt: Date.now(),
          order: session.nextOrder, error: "Reply stopped. Retry or delete this attempt." });
        for (const message of messages) if (message.role === "user" && !message.requestedBy)
          await request(table.put({ ...message, requestedBy: id }));
      }
      await request(sessions.put({ ...session, generation: undefined, lastMessagePreview: "Reply stopped" }));
      return true;
    }, STORES, (changed) => changed ? { domain: "messages", sessionId, generationChanged: true } : null);
  }

  private open(scope?: PersistenceWriteScope, identify?: (cached: Promise<IDBDatabase>) => void): Promise<IDBDatabase> {
    const open = () => {
      const cached = this.openDatabase();
      // The gate returns a wrapper; recovery must identify the actual cached open.
      identify?.(cached);
      return cached;
    };
    if (this.database) return open();
    return runPersistenceWrite(this.writeGate, open, scope);
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        let rejected = false;
        const unavailable = () => { rejected = true; reject(new Error(
          "Chat storage is unavailable. Existing conversations have not been changed.")); };
        let req: IDBOpenDBRequest;
        try { this.lockFactory = this.factory(); req = this.lockFactory.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION); }
        catch (error) { logOpenFailure("open", error); unavailable(); return; }
        let stage = "open";
        req.onupgradeneeded = () => {
          if (rejected) { req.transaction?.abort(); return; }
          stage = "upgrade";
          try {
            const transaction = req.transaction;
            if (!transaction) throw new Error("Chat storage setup is unavailable.");
            ensureCurrentSchema(req.result, transaction);
          } catch (error) {
            logOpenFailure(stage, error);
            req.transaction?.abort();
          }
        };
        req.onsuccess = () => {
          if (rejected) {
            req.result.close();
            return;
          }
          const database = req.result;
          const invalidate = () => { if (this.database === opening) this.database = undefined; };
          database.onclose = invalidate;
          database.onversionchange = () => { database.close(); invalidate(); };
          resolve(req.result);
        };
        req.onerror = () => {
          logOpenFailure(stage, req.error);
          unavailable();
        };
        req.onblocked = () => {
          console.warn("[Chat storage] open-blocked");
          rejected = true;
          reject(new Error("Close other VEIL tabs to open chat storage."));
        };
      });
      this.database = opening;
      void opening.catch(() => {
        if (this.database === opening) this.database = undefined;
      });
    }
    return this.database;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => Promise<T>,
    stores: string[] = STORES,
    change: ChangeFor<T> = null,
    signal?: AbortSignal,
    outer?: PersistenceWriteScope,
  ): Promise<T> {
    if (mode !== "readwrite") return this.performTransaction(mode, run, stores, change, signal, outer);
    return outer
      ? runPersistenceWrite(this.writeGate, () => this.performTransaction(mode, run, stores, change, signal, outer), outer)
      : withPersistenceWriteScope(this.writeGate, (scope) => this.performTransaction(mode, run, stores, change, signal, scope), { signal });
  }

  private async performTransaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => Promise<T>,
    stores: string[],
    change: ChangeFor<T>,
    signal?: AbortSignal,
    scope?: PersistenceWriteScope,
  ): Promise<T> {
    signal?.throwIfAborted();
    let cachedOpening!: Promise<IDBDatabase>;
    const opening = this.open(scope, (cached) => { cachedOpening = cached; });
    const db = await opening;
    signal?.throwIfAborted();
    let tx: IDBTransaction;
    const invalid = (error: unknown) => error instanceof Error && error.name === "InvalidStateError";
    const discard = (database: IDBDatabase, cached: Promise<IDBDatabase>) => {
      if (this.database === cached) this.database = undefined;
      database.close();
    };
    try { tx = db.transaction(stores, mode); }
    catch (error) {
      if (!invalid(error)) throw error;
      discard(db, cachedOpening);
      let cachedRecovery!: Promise<IDBDatabase>;
      const recovery = this.open(scope, (cached) => { cachedRecovery = cached; }), recovered = await recovery;
      signal?.throwIfAborted();
      try { tx = recovered.transaction(stores, mode); }
      catch (retryError) {
        if (invalid(retryError)) discard(recovered, cachedRecovery);
        throw retryError;
      }
    }
    const cancel = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", cancel, { once: true });
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(
          new Error(
            "Chat storage could not be saved. Existing data has been retained.",
          ),
        );
    });
    try {
      const result = await run(tx);
      signal?.throwIfAborted();
      await done;
      if (mode === "readwrite") {
        const changes = typeof change === "function" ? change(result) : change;
        if (changes) for (const event of Array.isArray(changes) ? changes : [changes]) this.notify(event);
      }
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await done.catch(() => {});
      throw error;
    } finally { signal?.removeEventListener("abort", cancel); }
  }

  private chatBackgroundRevision = 0;
  private changes = 0;
  /** Bumped by local or cross-tab background changes; lets callers validate a snapshot without a listener. */
  backgroundRevision() { return this.chatBackgroundRevision; }
  /** Bumped by every dispatched chat change, independently of background cache invalidation. */
  changeRevision() { return this.changes; }
  private dispatch(change: ChatStorageChange) {
    this.changes++;
    if (change.domain === "chat-background" ||
        (change.domain === "session" && change.backgroundChanged === true)) this.chatBackgroundRevision++;
    // Observer failures must not turn an already committed write into a failed restore.
    this.listeners.forEach((listener) => {
      try { listener(change); } catch { /* Persistence has already succeeded. */ }
    });
  }
  // One channel per storage instance, opened on first use and kept for the page's lifetime. It both
  // publishes and receives from the moment it exists, so `backgroundRevision()` stays current for a
  // caller that validates a cached snapshot while it has no listener.
  private openChannel(): BroadcastChannel | undefined {
    if (this.channel) return this.channel;
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return undefined;
    try { this.channel = new BroadcastChannel(CHAT_DATABASE_NAME); } catch { return undefined; }
    this.channel.onmessage = this.receive;
    return this.channel;
  }
  // A received change goes to local listeners only (dispatch, never notify), so it is not re-broadcast.
  private receive = (message: MessageEvent<ChatStorageChange>) => {
    const change = message.data;
    if (!change || typeof change !== "object" || typeof change.domain !== "string") return;
    if (change.domain === "session" || change.domain === "messages" || change.domain === "worldbook-state") {
      if (typeof change.sessionId !== "string") return;
    } else if (change.domain !== "chat-background" && change.domain !== "global-profile" && change.domain !== "asset") return;
    this.dispatch(change);
  };
  // Called only after the transaction has committed.
  private notify(change: ChatStorageChange) {
    this.dispatch(change);
    try { this.openChannel()?.postMessage(change); } catch { /* A closed observer channel. */ }
  }
  subscribe(listener: (change: ChatStorageChange) => void) {
    this.openChannel(); // a window that only listens must receive too
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listSessions(scope?: PersistenceWriteScope): Promise<ChatSession[]> {
    return this.transaction("readonly", (tx) =>
      request(tx.objectStore("sessions").getAll()), STORES, null, undefined, scope,
    );
  }
  /** Read-only message count for a conversation; never recovers or writes generation state. */
  countMessages(sessionId: string, scope?: PersistenceWriteScope): Promise<number> {
    return this.transaction("readonly", (tx) =>
      request<number>(tx.objectStore("messages").index("sessionId").count(sessionId)), ["messages"], null, undefined, scope);
  }
  /** Read-only: which of these message ids still exist in the conversation. */
  existingMessageIds(sessionId: string, ids: readonly string[], scope?: PersistenceWriteScope): Promise<Set<string>> {
    return this.transaction("readonly", async (tx) => {
      const found = new Set<string>();
      for (const id of ids) {
        const row: ChatMessage | undefined = await request(tx.objectStore("messages").get(id));
        if (row?.sessionId === sessionId) found.add(id);
      }
      return found;
    }, ["messages"], null, undefined, scope);
  }

  /** Pure source authority: no orphan repair, generation lock, history filtering or writes. */
  async readMemorySources(sessionId: string, scope: PersistenceWriteScope): Promise<{ session?: ChatSession; messages: ChatMessage[] }> {
    assertExclusivePersistenceScope(this.writeGate, scope);
    return await readExistingMemorySource(this.factory(), CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION, STORES, async (tx) => ({
      session: await request<ChatSession | undefined>(tx.objectStore("sessions").get(sessionId)),
      messages: await request<ChatMessage[]>(tx.objectStore("messages").index("sessionId").getAll(sessionId)),
    })) ?? { messages: [] };
  }
  /** State evidence reads only its cited IDs, never the full History window. */
  async readStateSources(sessionId: string, ids: readonly string[], scope: PersistenceWriteScope): Promise<{ session?: ChatSession; messages: ChatMessage[] }> {
    assertExclusivePersistenceScope(this.writeGate, scope);
    return await readExistingMemorySource(this.factory(), CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION, STORES, async (tx) => {
      const session = await request<ChatSession | undefined>(tx.objectStore("sessions").get(sessionId)), messages: ChatMessage[] = [];
      for (const id of new Set(ids)) {
        const message = await request<ChatMessage | undefined>(tx.objectStore("messages").get(id));
        if (message?.sessionId === sessionId) messages.push(message);
      }
      return { session, messages };
    }) ?? { messages: [] };
  }
  async listExistingSessions(scope: PersistenceWriteScope): Promise<ChatSession[]> {
    assertExclusivePersistenceScope(this.writeGate, scope);
    return await readExistingMemorySource(this.factory(), CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION, STORES,
      (tx) => request<ChatSession[]>(tx.objectStore("sessions").getAll())) ?? [];
  }
  /**
   * Removes Characters from every group's member list. A group is never deleted, even when no member
   * remains; its `characterId` then becomes "" instead of keeping a removed Character's ID. Messages are
   * untouched (they carry no speaker, so none can be attributed to a removed member). Idempotent.
   * Resolves with the ids of the groups that changed.
   */
  removeGroupMembers(characterIds: readonly string[], scope?: PersistenceWriteScope): Promise<string[]> {
    const gone = new Set(characterIds);
    if (!gone.size) return Promise.resolve([]);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const sessions: ChatSession[] = await request(table.getAll());
      const changed: string[] = [];
      for (const session of sessions) {
        if (session.type !== "group") continue;
        const members = session.participantIds ?? [];
        if (!members.some((id) => gone.has(id)) && !gone.has(session.characterId)) continue;
        const remaining = members.filter((id) => !gone.has(id));
        const characterId = remaining.includes(session.characterId) ? session.characterId : remaining[0] ?? "";
        await request(table.put({ ...session, participantIds: remaining, characterId }));
        changed.push(session.id);
      }
      return changed;
    }, ["sessions"], (changed) => changed.map((sessionId) => ({ domain: "session" as const, sessionId })), undefined, scope);
  }
  createGroupSession(participantIds: readonly string[], title: string): Promise<ChatSession> {
    const members = [...new Set(participantIds.filter(Boolean))];
    if (members.length < 2) return Promise.reject(new Error("Choose at least two contacts."));
    const name = title.trim().slice(0, 100);
    if (!name) return Promise.reject(new Error("Group name is required."));
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession = { id: crypto.randomUUID(), characterId: members[0], type: "group",
        participantIds: members, title: name, updatedAt: 0,
        autoReplyOnKeyboardDismiss: false, streamOnline: false, nextOrder: 1 };
      await request(tx.objectStore("sessions").add(session));
      return session;
    }, STORES, (session) => ({ domain: "session", sessionId: session.id }));
  }
  openSession(characterId: string): Promise<ChatSession> {
    if (!characterId)
      return Promise.reject(new Error("Character is required."));
    let created = false;
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const sessions: ChatSession[] = await request(table.getAll());
      const direct = directSessionFor(sessions, characterId);
      if (direct) return direct;
      const session: ChatSession = {
        id: crypto.randomUUID(),
        characterId,
        updatedAt: 0,
        autoReplyOnKeyboardDismiss: false,
        streamOnline: false,
        nextOrder: 1,
      };
      await request(table.add(session));
      created = true;
      return session;
    }, STORES, (session) => created ? { domain: "session", sessionId: session.id } : null);
  }
  async readSession(
    sessionId: string,
  ): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
    const snapshot = await this.transaction("readonly", async (tx) => {
      const [session, messages]: [ChatSession | undefined, ChatMessage[]] = await Promise.all([
        request(tx.objectStore("sessions").get(sessionId)),
        request(tx.objectStore("messages").index("sessionId").getAll(sessionId)),
      ]);
      if (!session) throw new Error("Conversation not found.");
      return { session, messages: messages.sort((a, b) => a.order - b.order) };
    });
    if ((snapshot.session.generation || snapshot.messages.some((message) => message.status === "streaming")) &&
        await this.recoverGeneration(sessionId)) return this.readSession(sessionId);
    return snapshot;
  }

  /** Route hydration may overlap Foundation; only openSession creates a session. */
  async readExistingSession(characterId: string): Promise<{ session: ChatSession; messages: ChatMessage[] } | null> {
    if (!characterId) return Promise.resolve(null);
    const snapshot = await this.transaction("readonly", async (tx) => {
      const sessions: ChatSession[] = await request(tx.objectStore("sessions").getAll());
      const session = directSessionFor(sessions, characterId);
      if (!session) return null;
      const messages: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(session.id));
      return { session, messages: messages.sort((a, b) => a.order - b.order) };
    });
    if (snapshot && (snapshot.session.generation || snapshot.messages.some((message) => message.status === "streaming")))
      return this.readSession(snapshot.session.id);
    return snapshot;
  }

  /** Read-only prefetch for a first-paint seed. Active generations are left to their route owner. */
  async peekExistingSession(characterId: string): Promise<{ session: ChatSession; messages: ChatMessage[] } | null> {
    if (!characterId) return null;
    return this.transaction("readonly", async (tx) => {
      const sessions: ChatSession[] = await request(tx.objectStore("sessions").getAll());
      const session = directSessionFor(sessions, characterId);
      if (!session || session.generation) return null;
      const messages: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(session.id));
      if (messages.some((message) => message.status === "streaming")) return null;
      return { session, messages: messages.sort((a, b) => a.order - b.order) };
    }, ["sessions", "messages"]);
  }

  readWorldBookState(sessionId: string): Promise<WorldBookActivationState | null> {
    return this.transaction("readonly", async (tx) => {
      const saved: { id: string; state: WorldBookActivationState } | undefined = await request(
        tx.objectStore("worldBookStates").get(sessionId),
      );
      return saved?.state ?? null;
    }, ["worldBookStates"]);
  }

  updateSessionSettings(sessionId: string, patch: {
    streamOnline?: boolean; autoReplyOnKeyboardDismiss?: boolean; pinned?: boolean; lifeMode?: boolean;
    backgroundImage?: string | null;
    backgroundBlur?: number | null;
    customCSS?: string | null;
  }, scope?: PersistenceWriteScope): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(table.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      const next = { ...session };
      for (const key of ["streamOnline", "autoReplyOnKeyboardDismiss", "pinned"] as const)
        if (patch[key] !== undefined) {
          if (typeof patch[key] !== "boolean") throw new Error("Invalid conversation setting.");
          next[key] = patch[key];
        }
      if (patch.lifeMode !== undefined) {
        if (typeof patch.lifeMode !== "boolean") throw new Error("Invalid conversation setting.");
        if (patch.lifeMode && session.type === "group") throw new Error("Life Mode is only for direct conversations.");
        if (patch.lifeMode) next.lifeMode = true; else delete next.lifeMode;
      }
      if (patch.backgroundImage !== undefined) {
        if (patch.backgroundImage !== null) {
          if (typeof patch.backgroundImage !== "string" || !patch.backgroundImage)
            throw new Error("Invalid conversation background.");
          const asset = await request(tx.objectStore("assets").get(patch.backgroundImage));
          if (!asset) throw new Error("Conversation background image was not found.");
          next.backgroundImage = patch.backgroundImage;
        } else {
          delete next.backgroundImage;
        }
      }
      if (patch.backgroundBlur !== undefined) {
        if (patch.backgroundBlur === null) delete next.backgroundBlur;
        else {
          if (!Number.isFinite(patch.backgroundBlur) || patch.backgroundBlur < 0 || patch.backgroundBlur > 20)
            throw new Error("Invalid conversation background blur.");
          next.backgroundBlur = patch.backgroundBlur;
        }
      }
      if (patch.customCSS !== undefined) {
        if (patch.customCSS !== null && typeof patch.customCSS !== "string")
          throw new Error("Invalid conversation CSS.");
        const css = patch.customCSS?.trim();
        if (css) next.customCSS = patch.customCSS!;
        else delete next.customCSS;
      }
      await request(table.put(next));
      if (session.backgroundImage !== next.backgroundImage)
        await deleteUnusedChatImage(tx, session.backgroundImage);
    }, STORES, { domain: "session", sessionId,
      backgroundChanged: patch.backgroundImage !== undefined || patch.backgroundBlur !== undefined }, undefined, scope);
  }

  saveChatImage(blob: Blob, scope?: PersistenceWriteScope): Promise<string> {
    if (!blob.type.startsWith("image/"))
      return Promise.reject(new Error("Choose an image file."));
    if (!blob.size || blob.size > MAX_CHAT_IMAGE_BYTES)
      return Promise.reject(new Error("Chat background images must be 25 MiB or smaller."));
    return this.transaction("readwrite", async (tx) => {
      const now = Date.now();
      await deleteOrphanedChatImages(tx, now);
      const asset: ChatImageAsset = {
        id: crypto.randomUUID(),
        blob,
        createdAt: now,
      };
      await request(tx.objectStore("assets").add(asset));
      return asset.id;
    }, STORES, { domain: "asset" }, undefined, scope);
  }

  /**
   * Saves a picture and attaches it as this conversation's wallpaper under one backup shared lease, so a
   * snapshot sees both steps or neither. If the attach fails, only the picture saved here is removed, and
   * only when nothing references it; the attach error is what the caller gets.
   */
  setSessionBackgroundImage(sessionId: string, blob: Blob): Promise<string> {
    return withPersistenceWriteScope(this.writeGate, (scope) =>
      this.saveAndAttach(blob, scope, (id) => this.updateSessionSettings(sessionId, { backgroundImage: id }, scope)));
  }

  setGlobalChatBackgroundImage(blob: Blob): Promise<string> {
    return withPersistenceWriteScope(this.writeGate, (scope) =>
      this.saveAndAttach(blob, scope, (id) => this.updateGlobalChatBackground(id, scope)));
  }

  private async saveAndAttach(blob: Blob, scope: PersistenceWriteScope, attach: (id: string) => Promise<void>): Promise<string> {
    const id = await this.saveChatImage(blob, scope);
    try { await attach(id); return id; }
    catch (error) {
      // Best effort: a leftover unreferenced picture is reclaimed after the orphan grace period.
      await this.deleteChatImageIfUnused(id, scope).catch(() => {});
      throw error;
    }
  }

  readChatImage(id: string): Promise<Blob | null> {
    if (!id) return Promise.resolve(null);
    return this.transaction("readonly", async (tx) => {
      const asset: ChatImageAsset | undefined = await request(
        tx.objectStore("assets").get(id),
      );
      return asset?.blob ?? null;
    });
  }

  /** Restore only: replaces every row of every store in one transaction. Callers hold the exclusive backup lock. */
  replaceAllRows(rows: Record<"sessions" | "messages" | "chatSettings" | "assets" | "worldBookStates", readonly unknown[]>,
    scope?: PersistenceWriteScope): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      for (const name of STORES) {
        const store = tx.objectStore(name);
        await request(store.clear());
        for (const row of rows[name as keyof typeof rows]) await request(store.put(row));
      }
    }, STORES, null, undefined, scope);
  }

  deleteChatImageIfUnused(id: string, scope?: PersistenceWriteScope): Promise<void> {
    return this.transaction("readwrite", (tx) => deleteUnusedChatImage(tx, id), STORES, { domain: "asset" }, undefined, scope);
  }

  readChatBackgroundSettings(): Promise<ChatBackgroundSettings> {
    return this.transaction("readonly", async (tx) => {
      const settings: ChatBackgroundSettings | undefined = await request(
        tx.objectStore("chatSettings").get(CHAT_BACKGROUND_SETTINGS_ID),
      );
      return { ...settings, id: CHAT_BACKGROUND_SETTINGS_ID,
        blur: normalizeBackgroundBlur(settings?.blur) };
    });
  }

  readGlobalProfileSettings(): Promise<GlobalProfileSettings> {
    return this.transaction("readonly", async (tx) => {
      const saved: Partial<GlobalProfileSettings> | undefined = await request(
        tx.objectStore("chatSettings").get(GLOBAL_PROFILE_SETTINGS_ID));
      return globalProfileRecord(saved);
    }, ["chatSettings"]);
  }

  updateBubbleTiming(patch: Partial<BubbleTiming>): Promise<void> {
    const keys = Object.keys(patch);
    if (!keys.length || keys.some((key) => !["shortMs", "mediumMs", "longMs"].includes(key)
      || !isValidBubbleTimingDelay(patch[key as keyof BubbleTiming])))
      return Promise.reject(new Error("Invalid bubble timing. Use a value greater than 0 and at most 60 seconds."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      await request(table.put(globalProfileRecord(current,
        { bubbleTiming: { ...normalizeBubbleTiming(current?.bubbleTiming), ...patch } })));
    }, ["chatSettings"], { domain: "global-profile" });
  }

  async exportBubbleTiming(): Promise<string> {
    const { bubbleTiming } = await this.readGlobalProfileSettings();
    return JSON.stringify({ bubbleTiming });
  }

  async restoreBubbleTiming(serialized: string): Promise<void> {
    const value: unknown = JSON.parse(serialized);
    const timing = value && typeof value === "object" ? (value as { bubbleTiming?: unknown }).bubbleTiming : undefined;
    if (!timing || typeof timing !== "object") throw new Error("Invalid bubble timing backup.");
    const saved = timing as BubbleTiming;
    if (![saved.shortMs, saved.mediumMs, saved.longMs].every(isValidBubbleTimingDelay))
      throw new Error("Invalid bubble timing backup.");
    await this.updateBubbleTiming({ shortMs: saved.shortMs, mediumMs: saved.mediumMs, longMs: saved.longMs });
  }

  async ensureHereThereSchedule(now = Date.now(), random = Math.random): Promise<GlobalProfileSettings> {
    let scheduled = false;
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      const enabled = current?.hereThereEnabled !== false;
      const nextCommentAt = finiteOrNull(current?.nextCommentAt);
      const valid = nextCommentAt !== null;
      const saved = globalProfileRecord(current,
        { nextCommentAt: !enabled ? null : valid ? nextCommentAt : now + randomDelay(random) });
      if (!valid || !current) {
        await request(table.put(saved));
        scheduled = true;
      }
      return { ...saved, id: GLOBAL_PROFILE_SETTINGS_ID };
    }, ["chatSettings"], () => scheduled ? { domain: "global-profile" } : null);
  }

  updateHereThereEnabled(enabled: boolean, now = Date.now(), random = Math.random): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      await request(table.put(globalProfileRecord(current,
        { hereThereEnabled: enabled, nextCommentAt: enabled ? now + randomDelay(random) : null })));
    }, ["chatSettings"], { domain: "global-profile" });
  }

  claimHereThereOpportunity(now = Date.now(), random = Math.random): Promise<number | null> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      const due = finiteOrNull(current?.nextCommentAt);
      if (current?.hereThereEnabled === false || due === null || due > now) return null;
      const claimedNextCommentAt = now + randomDelay(random);
      await request(table.put(globalProfileRecord(current,
        { hereThereEnabled: true, nextCommentAt: claimedNextCommentAt })));
      return claimedNextCommentAt;
    }, ["chatSettings"], (claimed) => claimed !== null ? { domain: "global-profile" } : null);
  }

  rescheduleHereThereOpportunity(expectedNextCommentAt: number, now: number, delayMs: number): Promise<boolean> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      if (current?.hereThereEnabled === false || current?.nextCommentAt !== expectedNextCommentAt) return false;
      await request(table.put(globalProfileRecord(current,
        { hereThereEnabled: true, nextCommentAt: now + delayMs })));
      return true;
    }, ["chatSettings"], (scheduled) => scheduled ? { domain: "global-profile" } : null);
  }

  updateGlobalChatBackground(backgroundImage: string | null, scope?: PersistenceWriteScope): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      if (backgroundImage !== null) {
        if (!backgroundImage)
          throw new Error("Invalid global chat background.");
        const asset = await request(tx.objectStore("assets").get(backgroundImage));
        if (!asset) throw new Error("Global chat background image was not found.");
      }
      const current: ChatBackgroundSettings | undefined = await request(
        tx.objectStore("chatSettings").get(CHAT_BACKGROUND_SETTINGS_ID));
      const settings: ChatBackgroundSettings = {
        id: CHAT_BACKGROUND_SETTINGS_ID,
        ...(backgroundImage ? { globalChatBackgroundImage: backgroundImage } : {}),
        blur: normalizeBackgroundBlur(current?.blur),
      };
      await request(tx.objectStore("chatSettings").put(settings));
      if (current?.globalChatBackgroundImage !== settings.globalChatBackgroundImage)
        await deleteUnusedChatImage(tx, current?.globalChatBackgroundImage);
    }, STORES, { domain: "chat-background" }, undefined, scope);
  }

  updateGlobalChatBackgroundBlur(blur: number): Promise<void> {
    if (!Number.isFinite(blur) || blur < 0 || blur > 20)
      return Promise.reject(new Error("Invalid global chat background blur."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current: ChatBackgroundSettings | undefined = await request(table.get(CHAT_BACKGROUND_SETTINGS_ID));
      await request(table.put({ ...current, id: CHAT_BACKGROUND_SETTINGS_ID, blur }));
    }, STORES, { domain: "chat-background" });
  }

  async editMessage(id: string, content: string, scope?: PersistenceWriteScope): Promise<ChatMessage> {
    if (this.sourceMemory && !scope) {
      const target = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
      if (!target) throw new Error("Message not found.");
      await this.recoverGeneration(target.sessionId);
      return this.sourceMemory.withExclusive(async (owned) => {
        const view = await this.readMemorySources(target.sessionId, owned);
        if (!view.session) throw new Error("Conversation not found.");
        return invalidateChatSources(this.sourceMemory!, view.session, view.messages.filter((m) => m.id === id && m.content !== content.trim()), () => this.editMessage(id, content, owned), owned);
      });
    }
    const trimmed = content.trim();
    if (!trimmed) return Promise.reject(new Error("Message cannot be empty."));
    if (trimmed.length > 12000)
      return Promise.reject(new Error("Message is too long (maximum 12,000 characters)."));
    const owner = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
    if (owner && !scope) await this.recoverGeneration(owner.sessionId);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing) throw new Error("Message not found.");
      if (existing.recalled) throw new Error("A recalled message cannot be edited.");
      if (existing.transfer || existing.transferEvent || existing.gift || existing.giftEvent) throw new Error("Special message cards cannot be edited.");
      if (existing.sticker) throw new Error("表情包不能编辑。");
      const current: ChatSession = await request(tx.objectStore("sessions").get(existing.sessionId));
      if (current.generation) throw new Error("A reply is in progress. Stop it before editing this conversation.");
      if (existing.status === "streaming")
        throw new Error("A reply in progress cannot be edited.");
      const next = { ...existing, content: trimmed };
      await request(table.put(next));
      const sessions = tx.objectStore("sessions");
      const session: ChatSession = await request(sessions.get(existing.sessionId));
      // A summary that covers the edited message would keep the old text, so it is discarded and rebuilt later.
      const staleSummary = !!session.summary && existing.content !== trimmed && existing.order <= session.summary.throughOrder;
      if (session.lastMessageId === id || staleSummary)
        await request(sessions.put({ ...session, ...(session.lastMessageId === id ? { updatedAt: Date.now(), lastMessagePreview: trimmed.slice(0, 120) } : {}),
          ...(staleSummary ? { summary: undefined } : {}) }));
      return next;
    }, STORES, (message) => ({ domain: "messages", sessionId: message.sessionId }), undefined, scope);
  }

  /** Sets or clears one side's reaction. Touches only the message row: no summary, preview, Memory or generation state. */
  async setReaction(id: string, side: ReactionSide, emoji: string | null): Promise<ChatMessage> {
    if (emoji !== null && !isReactionEmoji(emoji)) throw new Error("Reaction must be a single emoji.");
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing) throw new Error("Message not found.");
      if (!canReactTo(existing)) throw new Error("This message cannot be reacted to.");
      const reactions = withReaction(existing.reactions, side, emoji);
      if (JSON.stringify(reactions) === JSON.stringify(existing.reactions ?? null)) return existing;
      const next: ChatMessage = { ...existing };
      if (reactions) next.reactions = reactions; else delete next.reactions;
      await request(table.put(next));
      return next;
    }, ["messages"], (message) => ({ domain: "messages", sessionId: message.sessionId }));
  }

  async recallMessage(id: string, by: "user" | "assistant", scope?: PersistenceWriteScope): Promise<ChatMessage> {
    if (this.sourceMemory && !scope) {
      const target = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
      if (!target) throw new Error("Message not found.");
      await this.recoverGeneration(target.sessionId);
      return this.sourceMemory.withExclusive(async (owned) => {
        const view = await this.readMemorySources(target.sessionId, owned);
        if (!view.session) throw new Error("Conversation not found.");
        const affected = view.messages.filter((message) => message.id === id && !message.recalled);
        return invalidateChatSources(this.sourceMemory!, view.session, affected, () => this.recallMessage(id, by, owned), owned);
      });
    }
    const owner = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
    if (owner && !scope) await this.recoverGeneration(owner.sessionId);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const message: ChatMessage | undefined = await request(table.get(id));
      if (!message) throw new Error("Message not found.");
      if (message.role !== by || (by === "user" ? message.status !== "sent" : message.status !== "complete"))
        throw new Error("Only your own sent message can be recalled.");
      if (message.transfer || message.transferEvent || message.gift || message.giftEvent) throw new Error("Special message cards cannot be recalled; update or delete the card instead.");
      if (message.recalled) return message;
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(message.sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.generation) throw new Error("A reply is in progress. Stop it before recalling a message.");
      const next: ChatMessage = { ...message, content: "", recalled: { at: Date.now(), by },
        ...(message.memorySequence ? { memorySequence: { epoch: message.memorySequence.epoch } } : {}) };
      await request(table.put(next));
      const all: ChatMessage[] = await request(table.index("sessionId").getAll(message.sessionId));
      for (const quoted of all) if (quoted.quote?.messageId === id && quoted.quote.preview !== "This message has been recalled.")
        await request(table.put({ ...quoted, quote: { ...quoted.quote, preview: "This message has been recalled." } }));
      const staleSummary = !!session.summary && message.order <= session.summary.throughOrder;
      if (session.lastMessageId === id || staleSummary)
        await request(tx.objectStore("sessions").put({ ...session,
          ...(session.lastMessageId === id ? { updatedAt: Date.now(), lastMessagePreview: message.role === "user"
            ? "You recalled a message." : "Character recalled a message." } : {}),
          ...(staleSummary ? { summary: undefined } : {}) }));
      return next;
    }, STORES, (message) => ({ domain: "messages", sessionId: message.sessionId }), undefined, scope);
  }

  async recallPreviousAssistantMessage(replyId: string): Promise<ChatMessage | null> {
    const reply = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(replyId)));
    if (!reply || reply.role !== "assistant") return null;
    const { messages } = await this.readSession(reply.sessionId);
    const target = messages.filter((message) => message.role === "assistant" && message.status === "complete" &&
      !message.recalled && message.order < reply.order)
      .sort((a, b) => b.order - a.order)[0];
    if (!target) return null;
    return this.recallMessage(target.id, "assistant");
  }

  async regenerationSessionId(id: string): Promise<string> {
    const target = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
    if (target) await this.recoverGeneration(target.sessionId);
    return this.transaction("readonly", async (tx) => {
      const message: ChatMessage | undefined = await request(tx.objectStore("messages").get(id));
      if (!message || message.role !== "assistant")
        throw new Error("Only Assistant turns can be regenerated.");
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(message.sessionId));
      if (!session) throw new Error("Conversation not found.");
      const all: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(message.sessionId));
      if (session.generation || all.some((item) => item.status === "streaming"))
        throw new Error("A reply is already in progress.");
      if (!canRegenerateTurn(all, id)) throw new Error("Only the latest unconfirmed Assistant turn can be regenerated.");
      return session.id;
    });
  }

  async deleteMessages(sessionId: string, ids: readonly string[], scope?: PersistenceWriteScope): Promise<number> {
    if (this.sourceMemory && !scope) {
      await this.recoverGeneration(sessionId);
      return this.sourceMemory.withExclusive(async (owned) => {
        const view = await this.readMemorySources(sessionId, owned);
        if (!view.session) throw new Error("Conversation not found.");
        const selected = new Set(ids);
        const relatedIds = new Set(view.messages.filter((m) => selected.has(m.id) && (m.transfer || m.gift)).map((m) => m.id));
        const expanded = new Set([...selected, ...view.messages.filter((m) =>
          (m.transferEvent && relatedIds.has(m.transferEvent.transferId)) || (m.giftEvent && relatedIds.has(m.giftEvent.giftId))).map((m) => m.id)]);
        const targets = view.messages.filter((m) => expanded.has(m.id));
        return invalidateChatSources(this.sourceMemory!, view.session, targets, () => this.deleteMessages(sessionId, [...expanded], owned), owned);
      });
    }
    const targets = new Set(ids);
    if (!targets.size) return Promise.resolve(0);
    if (!scope) await this.recoverGeneration(sessionId);
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.generation) throw new Error("A reply is in progress. Stop it before deleting messages.");
      const table = tx.objectStore("messages");
      const all: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
      if (this.tracking()) all.sort((a, b) => a.order - b.order);
      const selectedRelatedIds = new Set(all.filter((message) => targets.has(message.id) && (message.transfer || message.gift)).map((message) => message.id));
      for (const message of all) if ((message.transferEvent && selectedRelatedIds.has(message.transferEvent.transferId)) ||
          (message.giftEvent && selectedRelatedIds.has(message.giftEvent.giftId))) targets.add(message.id);
      const latestUserOrder = Math.max(0, ...all.filter((m) => m.role === "user").map((m) => m.order));
      const previousNextSeq = session.memorySequence?.nextSeq;
      for (const message of all) if (message.role === "assistant" && message.order < latestUserOrder && !message.confirmed) {
        message.confirmed = true;
        const sequenced = this.sequence(session, message);
        Object.assign(message, sequenced);
        await request(table.put(sequenced));
      }
      const deleting = all.filter((message) => targets.has(message.id));
      if (deleting.some((message) => message.status === "streaming"))
        throw new Error("A reply in progress cannot be deleted.");
      if (!deleting.length) {
        if (session.memorySequence?.nextSeq !== previousNextSeq) await request(sessions.put(session));
        return 0;
      }
      const deletedIds = new Set(deleting.map((message) => message.id));
      for (const message of deleting) await request(table.delete(message.id));
      const remaining = all.filter((message) => !deletedIds.has(message.id))
        .sort((a, b) => a.order - b.order);
      for (let index = 0; index < remaining.length; index++) {
        const message = remaining[index];
        const requestedByDeleted = !!message.requestedBy && deletedIds.has(message.requestedBy);
        const next: ChatMessage = { ...message, order: index + 1,
          ...(requestedByDeleted ? { status: "complete", requestedBy: undefined } : {}) };
        if (next.order !== message.order || requestedByDeleted)
          await request(table.put(next));
        remaining[index] = next;
      }
      const last = remaining.findLast((message) => message.role !== "system");
      // Deleting anything the summary covers would leave its text behind, so the summary goes too.
      const staleSummary = !!session.summary && deleting.some((message) => message.order <= session.summary!.throughOrder);
      await request(sessions.put({ ...session, updatedAt: Date.now(),
        nextOrder: remaining.length + 1, lastMessageId: last?.id,
        lastMessagePreview: last ? (last.sticker ? stickerPreview(last.sticker) : last.content.slice(0, 120)) : "", ...(staleSummary ? { summary: undefined } : {}) }));
      return deleting.length;
    }, STORES, (count) => count ? { domain: "messages", sessionId } : null, undefined, scope);
  }

  /**
   * Writes or (with `next === null`) discards the rolling summary, only if the stored one is still the one the caller
   * planned from and the covered messages still hash to `next.digest`. Does not touch `updatedAt`, so a background
   * summary never reorders the chat list. Returns false, without writing, when anything changed meanwhile.
   */
  async commitSummary(sessionId: string, expectedDigest: string | undefined, next: ChatSummary | null, scope: PersistenceWriteScope): Promise<boolean> {
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session || session.type === "group" || session.generation || session.summary?.digest !== expectedDigest) return false;
      if (next) {
        const messages: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
        const covered = historyEligible(messages).filter((message) => message.order <= next.throughOrder);
        if (!next.text.trim() || next.text.length > SUMMARY_CHARACTERS || !Number.isSafeInteger(next.throughOrder)
          || next.throughOrder <= (session.summary?.throughOrder ?? 0) || summaryDigest(covered) !== next.digest) return false;
      } else if (!session.summary) return false;
      const row: ChatSession = { ...session };
      if (next) row.summary = next; else delete row.summary;
      await request(sessions.put(row));
      return true;
    }, STORES, (written) => written ? { domain: "session", sessionId } : null, undefined, scope);
  }

  async clearSession(sessionId: string, scope?: PersistenceWriteScope): Promise<number> {
    return this.resetSessionHistory(sessionId, false, scope);
  }

  async deleteSession(sessionId: string, scope?: PersistenceWriteScope): Promise<void> {
    await this.resetSessionHistory(sessionId, true, scope);
  }

  private async resetSessionHistory(sessionId: string, deleting: boolean, scope?: PersistenceWriteScope): Promise<number> {
    // Explicit whole-conversation deletion need not first allocate a recovered
    // error marker (which could fail at quota). The lock proves no live owner.
    const manager = this.locks();
    const release = manager || typeof window === "undefined" ? await this.acquireSessionLock(sessionId, scope) : undefined;
    if (release === null) throw new Error("A reply is in progress. Stop it before clearing this conversation.");
    try { return await this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      const { session: resetSession, deletedCount } = await resetConversationHistory(tx, session, !!release);
      if (deleting) {
        await request(sessions.delete(resetSession.id));
        await deleteUnusedChatImage(tx, session.backgroundImage);
      }
      return deletedCount;
    }, STORES, [{ domain: deleting ? "session" : "messages", sessionId }, { domain: "worldbook-state", sessionId }], undefined, scope);
    } finally { await release?.(); }
  }

  private async append(
    tx: IDBTransaction,
    session: ChatSession,
    message: ChatMessage,
  ) {
    await request(tx.objectStore("messages").add(message));
    const next = {
      ...session,
      nextOrder: message.order + 1,
      updatedAt: message.createdAt,
      lastMessageId: message.id,
      lastMessagePreview: message.sticker ? stickerPreview(message.sticker) : message.content.slice(0, 120) || "Replying…",
    };
    await request(tx.objectStore("sessions").put(next));
    return next;
  }
  /** Inserts a Character action card before the reply turn that carried the action, keeping its visual position stable. */
  private async appendBeforeReply(tx: IDBTransaction, session: ChatSession, message: ChatMessage, replyMessageId: string) {
    const table = tx.objectStore("messages");
    const reply: ChatMessage | undefined = await request(table.get(replyMessageId));
    if (!reply || reply.sessionId !== session.id || reply.role !== "assistant") return this.append(tx, session, this.sequence(session, message));
    const turnId = reply.turnId ?? reply.id;
    const all: ChatMessage[] = await request(table.index("sessionId").getAll(session.id));
    const turn = all.filter((item) => item.role === "assistant" && (item.turnId ?? item.id) === turnId);
    const order = Math.min(...turn.map((item) => item.order));
    for (const item of all.filter((item) => item.order >= order).sort((a, b) => b.order - a.order))
      await request(table.put({ ...item, order: item.order + 1 }));
    const sequenced = this.sequence(session, { ...message, order });
    await request(table.add(sequenced));
    await request(tx.objectStore("sessions").put({ ...session, nextOrder: session.nextOrder + 1 }));
    return { session, message: sequenced };
  }
  /**
   * Adds a grey system event (role "system", display only) to the Character's existing conversation, or does nothing
   * when it has none. It is not a chat turn: the conversation's order, preview and update time stay as they were.
   */
  async appendSystemEvent(characterId: string, content: string, at = Date.now()): Promise<ChatMessage | null> {
    const text = content.trim().slice(0, 300);
    if (!characterId || !text) return null;
    return this.transaction("readwrite", async (tx) => {
      const sessions: ChatSession[] = await request(tx.objectStore("sessions").getAll());
      const session = directSessionFor(sessions, characterId);
      if (!session) return null;
      const message: ChatMessage = { id: crypto.randomUUID(), sessionId: session.id, role: "system", content: text,
        status: "complete", createdAt: at, order: session.nextOrder };
      await request(tx.objectStore("messages").add(message));
      await request(tx.objectStore("sessions").put({ ...session, nextOrder: message.order + 1 }));
      return message;
    }, STORES, (message) => message ? { domain: "messages", sessionId: message.sessionId } : null);
  }
  /** A sticker from the user: saved like a sent message (no reply is requested); `content` is its semantic text. */
  sendSticker(sessionId: string, sticker: MessageSticker, quoteMessageId?: string, interject = false): Promise<ChatMessage> {
    if (!isMessageSticker(sticker)) return Promise.reject(new Error("这个表情包不可用。"));
    return this.send(sessionId, stickerContent("user", sticker), quoteMessageId, undefined, sticker, interject);
  }
  async createTransfer(sessionId: string, amountValue: number, noteValue: string, sender: TransferActor): Promise<ChatMessage> {
    const amount = normalizeTransferAmount(amountValue), note = normalizeTransferNote(noteValue), id = crypto.randomUUID();
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions"), session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.type === "group") throw new Error("Virtual transfers are available in direct conversations only.");
      if (session.generation) throw new Error("Wait until the current reply finishes before sending a transfer.");
      if (typeof this.memoryTracking === "function" && this.tracking() && !session.memorySequence)
        session.memorySequence = { epoch: crypto.randomUUID(), nextSeq: 1 };
      const transfer: VirtualTransfer = { amount, note, sender, recipient: sender === "user" ? "assistant" : "user", status: "pending" };
      const message: ChatMessage = { id, sessionId, role: sender, content: transferMessageContent(transfer, id, "Character"),
        status: sender === "user" ? "sent" : "complete", createdAt: Date.now(), order: session.nextOrder,
        ...(this.tracking() ? memoryBirth(session) : {}), transfer };
      await this.append(tx, session, this.sequence(session, message));
      return message;
    }, STORES, { domain: "messages", sessionId });
  }
  async createTransferForReply(replyMessageId: string, amount: number, note: string): Promise<ChatMessage> {
    const reply = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(replyMessageId)), ["messages"]);
    if (!reply || reply.role !== "assistant") throw new Error("Transfer action has no committed reply.");
    const cleanAmount = normalizeTransferAmount(amount), cleanNote = normalizeTransferNote(note), id = crypto.randomUUID();
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(reply.sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.type === "group") throw new Error("Virtual transfers are available in direct conversations only.");
      if (this.tracking() && !session.memorySequence) session.memorySequence = { epoch: crypto.randomUUID(), nextSeq: 1 };
      const transfer: VirtualTransfer = { amount: cleanAmount, note: cleanNote, sender: "assistant", recipient: "user", status: "pending" };
      const message: ChatMessage = { id, sessionId: session.id, role: "assistant", content: transferMessageContent(transfer, id, "Character"),
        status: "complete", createdAt: Date.now(), order: session.nextOrder, transfer };
      const placed = await this.appendBeforeReply(tx, session, message, replyMessageId);
      return "message" in placed ? placed.message : message;
    }, STORES, { domain: "messages", sessionId: reply.sessionId });
  }
  async actOnTransferForCharacter(characterId: string, id: string, action: TransferAction, replyMessageId?: string): Promise<void> {
    const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
    if (!target) throw new Error("Transfer was not found.");
    const session = await this.readSession(target.sessionId);
    if (session.session.type === "group" || session.session.characterId !== characterId) throw new Error("Transfer is outside this Character's conversation.");
    await this.actOnTransfer(id, "assistant", action, undefined, replyMessageId);
  }
  async actOnTransfer(id: string, actor: TransferActor, action: TransferAction, scope?: PersistenceWriteScope, replyMessageId?: string): Promise<{ message: ChatMessage; event: ChatMessage }> {
    if (this.sourceMemory && !scope) {
      const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
      if (!target) throw new Error("Transfer was not found.");
      const view = await this.readSession(target.sessionId);
      await this.recoverGeneration(view.session.id);
      return this.sourceMemory.withExclusive(async (owned) => {
        const snapshot = await this.readSession(view.session.id);
        const previous = snapshot.messages.filter((item) => item.id === id || item.transferEvent?.transferId === id);
        return invalidateChatSources(this.sourceMemory!, snapshot.session, previous,
          () => this.actOnTransfer(id, actor, action, owned, replyMessageId), owned);
      });
    }
    if (scope) this.sourceMemory?.assertExclusive(scope);
    const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
    if (!target) throw new Error("Transfer was not found.");
    const view = await this.readSession(target.sessionId);
    await this.recoverGeneration(view.session.id);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages"), sessions = tx.objectStore("sessions");
      const original: ChatMessage | undefined = await request(table.get(id));
      if (!original?.transfer) throw new Error("Transfer was not found.");
      if (!canApplyTransferAction(original.transfer, actor, action)) throw new Error("This transfer action is not available.");
      const nextStatus: VirtualTransfer["status"] = action === "receive" ? "received" : action === "decline" ? "declined" : "returned";
      const transfer = { ...original.transfer, status: nextStatus };
      const next: ChatMessage = { ...original, transfer, content: transferMessageContent(transfer, original.id, "Character") };
      const eventData: TransferEvent = { transferId: id, action, actor, amount: transfer.amount, note: transfer.note };
      const session: ChatSession | undefined = await request(sessions.get(original.sessionId));
      if (!session) throw new Error("Conversation not found.");
      const event: ChatMessage = { id: crypto.randomUUID(), sessionId: original.sessionId, role: actor,
        content: transferEventContent(eventData, "Character"), status: actor === "user" ? "sent" : "complete",
        createdAt: Date.now(), order: session.nextOrder, transferEvent: eventData };
      await request(table.put(next));
      const placed = replyMessageId ? await this.appendBeforeReply(tx, session, event, replyMessageId) : await this.append(tx, session, this.sequence(session, event));
      const sequenced = "message" in placed ? placed.message : event;
      return { message: next, event: sequenced };
    }, STORES, { domain: "messages", sessionId: view.session.id }, undefined, scope);
  }
  async createGift(sessionId: string, iconValue: string, contentValue: string, sender: GiftActor): Promise<ChatMessage> {
    const icon = normalizeGiftIcon(iconValue), content = normalizeGiftContent(contentValue), id = crypto.randomUUID();
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions"), session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.type === "group") throw new Error("Gifts are available in direct conversations only.");
      if (session.generation) throw new Error("Wait until the current reply finishes before sending a gift.");
      if (typeof this.memoryTracking === "function" && this.tracking() && !session.memorySequence)
        session.memorySequence = { epoch: crypto.randomUUID(), nextSeq: 1 };
      const gift: ChatGift = { icon, content, sender, recipient: sender === "user" ? "assistant" : "user", status: "pending" };
      const message: ChatMessage = { id, sessionId, role: sender, content: giftMessageContent(gift, id),
        status: sender === "user" ? "sent" : "complete", createdAt: Date.now(), order: session.nextOrder,
        ...(this.tracking() ? memoryBirth(session) : {}), gift };
      await this.append(tx, session, this.sequence(session, message));
      return message;
    }, STORES, { domain: "messages", sessionId });
  }
  async createGiftForReply(replyMessageId: string, icon: string, content: string): Promise<ChatMessage> {
    const reply = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(replyMessageId)), ["messages"]);
    if (!reply || reply.role !== "assistant") throw new Error("Gift action has no committed reply.");
    const cleanIcon = normalizeGiftIcon(icon), cleanContent = normalizeGiftContent(content), id = crypto.randomUUID();
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(reply.sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.type === "group") throw new Error("Gifts are available in direct conversations only.");
      if (this.tracking() && !session.memorySequence) session.memorySequence = { epoch: crypto.randomUUID(), nextSeq: 1 };
      const gift: ChatGift = { icon: cleanIcon, content: cleanContent, sender: "assistant", recipient: "user", status: "pending" };
      const message: ChatMessage = { id, sessionId: session.id, role: "assistant", content: giftMessageContent(gift, id),
        status: "complete", createdAt: Date.now(), order: session.nextOrder, gift };
      const placed = await this.appendBeforeReply(tx, session, message, replyMessageId);
      return "message" in placed ? placed.message : message;
    }, STORES, { domain: "messages", sessionId: reply.sessionId });
  }
  async actOnGiftForCharacter(characterId: string, id: string, action: GiftAction, replyMessageId?: string): Promise<void> {
    const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
    if (!target) throw new Error("Gift was not found.");
    const view = await this.readSession(target.sessionId);
    if (view.session.type === "group" || view.session.characterId !== characterId) throw new Error("Gift is outside this Character's conversation.");
    await this.actOnGift(id, "assistant", action, undefined, replyMessageId);
  }
  async actOnGift(id: string, actor: GiftActor, action: GiftAction, scope?: PersistenceWriteScope, replyMessageId?: string): Promise<{ message: ChatMessage; event: ChatMessage }> {
    if (this.sourceMemory && !scope) {
      const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
      if (!target) throw new Error("Gift was not found.");
      const view = await this.readSession(target.sessionId);
      await this.recoverGeneration(view.session.id);
      return this.sourceMemory.withExclusive(async (owned) => {
        const snapshot = await this.readSession(view.session.id);
        return invalidateChatSources(this.sourceMemory!, snapshot.session, snapshot.messages.filter((item) => item.id === id || item.giftEvent?.giftId === id),
          () => this.actOnGift(id, actor, action, owned, replyMessageId), owned);
      });
    }
    if (scope) this.sourceMemory?.assertExclusive(scope);
    const target = await this.transaction("readonly", async (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)), ["messages"]);
    if (!target) throw new Error("Gift was not found.");
    const view = await this.readSession(target.sessionId);
    await this.recoverGeneration(view.session.id);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages"), original: ChatMessage | undefined = await request(table.get(id));
      if (!original?.gift) throw new Error("Gift was not found.");
      if (!canApplyGiftAction(original.gift, actor, action)) throw new Error("This gift action is not available.");
      const status: ChatGift["status"] = action === "accept" ? "accepted" : "declined";
      const gift: ChatGift = { ...original.gift, status };
      const next: ChatMessage = { ...original, gift, content: giftMessageContent(gift, original.id) };
      const data: GiftEvent = { giftId: id, action, actor, icon: gift.icon, content: gift.content };
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(original.sessionId));
      if (!session) throw new Error("Conversation not found.");
      const event: ChatMessage = { id: crypto.randomUUID(), sessionId: original.sessionId, role: actor,
        content: giftEventContent(data), status: actor === "user" ? "sent" : "complete", createdAt: Date.now(),
        order: session.nextOrder, giftEvent: data };
      await request(table.put(next));
      const placed = replyMessageId ? await this.appendBeforeReply(tx, session, event, replyMessageId) : await this.append(tx, session, this.sequence(session, event));
      const sequenced = "message" in placed ? placed.message : event;
      return { message: next, event: sequenced };
    }, STORES, { domain: "messages", sessionId: view.session.id }, undefined, scope);
  }
  /**
   * `interject` (Life Mode only): a reply still being written is given up in the same transaction that saves the message.
   * Its unfinished draft is removed and the messages it had claimed wait again, so the next reply answers all of them.
   * A reply that already finished is never touched; then this is an ordinary send.
   */
  async send(sessionId: string, content: string, quoteMessageId?: string, attemptId?: string, sticker?: MessageSticker,
    interject = false): Promise<ChatMessage> {
    if (!content.trim())
      return Promise.reject(new Error("Write a message first."));
    if (content.length > 12000)
      return Promise.reject(
        new Error("Message is too long (maximum 12,000 characters)."),
      );
    if (!attemptId) await this.recoverGeneration(sessionId);
    let superseded = false;
    return this.transaction("readwrite", async (tx) => {
      let session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      if (session.generation && session.generation.id !== attemptId) {
        if (!interject || attemptId || session.lifeMode !== true || session.type === "group")
          throw new Error("A reply is already in progress.");
        session = await this.supersedeInTransaction(tx, session);
        superseded = true;
      }
      if (attemptId && session.generation?.id !== attemptId) throw new Error("Generation attempt is no longer active.");
      // Epoch creation, new message birth and allocation are one Chat transaction. No old-message backfill.
      if (typeof this.memoryTracking === "function" && this.tracking() && session.type !== "group" && !session.memorySequence)
        session.memorySequence = { epoch: crypto.randomUUID(), nextSeq: 1 };
      const previous: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
      if (this.tracking()) previous.sort((a, b) => a.order - b.order);
      for (const message of previous) if (message.role === "assistant" && !message.confirmed)
        await request(tx.objectStore("messages").put(this.sequence(session, { ...message, confirmed: true })));
      let quote;
      if (quoteMessageId !== undefined) {
        const target: ChatMessage | undefined = await request(tx.objectStore("messages").get(quoteMessageId));
        if (!target || target.sessionId !== sessionId) throw new Error("Quoted message was not found in this conversation.");
        if (target.role === "assistant" && target.status !== "complete") throw new Error("Only completed replies can be quoted.");
        quote = quoteMessage(target);
      }
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "user",
        ...(this.tracking() && session.type !== "group" ? memoryBirth(session) : {}),
        content: content.trim(),
        status: "sent",
        createdAt: Date.now(),
        order: session.nextOrder,
        ...(quote ? { quote } : {}),
        ...(sticker ? { sticker } : {}),
      };
      const sequenced = this.sequence(session, message);
      await this.append(tx, session, sequenced);
      return sequenced;
    }, STORES, () => superseded ? { domain: "messages", sessionId, generationChanged: true } : { domain: "messages", sessionId });
  }
  /** Gives up the running reply inside a write transaction: no marker, no Retry, and claimed messages become unanswered again. */
  private async supersedeInTransaction(tx: IDBTransaction, session: ChatSession): Promise<ChatSession> {
    const draftId = session.generation?.draftId;
    if (draftId) {
      const table = tx.objectStore("messages");
      const draft: ChatMessage | undefined = await request(table.get(draftId));
      if (draft?.role === "assistant" && draft.status === "streaming") await request(table.delete(draftId));
      const messages: ChatMessage[] = await request(table.index("sessionId").getAll(session.id));
      for (const message of messages) if (message.role === "user" && message.requestedBy === draftId) {
        const unclaimed: ChatMessage = { ...message };
        delete unclaimed.requestedBy;
        await request(table.put(unclaimed));
      }
    }
    return { ...session, generation: undefined };
  }

  /**
   * `mode: "initiate"` starts a reply nobody asked for (the Character writes first). It needs a direct conversation
   * with no unanswered user message and a free proactive budget, which it spends here, in the same transaction as the draft.
   */
  async beginReply(sessionId: string, regenerateId?: string, attemptId?: string,
    mode: "regenerate" | "continue" | "initiate" = "regenerate"): Promise<ReplyBatch | null> {
    const owned = attemptId ?? await this.claimGeneration(sessionId, regenerateId, mode);
    try {
      const batch = await this.transaction("readwrite", async (tx) => {
        let session: ChatSession | undefined = await request(tx.objectStore("sessions").get(sessionId));
        if (!session) throw new Error("Conversation not found.");
        if (session.generation?.id !== owned) throw new Error("Generation attempt is no longer active.");
        const table = tx.objectStore("messages");
        let messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
        messages.sort((a, b) => a.order - b.order);
        const pending = messages.filter((m) => m.role === "user" && m.status === "sent" && !m.requestedBy);
        let target: ChatMessage[] = [];
        if (regenerateId !== undefined) {
          if (!(mode === "continue" ? canContinueTurn(messages, regenerateId) : canRegenerateTurn(messages, regenerateId)))
            throw new Error("Only the latest unconfirmed Assistant turn is eligible.");
          target = assistantTurn(messages, regenerateId);
          const targetId = target[0].turnId ?? target[0].id;
          // Only obsolete failed attempts are removed, never the original visible turn.
          for (const old of messages.filter((m) => m.attemptFor === targetId)) await request(table.delete(old.id));
          messages = messages.filter((m) => !m.attemptFor);
          if (mode === "regenerate") {
            const ids = new Set(target.map((m) => m.id));
            messages = messages.filter((m) => !ids.has(m.id));
          }
        } else if (mode === "initiate") {
          // Any user message without a reply counts, including one whose reply was deleted (that is no longer "sent").
          if (session.type === "group" || messages.some((m) => m.role === "user" && !m.requestedBy)
            || !attemptsAllow(session.proactiveAttempts, Date.now())) return null;
        } else if (!pending.length) return null;
        const id = crypto.randomUUID();
        if (regenerateId === undefined) for (const message of pending) {
          message.requestedBy = id;
          await request(table.put(message));
        }
        const assistant: ChatMessage = { id, turnId: id, attemptId: owned, sessionId, role: "assistant", content: "",
          ...(this.tracking() && session.type !== "group" ? memoryBirth(session) : {}),
          status: "streaming", createdAt: Date.now(), order: session.nextOrder,
          ...(target.length ? { attemptFor: target[0].turnId ?? target[0].id, attemptMode: mode === "initiate" ? "regenerate" : mode } : {}) };
        session = { ...session, generation: { ...session.generation, id: owned, draftId: id, stage: "preparing" },
          ...(mode === "initiate" && regenerateId === undefined
            ? { proactiveAttempts: [...recentAttempts(session.proactiveAttempts, Date.now()), Date.now()] } : {}) };
        const nextSession = await this.append(tx, session, assistant);
        return { session: nextSession, messages, pending: regenerateId === undefined ? pending : [], assistant };
      }, STORES, (result) => result ? { domain: "messages", sessionId } : null);
      if (!batch && !attemptId) await this.releaseGeneration(sessionId, owned);
      return batch;
    } catch (error) {
      if (!attemptId) await this.releaseGeneration(sessionId, owned);
      throw error;
    }
  }
  /**
   * Removes a Character-initiated draft that never received text (it stayed silent, or its request failed) and puts the
   * session's update time and preview back to what the caller read before the attempt, so nothing looks attempted. Returns false, leaving everything as is, when this attempt
   * no longer owns the session or the draft already holds text.
   */
  discardReply(sessionId: string, id: string, draftId: string,
    restore: Pick<ChatSession, "updatedAt" | "lastMessageId" | "lastMessagePreview">): Promise<boolean> {
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions"), table = tx.objectStore("messages");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (session?.generation?.id !== id || session.generation.draftId !== draftId) return false;
      const draft: ChatMessage | undefined = await request(table.get(draftId));
      if (!draft || draft.role !== "assistant" || draft.status !== "streaming" || draft.content) return false;
      await request(table.delete(draftId));
      await request(sessions.put({ ...session, generation: undefined, updatedAt: restore.updatedAt,
        lastMessageId: restore.lastMessageId, lastMessagePreview: restore.lastMessagePreview }));
      return true;
    }, STORES, (discarded) => discarded ? { domain: "messages", sessionId, generationChanged: true } : null);
  }
  /** A chat page shows this conversation until the returned release runs; entering it also clears what was unread. */
  viewSession(sessionId: string): () => void {
    this.viewing.set(sessionId, (this.viewing.get(sessionId) ?? 0) + 1);
    void this.markRead(sessionId).catch(() => { /* The count stays until the next visit; no message is touched. */ });
    let released = false;
    return () => {
      if (released) return; released = true;
      const left = (this.viewing.get(sessionId) ?? 1) - 1;
      if (left > 0) this.viewing.set(sessionId, left); else this.viewing.delete(sessionId);
    };
  }
  markRead(sessionId: string): Promise<boolean> {
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session?.unreadCount) return false;
      await request(sessions.put({ ...session, unreadCount: undefined }));
      return true;
    }, ["sessions"], (changed) => changed ? { domain: "session", sessionId } : null);
  }
  generationStage(sessionId: string, id: string, stage: NonNullable<ChatSession["generation"]>["stage"]) {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(table.get(sessionId));
      if (session?.generation?.id !== id) throw new Error("Generation attempt is no longer active.");
      await request(table.put({ ...session, generation: { ...session.generation, stage } }));
    }, ["sessions"]);
  }
  async failGeneration(sessionId: string, id: string, outcome: "failed" | "stopped", error: string) {
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions"), table = tx.objectStore("messages");
      let session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (session?.generation?.id !== id) return null;
      let draft: ChatMessage | undefined = session.generation.draftId
        ? await request(table.get(session.generation.draftId)) : undefined;
      if (!draft) {
        const draftId = crypto.randomUUID();
        draft = { id: draftId, turnId: draftId, attemptId: id, sessionId, role: "assistant", content: "", status: "streaming",
          createdAt: Date.now(), order: session.nextOrder };
        session = await this.append(tx, session, draft);
        const messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
        for (const message of messages) if (message.role === "user" && !message.requestedBy)
          await request(table.put({ ...message, requestedBy: draftId }));
      }
      const failed: ChatMessage = { ...draft, status: outcome === "stopped" ? "cancelled" : "error",
        outcome, error, failureStage: session.generation?.stage };
      await request(table.put(failed));
      await request(sessions.put({ ...session, generation: undefined, lastMessagePreview: error.slice(0, 120) }));
      return failed;
    }, STORES, (failed) => failed ? { domain: "messages", sessionId, generationChanged: true } : null);
  }
  async updateReply(id: string,
    patch: Pick<ChatMessage, "content" | "status"> & Pick<Partial<ChatMessage>, "error" | "outcome" | "finishReason" | "failureStage">,
    worldBookState?: WorldBookActivationState, attemptId?: string, signal?: AbortSignal): Promise<ChatMessage> {
    let owned: string | undefined;
    const next = await this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing || existing.role !== "assistant") throw new Error("Reply not found.");
      if (existing.status !== "streaming") return existing;
      const sessions = tx.objectStore("sessions");
      const session: ChatSession = await request(sessions.get(existing.sessionId));
      if (session.generation?.draftId !== id || (attemptId ? session.generation.id !== attemptId :
        !this.generationLocks.has(session.generation.id))) throw new Error("Generation attempt is no longer active.");
      owned = session.generation.id;
      const message = { ...existing, ...patch };
      await request(table.put(message));
      await request(sessions.put({ ...session,
        ...(patch.status !== "streaming" ? { generation: undefined } : {}),
        ...(session.lastMessageId === id ? { updatedAt: Date.now(), lastMessagePreview:
          message.content.slice(0, 120) || (message.status === "error" ? "Reply failed" : "Replying…") } : {}) }));
      if (worldBookState && message.status === "complete") await commitWorldBookState(tx, message.sessionId, worldBookState);
      return message;
    }, STORES, (message) => ({ domain: "messages", sessionId: message.sessionId,
      ...(message.status !== "streaming" ? { generationChanged: true } : {}) }), signal);
    if (!attemptId && owned && next.status !== "streaming") await this.releaseGeneration(next.sessionId, owned);
    return next;
  }
  async finalizeReply(id: string, content: string, worldBookState?: WorldBookActivationState,
    transformPart: (part: string) => string = (part) => part, attemptId?: string, finishReason?: string, signal?: AbortSignal, scope?: PersistenceWriteScope,
    memoryRefs?: MemoryRef[], sticker?: MessageSticker): Promise<ChatMessage[]> {
    if (this.sourceMemory && !scope) {
      const draft = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
      if (!draft) throw new Error("Generation attempt is no longer active.");
      let finalized = false;
      try {
        // New replies and continuations append content; they do not replace cited evidence.
        if (draft.attemptMode !== "regenerate") return await this.sourceMemory.withShared(async (owned) => {
          const result = await this.finalizeReply(id, content, worldBookState, transformPart, attemptId, finishReason, signal, owned, memoryRefs, sticker);
          finalized = true; return result;
        });
        return await this.sourceMemory.withExclusive(async (owned) => {
        const view = await this.readMemorySources(draft.sessionId, owned);
        if (!view.session) throw new Error("Conversation not found.");
        const targets = draft.attemptMode === "regenerate" && draft.attemptFor ? assistantTurn(view.messages, draft.attemptFor) : [];
        return invalidateChatSources(this.sourceMemory!, view.session, targets,
          async () => {
            const result = await this.finalizeReply(id, content, worldBookState, transformPart, attemptId, finishReason, signal, owned, memoryRefs, sticker);
            finalized = true; return result;
          }, owned);
      }, { signal }); } finally {
        // Release the generation lease only after the outer persistence lease has closed.
        if (finalized && !attemptId && draft.attemptId) await this.releaseGeneration(draft.sessionId, draft.attemptId);
      }
    }
    const parts = splitAssistantReply(content).map(transformPart).map((part) => part.trim()).filter(Boolean);
    if (!parts.length && !sticker) throw new Error("The API returned no reply text.");
    // The Character's sticker is its own last bubble, after any text.
    const entries: { content: string; sticker?: MessageSticker }[] = parts.map((content) => ({ content }));
    if (sticker) entries.push({ content: stickerContent("assistant", sticker), sticker });
    let owned: string | undefined;
    const completed = await this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages"), sessions = tx.objectStore("sessions");
      const draft: ChatMessage | undefined = await request(table.get(id));
      if (!draft || draft.status !== "streaming") throw new Error("Generation attempt is no longer active.");
      if (this.sourceMemory && draft.attemptMode === "regenerate") {
        if (!scope) throw new Error("Source replacement requires storage coordination.");
        this.sourceMemory.assertExclusive(scope);
      }
      const session: ChatSession = await request(sessions.get(draft.sessionId));
      if (session.generation?.draftId !== id || (attemptId ? session.generation.id !== attemptId :
        !this.generationLocks.has(session.generation.id))) throw new Error("Generation attempt is no longer active.");
      owned = session.generation.id;
      const all: ChatMessage[] = (await request<ChatMessage[]>(table.index("sessionId").getAll(draft.sessionId)))
        .sort((a, b) => a.order - b.order);
      const target = draft.attemptFor ? assistantTurn(all, draft.attemptFor) : [];
      if (draft.attemptFor && !(draft.attemptMode === "continue" ? canContinueTurn(all, target[0]?.id) : canRegenerateTurn(all, target[0]?.id)))
        throw new Error("The Assistant turn is no longer eligible.");
      const replacing = draft.attemptMode === "regenerate";
      const first = replacing ? target[0] : draft;
      const turnId = target[0]?.turnId ?? target[0]?.id ?? draft.turnId ?? id;
      const truncated = isTruncatedReason(finishReason);
      const outcome = truncated ? "truncated" : "success";
      const remove = new Set([draft.id, ...(replacing ? target.map((m) => m.id) : [])]);
      for (const deleting of remove) await request(table.delete(deleting));
      // A regenerated turn never inherits an old sticker; only this reply's own sticker is stored.
      const firstBase: ChatMessage = { ...first };
      delete firstBase.sticker;
      const generated: ChatMessage[] = entries.map((part, index) => ({
        ...firstBase, id: index === 0 ? first.id : crypto.randomUUID(), turnId, attemptId: owned,
        content: part.content, ...(part.sticker ? { sticker: part.sticker } : {}), status: "complete", outcome, finishReason, error: undefined,
        attemptFor: undefined, attemptMode: undefined, failureStage: undefined,
        // Each reply records only its own request; a regenerated or continued part never inherits an older one.
        memoryRefs: memoryRefs?.slice(0, MEMORY_REF_LIMIT),
        order: first.order + index,
      }));
      const remaining = all.filter((m) => !remove.has(m.id));
      if (draft.attemptMode === "continue") for (const original of target) {
        original.outcome = outcome; original.finishReason = finishReason;
        await request(table.put(original));
      }
      const ordered = [...remaining, ...generated].sort((a, b) => a.order - b.order);
      // Only changed orders are written; this never rewrites/deletes User content.
      for (let index = 0; index < ordered.length; index++) {
        const message = ordered[index];
        if (generated.includes(message) || message.order !== index + 1)
          await request(table.put({ ...message, order: index + 1 }));
        message.order = index + 1;
      }
      const last = ordered.findLast((message) => message.role !== "system") ?? ordered.at(-1)!;
      // Bubbles that land while no chat page shows this conversation are unread; a regenerated turn only replaces ones already seen.
      const unreadCount = replacing || this.viewing.has(draft.sessionId) ? session.unreadCount
        : (session.unreadCount ?? 0) + generated.length;
      await request(sessions.put({ ...session, generation: undefined, nextOrder: ordered.length + 1,
        updatedAt: Date.now(), lastMessageId: last.id, lastMessagePreview: last.sticker ? stickerPreview(last.sticker) : last.content.slice(0, 120),
        ...(unreadCount ? { unreadCount } : {}) }));
      if (worldBookState) await commitWorldBookState(tx, draft.sessionId, worldBookState);
      return generated;
    }, STORES, (messages) => [{ domain: "messages", sessionId: messages[0].sessionId, generationChanged: true },
      ...(worldBookState ? [{ domain: "worldbook-state" as const, sessionId: messages[0].sessionId }] : [])], signal, scope);
    if (!scope && !attemptId && owned) await this.releaseGeneration(completed[0].sessionId, owned);
    return completed;
  }
}
export const chatStorage = new ChatStorage(undefined, undefined, undefined, undefined, browserMemoryStorage);
