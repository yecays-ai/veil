import {
  DEFAULT_API_CONFIG_ID,
  normalizeApiConfig,
  type NamedApiConfig,
  type ApiConfig,
  type ChatMessage,
  type ChatSession,
  type ReplyBatch,
} from "./types";

const DATABASE = "veil-chat-v1";
const STORES = ["sessions", "messages", "apiConfigs"];
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new Error("Chat storage could not be read or written."));
  });

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
        const req = this.factory().open(DATABASE, 1);
        let blocked = false;
        req.onupgradeneeded = () => {
          const db = req.result;
          const sessions = db.createObjectStore("sessions", { keyPath: "id" });
          sessions.createIndex("characterId", "characterId", { unique: true });
          const messages = db.createObjectStore("messages", { keyPath: "id" });
          messages.createIndex("sessionId", "sessionId");
          db.createObjectStore("apiConfigs", { keyPath: "id" });
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
          reject(
            new Error(
              "Chat storage is unavailable. Existing conversations have not been changed.",
            ),
          );
        };
        req.onblocked = () => {
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
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORES, mode);
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
    this.listeners.forEach((listener) => listener());
    this.channel?.postMessage("changed");
  }
  subscribe(listener: () => void) {
    if (
      !this.channel &&
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel(DATABASE);
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
  openSession(characterId: string): Promise<ChatSession> {
    if (!characterId)
      return Promise.reject(new Error("Character is required."));
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("sessions");
      const existing: ChatSession | undefined = await request(
        table.index("characterId").get(characterId),
      );
      if (existing) return existing;
      const session: ChatSession = {
        id: `character:${characterId}`,
        characterId,
        updatedAt: 0,
        remark: null,
        autoReplyOnKeyboardDismiss: false,
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
  send(sessionId: string, content: string): Promise<ChatMessage> {
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
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "user",
        content: content.trim(),
        status: "sent",
        createdAt: Date.now(),
        order: session.nextOrder,
      };
      await this.append(tx, session, message);
      return message;
    });
  }

  beginReply(sessionId: string): Promise<ReplyBatch | null> {
    return this.transaction("readwrite", async (tx) => {
      const session: ChatSession | undefined = await request(
        tx.objectStore("sessions").get(sessionId),
      );
      if (!session) throw new Error("Conversation not found.");
      const table = tx.objectStore("messages");
      const messages: ChatMessage[] = await request(
        table.index("sessionId").getAll(sessionId),
      );
      messages.sort((a, b) => a.order - b.order);
      const pending = messages.filter(
        (m) => m.role === "user" && !m.requestedBy,
      );
      if (!pending.length) return null;
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
      return { session: nextSession, messages, pending, assistant };
    });
  }
  updateReply(
    id: string,
    patch: Pick<ChatMessage, "content" | "status"> & { error?: string },
  ): Promise<ChatMessage> {
    return this.transaction("readwrite", async (tx) => {
      const table = tx.objectStore("messages");
      const existing: ChatMessage | undefined = await request(table.get(id));
      if (!existing || existing.role !== "assistant")
        throw new Error("Reply not found.");
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
      return next;
    });
  }
  getApiConfig(id = DEFAULT_API_CONFIG_ID): Promise<ApiConfig | undefined> {
    return this.transaction("readonly", async (tx) => {
      const config: ApiConfig | undefined = await request(
        tx.objectStore("apiConfigs").get(id),
      );
      return config ? normalizeApiConfig(config) : undefined;
    });
  }
  listApiConfigs(): Promise<NamedApiConfig[]> {
    return this.transaction("readonly", async (tx) => {
      const configs: ApiConfig[] = await request(
        tx.objectStore("apiConfigs").getAll(),
      );
      return configs.map(normalizeApiConfig);
    });
  }
  // Keep dangling binding IDs deliberately: deleting a reference would inherit
  // another provider. Missing resources fail closed in the chat engine.
  deleteApiConfig(id: string): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      await request(tx.objectStore("apiConfigs").delete(id));
    });
  }
  saveApiConfig(config: ApiConfig): Promise<void> {
    return this.transaction("readwrite", async (tx) => {
      await request(
        tx.objectStore("apiConfigs").put(normalizeApiConfig(config)),
      );
    });
  }
}
export const chatStorage = new ChatStorage();
