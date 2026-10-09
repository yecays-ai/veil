import {
  type ChatMessage,
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
import { quoteMessage } from "./quote";
import { historyFingerprint, type WorldBookActivationState } from "../worldbook-activation";
import { normalizeBackgroundBlur } from "./types";
import { acquireGenerationLock } from "./generation-lock";
import { assistantTurn, canContinueTurn, canRegenerateTurn } from "./turns";

export const CHAT_DATABASE_NAME = "veil-chat-v2";
export const CHAT_DATABASE_VERSION = 1;
const STORES = ["sessions", "messages", "chatSettings", "assets", "worldBookStates"];
const CHAT_BACKGROUND_SETTINGS_ID = "chat-background";
const GLOBAL_PROFILE_SETTINGS_ID = "global-profile-settings";
const COMMENT_MIN_DELAY_MS = 60 * 60 * 1000;
const COMMENT_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
function randomDelay(random: () => number) {
  const value = random();
  const unit = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0.5;
  return COMMENT_MIN_DELAY_MS + Math.floor(unit * (COMMENT_MAX_DELAY_MS - COMMENT_MIN_DELAY_MS));
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
  const resetSession: ChatSession = { ...session, generation: undefined, updatedAt: Date.now(), nextOrder: 1,
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

// No snapshot replacement/clear operation exists. Hydration only repairs proven orphans;
// every mutation re-reads authoritative records inside an atomic transaction.
export class ChatStorage {
  private database?: Promise<IDBDatabase>;
  private lockFactory?: IDBFactory;
  private listeners = new Set<(change: ChatStorageChange) => void>();
  private channel?: BroadcastChannel;
  private generationLocks = new Map<string, () => Promise<void>>();
  constructor(private factory: () => IDBFactory = () => window.indexedDB,
    private locks: () => LockManager | undefined = () => globalThis.navigator?.locks) {}
  private async acquireSessionLock(sessionId: string) {
    await this.open();
    return acquireGenerationLock(this.lockFactory!, sessionId, this.locks());
  }

  private async recoverInTransaction(tx: IDBTransaction, sessionId: string) {
    const sessions = tx.objectStore("sessions"), table = tx.objectStore("messages");
    let session: ChatSession | undefined = await request(sessions.get(sessionId));
    if (!session) throw new Error("Conversation not found.");
    const messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
    let changed = false;
    for (const message of messages) if (message.status === "streaming") {
      await request(table.put({ ...message, turnId: message.turnId ?? message.id,
        status: "error", outcome: "interrupted", failureStage: session.generation?.stage,
        error: "Generation interrupted. Retry or delete this attempt." }));
      changed = true;
    }
    if (session.generation && !session.generation.draftId) {
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
      await request(sessions.put({ ...session, generation: undefined,
        ...(last?.status === "streaming" || !last ? { lastMessagePreview: "Generation interrupted" } : {}) }));
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
  async claimGeneration(sessionId: string, targetId?: string, mode: "regenerate" | "continue" = "regenerate") {
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
          ...(targetId ? { targetId, mode } : {}) } }));
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

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const unavailable = () => reject(new Error(
          "Chat storage is unavailable. Existing conversations have not been changed."));
        let req: IDBOpenDBRequest;
        try { this.lockFactory = this.factory(); req = this.lockFactory.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION); }
        catch (error) { logOpenFailure("open", error); unavailable(); return; }
        let stage = "open";
        let blocked = false;
        req.onupgradeneeded = () => {
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
          if (blocked) {
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
          blocked = true;
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
  ): Promise<T> {
    signal?.throwIfAborted();
    const opening = this.open();
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
      discard(db, opening);
      const recovery = this.open(), recovered = await recovery;
      signal?.throwIfAborted();
      try { tx = recovered.transaction(stores, mode); }
      catch (retryError) {
        if (invalid(retryError)) discard(recovered, recovery);
        throw retryError;
      }
    }
    const cancel = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", cancel, { once: true });
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
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

  listSessions(): Promise<ChatSession[]> {
    return this.transaction("readonly", (tx) =>
      request(tx.objectStore("sessions").getAll()),
    );
  }
  /** Read-only message count for a conversation; never recovers or writes generation state. */
  countMessages(sessionId: string): Promise<number> {
    return this.transaction("readonly", (tx) =>
      request<number>(tx.objectStore("messages").index("sessionId").count(sessionId)), ["messages"]);
  }
  /**
   * Removes Characters from every group's member list. A group is never deleted, even when no member
   * remains; its `characterId` then becomes "" instead of keeping a removed Character's ID. Messages are
   * untouched (they carry no speaker, so none can be attributed to a removed member). Idempotent.
   * Resolves with the ids of the groups that changed.
   */
  removeGroupMembers(characterIds: readonly string[]): Promise<string[]> {
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
    }, ["sessions"], (changed) => changed.map((sessionId) => ({ domain: "session" as const, sessionId })));
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
    streamOnline?: boolean; autoReplyOnKeyboardDismiss?: boolean; pinned?: boolean;
    backgroundImage?: string | null;
    backgroundBlur?: number | null;
    customCSS?: string | null;
  }): Promise<void> {
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
      backgroundChanged: patch.backgroundImage !== undefined || patch.backgroundBlur !== undefined });
  }

  saveChatImage(blob: Blob): Promise<string> {
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
    }, STORES, { domain: "asset" });
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

  deleteChatImageIfUnused(id: string): Promise<void> {
    return this.transaction("readwrite", (tx) => deleteUnusedChatImage(tx, id), STORES, { domain: "asset" });
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
      return { id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: normalizeBubbleTiming(saved?.bubbleTiming),
        hereThereEnabled: saved?.hereThereEnabled !== false,
        nextCommentAt: typeof saved?.nextCommentAt === "number" && Number.isFinite(saved.nextCommentAt)
          ? saved.nextCommentAt : null };
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
      await request(table.put({ id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: { ...normalizeBubbleTiming(current?.bubbleTiming), ...patch },
        hereThereEnabled: current?.hereThereEnabled !== false,
        nextCommentAt: typeof current?.nextCommentAt === "number" && Number.isFinite(current.nextCommentAt)
          ? current.nextCommentAt : null }));
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
      const nextCommentAt = current?.nextCommentAt;
      const valid = typeof nextCommentAt === "number" && Number.isFinite(nextCommentAt);
      const next = !enabled ? null : valid ? nextCommentAt! : now + randomDelay(random);
      const saved = { id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: normalizeBubbleTiming(current?.bubbleTiming),
        hereThereEnabled: enabled, nextCommentAt: next };
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
      await request(table.put({ id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: normalizeBubbleTiming(current?.bubbleTiming),
        hereThereEnabled: enabled,
        nextCommentAt: enabled ? now + randomDelay(random) : null }));
    }, ["chatSettings"], { domain: "global-profile" });
  }

  claimHereThereOpportunity(now = Date.now(), random = Math.random): Promise<number | null> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      if (current?.hereThereEnabled === false || typeof current?.nextCommentAt !== "number"
        || !Number.isFinite(current.nextCommentAt) || current.nextCommentAt > now) return null;
      const claimedNextCommentAt = now + randomDelay(random);
      await request(table.put({ id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: normalizeBubbleTiming(current.bubbleTiming),
        hereThereEnabled: true, nextCommentAt: claimedNextCommentAt }));
      return claimedNextCommentAt;
    }, ["chatSettings"], (claimed) => claimed !== null ? { domain: "global-profile" } : null);
  }

  rescheduleHereThereOpportunity(expectedNextCommentAt: number, now: number, delayMs: number): Promise<boolean> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current = await request(table.get(GLOBAL_PROFILE_SETTINGS_ID)) as Partial<GlobalProfileSettings> | undefined;
      if (current?.hereThereEnabled === false || current?.nextCommentAt !== expectedNextCommentAt) return false;
      await request(table.put({ id: GLOBAL_PROFILE_SETTINGS_ID,
        bubbleTiming: normalizeBubbleTiming(current?.bubbleTiming),
        hereThereEnabled: true, nextCommentAt: now + delayMs }));
      return true;
    }, ["chatSettings"], (scheduled) => scheduled ? { domain: "global-profile" } : null);
  }

  updateGlobalChatBackground(backgroundImage: string | null): Promise<void> {
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
    }, STORES, { domain: "chat-background" });
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

  async editMessage(id: string, content: string): Promise<ChatMessage> {
    const trimmed = content.trim();
    if (!trimmed) return Promise.reject(new Error("Message cannot be empty."));
    if (trimmed.length > 12000)
      return Promise.reject(new Error("Message is too long (maximum 12,000 characters)."));
    const owner = await this.transaction("readonly", (tx) => request<ChatMessage | undefined>(tx.objectStore("messages").get(id)));
    if (owner) await this.recoverGeneration(owner.sessionId);
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing) throw new Error("Message not found.");
      const current: ChatSession = await request(tx.objectStore("sessions").get(existing.sessionId));
      if (current.generation) throw new Error("A reply is in progress. Stop it before editing this conversation.");
      if (existing.status === "streaming")
        throw new Error("A reply in progress cannot be edited.");
      const next = { ...existing, content: trimmed };
      await request(table.put(next));
      const sessions = tx.objectStore("sessions");
      const session: ChatSession = await request(sessions.get(existing.sessionId));
      if (session.lastMessageId === id)
        await request(sessions.put({ ...session, updatedAt: Date.now(),
          lastMessagePreview: trimmed.slice(0, 120) }));
      return next;
    }, STORES, (message) => ({ domain: "messages", sessionId: message.sessionId }));
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

  async deleteMessages(sessionId: string, ids: readonly string[]): Promise<number> {
    const targets = new Set(ids);
    if (!targets.size) return Promise.resolve(0);
    await this.recoverGeneration(sessionId);
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      if (session.generation) throw new Error("A reply is in progress. Stop it before deleting messages.");
      const table = tx.objectStore("messages");
      const all: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
      const latestUserOrder = Math.max(0, ...all.filter((m) => m.role === "user").map((m) => m.order));
      for (const message of all) if (message.role === "assistant" && message.order < latestUserOrder && !message.confirmed) {
        message.confirmed = true;
        await request(table.put(message));
      }
      const deleting = all.filter((message) => targets.has(message.id));
      if (deleting.some((message) => message.status === "streaming"))
        throw new Error("A reply in progress cannot be deleted.");
      if (!deleting.length) return 0;
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
      const last = remaining.at(-1);
      await request(sessions.put({ ...session, updatedAt: Date.now(),
        nextOrder: remaining.length + 1, lastMessageId: last?.id,
        lastMessagePreview: last?.content.slice(0, 120) || "" }));
      return deleting.length;
    }, STORES, (count) => count ? { domain: "messages", sessionId } : null);
  }

  async clearSession(sessionId: string): Promise<number> {
    return this.resetSessionHistory(sessionId, false);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.resetSessionHistory(sessionId, true);
  }

  private async resetSessionHistory(sessionId: string, deleting: boolean): Promise<number> {
    // Explicit whole-conversation deletion need not first allocate a recovered
    // error marker (which could fail at quota). The lock proves no live owner.
    const manager = this.locks();
    const release = manager || typeof window === "undefined" ? await this.acquireSessionLock(sessionId) : undefined;
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
    }, STORES, [{ domain: deleting ? "session" : "messages", sessionId }, { domain: "worldbook-state", sessionId }]);
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
      lastMessagePreview: message.content.slice(0, 120) || "Replying…",
    };
    await request(tx.objectStore("sessions").put(next));
    return next;
  }
  async send(sessionId: string, content: string, quoteMessageId?: string, attemptId?: string): Promise<ChatMessage> {
    if (!content.trim())
      return Promise.reject(new Error("Write a message first."));
    if (content.length > 12000)
      return Promise.reject(
        new Error("Message is too long (maximum 12,000 characters)."),
      );
    if (!attemptId) await this.recoverGeneration(sessionId);
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      if (session.generation && session.generation.id !== attemptId)
        throw new Error("A reply is already in progress.");
      if (attemptId && session.generation?.id !== attemptId) throw new Error("Generation attempt is no longer active.");
      const previous: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
      for (const message of previous) if (message.role === "assistant" && !message.confirmed)
        await request(tx.objectStore("messages").put({ ...message, confirmed: true }));
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
        content: content.trim(),
        status: "sent",
        createdAt: Date.now(),
        order: session.nextOrder,
        ...(quote ? { quote } : {}),
      };
      await this.append(tx, session, message);
      return message;
    }, STORES, { domain: "messages", sessionId });
  }

  async beginReply(sessionId: string, regenerateId?: string, attemptId?: string,
    mode: "regenerate" | "continue" = "regenerate"): Promise<ReplyBatch | null> {
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
        } else if (!pending.length) return null;
        const id = crypto.randomUUID();
        if (regenerateId === undefined) for (const message of pending) {
          message.requestedBy = id;
          await request(table.put(message));
        }
        const assistant: ChatMessage = { id, turnId: id, attemptId: owned, sessionId, role: "assistant", content: "",
          status: "streaming", createdAt: Date.now(), order: session.nextOrder,
          ...(target.length ? { attemptFor: target[0].turnId ?? target[0].id, attemptMode: mode } : {}) };
        session = { ...session, generation: { ...session.generation, id: owned, draftId: id, stage: "preparing" } };
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
    transformPart: (part: string) => string = (part) => part, attemptId?: string, finishReason?: string, signal?: AbortSignal): Promise<ChatMessage[]> {
    const parts = splitAssistantReply(content).map(transformPart).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error("The API returned no reply text.");
    let owned: string | undefined;
    const completed = await this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages"), sessions = tx.objectStore("sessions");
      const draft: ChatMessage | undefined = await request(table.get(id));
      if (!draft || draft.status !== "streaming") throw new Error("Generation attempt is no longer active.");
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
      const generated: ChatMessage[] = parts.map((part, index) => ({
        ...first, id: index === 0 ? first.id : crypto.randomUUID(), turnId, attemptId: owned,
        content: part, status: "complete", outcome, finishReason, error: undefined,
        attemptFor: undefined, attemptMode: undefined, failureStage: undefined,
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
      const last = ordered.at(-1)!;
      await request(sessions.put({ ...session, generation: undefined, nextOrder: ordered.length + 1,
        updatedAt: Date.now(), lastMessageId: last.id, lastMessagePreview: last.content.slice(0, 120) }));
      if (worldBookState) await commitWorldBookState(tx, draft.sessionId, worldBookState);
      return generated;
    }, STORES, (messages) => [{ domain: "messages", sessionId: messages[0].sessionId, generationChanged: true },
      ...(worldBookState ? [{ domain: "worldbook-state" as const, sessionId: messages[0].sessionId }] : [])], signal);
    if (!attemptId && owned) await this.releaseGeneration(completed[0].sessionId, owned);
    return completed;
  }
}
export const chatStorage = new ChatStorage();
