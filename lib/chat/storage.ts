import {
  type ChatMessage,
  type ChatBackgroundSettings,
  type ChatImageAsset,
  type ChatSession,
  type ReplyBatch,
} from "./types";
import { splitAssistantReply } from "./reply-splitter";
import { quoteMessage } from "./quote";
import { historyFingerprint, type WorldBookActivationState } from "../worldbook-activation";
import { normalizeBackgroundBlur } from "./types";

export const CHAT_DATABASE_NAME = "veil-chat-v2";
export const CHAT_DATABASE_VERSION = 1;
const STORES = ["sessions", "messages", "chatSettings", "assets", "worldBookStates"];
const CHAT_BACKGROUND_SETTINGS_ID = "chat-background";
const MAX_CHAT_IMAGE_BYTES = 25 * 1024 * 1024;

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

async function deleteUnusedChatImage(tx: IDBTransaction, id: string | undefined) {
  if (!id) return;
  const sessions: ChatSession[] = await request(tx.objectStore("sessions").getAll());
  const global: ChatBackgroundSettings | undefined = await request(
    tx.objectStore("chatSettings").get(CHAT_BACKGROUND_SETTINGS_ID));
  if (sessions.some((session) => session.backgroundImage === id) ||
      global?.globalChatBackgroundImage === id) return;
  await request(tx.objectStore("assets").delete(id));
}

async function commitWorldBookState(tx: IDBTransaction, sessionId: string, state: WorldBookActivationState) {
  const current: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(sessionId));
  const prefix = historyFingerprint(current);
  if (state.prefix.every((item, index) => item === prefix[index]))
    await request(tx.objectStore("worldBookStates").put({ id: sessionId,
      state: { ...state, prefix } }));
}

// No snapshot replacement/clear operation exists. Hydration is read-only;
// every mutation re-reads authoritative records inside an atomic transaction.
export class ChatStorage {
  private database?: Promise<IDBDatabase>;
  private listeners = new Set<() => void>();
  private channel?: BroadcastChannel;
  constructor(private factory: () => IDBFactory = () => window.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const unavailable = () => reject(new Error(
          "Chat storage is unavailable. Existing conversations have not been changed."));
        let req: IDBOpenDBRequest;
        try { req = this.factory().open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION); }
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
          req.result.onversionchange = () => {
            req.result.close();
            this.database = undefined;
          };
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
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(stores, mode);
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
      await done;
      if (mode === "readwrite") this.notify();
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already completed/aborted. */
      }
      await done.catch(() => {});
      throw error;
    }
  }

  private notify() {
    // Observer failures must not turn an already committed write into a failed restore.
    this.listeners.forEach((listener) => {
      try { listener(); } catch { /* Persistence has already succeeded. */ }
    });
    try { this.channel?.postMessage("changed"); } catch { /* A closed observer channel. */ }
  }
  subscribe(listener: () => void) {
    if (
      !this.channel &&
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel(CHAT_DATABASE_NAME);
      this.channel.onmessage = () => this.listeners.forEach((fn) => fn());
    }
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
  createGroupSession(participantIds: readonly string[], title: string): Promise<ChatSession> {
    const members = [...new Set(participantIds.filter(Boolean))];
    if (members.length < 2) return Promise.reject(new Error("Choose at least two contacts."));
    const name = title.trim().slice(0, 100);
    if (!name) return Promise.reject(new Error("Group name is required."));
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession = { id: crypto.randomUUID(), characterId: members[0], type: "group",
        participantIds: members, title: name, updatedAt: 0, remark: null,
        autoReplyOnKeyboardDismiss: false, streamOnline: false, nextOrder: 1 };
      await request(tx.objectStore("sessions").add(session));
      return session;
    });
  }
  openSession(characterId: string): Promise<ChatSession> {
    if (!characterId)
      return Promise.reject(new Error("Character is required."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const sessions: ChatSession[] = await request(table.getAll());
      const existing = sessions.filter((session) => session.type !== "group" && session.characterId === characterId);
      const direct = existing[0];
      if (direct) return direct;
      const session: ChatSession = {
        id: crypto.randomUUID(),
        characterId,
        updatedAt: 0,
        remark: null,
        autoReplyOnKeyboardDismiss: false,
        streamOnline: false,
        nextOrder: 1,
      };
      await request(table.add(session));
      return session;
    });
  }
  readSession(
    sessionId: string,
  ): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
    return this.transaction("readonly", async (tx) => {
      const session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      const messages: ChatMessage[] = await request(
        tx.objectStore("messages").index("sessionId").getAll(sessionId),
      );
      return { session, messages: messages.sort((a, b) => a.order - b.order) };
    });
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
    });
  }

  saveChatImage(blob: Blob): Promise<string> {
    if (!blob.type.startsWith("image/"))
      return Promise.reject(new Error("Choose an image file."));
    if (!blob.size || blob.size > MAX_CHAT_IMAGE_BYTES)
      return Promise.reject(new Error("Chat background images must be 25 MiB or smaller."));
    return this.transaction("readwrite", async (tx) => {
      const asset: ChatImageAsset = {
        id: crypto.randomUUID(),
        blob,
        createdAt: Date.now(),
      };
      await request(tx.objectStore("assets").add(asset));
      return asset.id;
    });
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
    return this.transaction("readwrite", (tx) => deleteUnusedChatImage(tx, id));
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
    });
  }

  updateGlobalChatBackgroundBlur(blur: number): Promise<void> {
    if (!Number.isFinite(blur) || blur < 0 || blur > 20)
      return Promise.reject(new Error("Invalid global chat background blur."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("chatSettings");
      const current: ChatBackgroundSettings | undefined = await request(table.get(CHAT_BACKGROUND_SETTINGS_ID));
      await request(table.put({ ...current, id: CHAT_BACKGROUND_SETTINGS_ID, blur }));
    });
  }

  editMessage(id: string, content: string): Promise<ChatMessage> {
    const trimmed = content.trim();
    if (!trimmed) return Promise.reject(new Error("Message cannot be empty."));
    if (trimmed.length > 12000)
      return Promise.reject(new Error("Message is too long (maximum 12,000 characters)."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing) throw new Error("Message not found.");
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
    });
  }

  regenerationSessionId(id: string): Promise<string> {
    return this.transaction("readonly", async (tx) => {
      const message: ChatMessage | undefined = await request(tx.objectStore("messages").get(id));
      if (!message || message.role !== "assistant" || message.status !== "complete")
        throw new Error("Only completed Assistant messages can be regenerated.");
      const session: ChatSession | undefined = await request(tx.objectStore("sessions").get(message.sessionId));
      if (!session) throw new Error("Conversation not found.");
      const all: ChatMessage[] = await request(tx.objectStore("messages").index("sessionId").getAll(message.sessionId));
      if (all.some((item) => item.status === "streaming"))
        throw new Error("A reply is already in progress.");
      return session.id;
    });
  }

  deleteMessages(sessionId: string, ids: readonly string[]): Promise<number> {
    const targets = new Set(ids);
    if (!targets.size) return Promise.resolve(0);
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      const table = tx.objectStore("messages");
      const all: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
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
    });
  }

  clearSession(sessionId: string): Promise<number> {
    return this.transaction("readwrite", async (tx) => {
      const sessions = tx.objectStore("sessions");
      const session: ChatSession | undefined = await request(sessions.get(sessionId));
      if (!session) throw new Error("Conversation not found.");
      const table = tx.objectStore("messages");
      const messages: ChatMessage[] = await request(table.index("sessionId").getAll(sessionId));
      for (const message of messages) await request(table.delete(message.id));
      await request(tx.objectStore("worldBookStates").delete(sessionId));
      await request(sessions.put({ ...session, updatedAt: Date.now(), nextOrder: 1,
        lastMessageId: undefined, lastMessagePreview: "" }));
      return messages.length;
    });
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
  send(sessionId: string, content: string, quoteMessageId?: string): Promise<ChatMessage> {
    if (!content.trim())
      return Promise.reject(new Error("Write a message first."));
    if (content.length > 12000)
      return Promise.reject(
        new Error("Message is too long (maximum 12,000 characters)."),
      );
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      let quote;
      if (quoteMessageId !== undefined) {
        const target: ChatMessage | undefined = await request(tx.objectStore("messages").get(quoteMessageId));
        if (!target || target.sessionId !== sessionId) throw new Error("Quoted message was not found in this conversation.");
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
    });
  }

  beginReply(sessionId: string, regenerateId?: string): Promise<ReplyBatch | null> {
    return this.transaction("readwrite", async (tx) => {
      let session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      const table = tx.objectStore("messages");
      let messages: ChatMessage[] = await request(
        table.index("sessionId").getAll(sessionId),
      );
      messages.sort((a, b) => a.order - b.order);
      if (regenerateId !== undefined) {
        const target = messages.find((message) => message.id === regenerateId);
        if (!target || target.role !== "assistant" || target.status !== "complete")
          throw new Error("Only completed Assistant messages can be regenerated.");
        if (messages.some((message) => message.status === "streaming"))
          throw new Error("A reply is already in progress.");
        const deleting = messages.filter((message) => message.order >= target.order);
        const deletedIds = new Set(deleting.map((message) => message.id));
        for (const message of deleting) await request(table.delete(message.id));
        messages = messages.filter((message) => message.order < target.order);
        // Retained users must not reference a reply removed by truncation.
        for (const message of messages) {
          if (message.requestedBy && deletedIds.has(message.requestedBy)) {
            delete message.requestedBy;
            await request(table.put(message));
          }
        }
        const last = messages.at(-1);
        session = { ...session, nextOrder: (last?.order ?? 0) + 1,
          lastMessageId: last?.id, lastMessagePreview: last?.content.slice(0, 120) ?? "",
          updatedAt: Date.now() };
        await request(tx.objectStore("sessions").put(session));
      }
      const pending = messages.filter(
        (m) => m.role === "user" && m.status === "sent" && !m.requestedBy,
      );
      if (!pending.length && regenerateId === undefined) return null;
      const id = crypto.randomUUID();
      // Claim all pending bubbles before any API call. Concurrent tabs/requests
      // cannot reserve this same batch again, including after failure/cancel.
      for (const message of pending) {
        message.requestedBy = id;
        await request(table.put(message));
      }
      const assistant: ChatMessage = {
        id,
        sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: Date.now(),
        order: session.nextOrder,
      };
      const nextSession = await this.append(tx, session, assistant);
      return { session: nextSession, messages, pending: regenerateId === undefined ? pending : [], assistant };
    });
  }
  updateReply(
    id: string,
    patch: Pick<ChatMessage, "content" | "status"> & { error?: string },
    worldBookState?: WorldBookActivationState,
  ): Promise<ChatMessage> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing || existing.role !== "assistant")
        throw new Error("Reply not found.");
      // A late provider chunk must not revive a stopped/restored reply.
      if (existing.status !== "streaming") return existing;
      const next = { ...existing, ...patch };
      await request(table.put(next));
      const sessions = tx.objectStore("sessions");
      const session: ChatSession = await request(sessions.get(next.sessionId));
      if (session.lastMessageId === id) {
        await request(
          sessions.put({
            ...session,
            updatedAt: Date.now(),
            lastMessagePreview:
              next.content.slice(0, 120) ||
              (next.status === "error"
                ? "Reply failed"
                : next.status === "cancelled"
                  ? "Reply stopped"
                  : "Replying…"),
          }),
        );
      }
      if (worldBookState && (next.status === "error" || next.status === "cancelled"))
        await commitWorldBookState(tx, next.sessionId, worldBookState);
      return next;
    });
  }
  finalizeReply(id: string, content: string, worldBookState?: WorldBookActivationState,
    transformPart: (part: string) => string = (part) => part): Promise<ChatMessage[]> {
    const parts = splitAssistantReply(content).map(transformPart).map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length)
      return Promise.reject(new Error("The API returned no reply text."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing || existing.role !== "assistant")
        throw new Error("Reply not found.");
      if (existing.status !== "streaming") return [existing];
      const sessionTable = tx.objectStore("sessions");
      const session: ChatSession = await request(sessionTable.get(existing.sessionId));
      const later: ChatMessage[] = (await request<ChatMessage[]>(
        table.index("sessionId").getAll(existing.sessionId),
      )).filter((message) => message.order > existing.order);
      const extra = parts.length - 1;
      for (const message of later)
        await request(table.put({ ...message, order: message.order + extra }));
      const completed: ChatMessage[] = [{ ...existing, content: parts[0], status: "complete" }];
      await request(table.put(completed[0]));
      for (let index = 1; index < parts.length; index++) {
        const message: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId: existing.sessionId,
          role: "assistant",
          content: parts[index],
          status: "complete",
          createdAt: existing.createdAt,
          order: existing.order + index,
        };
        await request(table.add(message));
        completed.push(message);
      }
      const final = completed.at(-1)!;
      await request(sessionTable.put({
        ...session,
        nextOrder: session.nextOrder + extra,
        ...(session.lastMessageId === id ? {
          updatedAt: Date.now(),
          lastMessageId: final.id,
          lastMessagePreview: final.content.slice(0, 120),
        } : {}),
      }));
      if (worldBookState) await commitWorldBookState(tx, existing.sessionId, worldBookState);
      return completed;
    });
  }
}
export const chatStorage = new ChatStorage();
