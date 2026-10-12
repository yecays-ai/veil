import { browserPersistenceWriteGate, runPersistenceWrite, withPersistenceWriteScope, type PersistenceWriteGate, type PersistenceWriteScope } from "../backup/persistence-write-gate";
import { memoryFingerprint } from "./fingerprint";
import {
  MEMORY_DATABASE_NAME, MEMORY_DATABASE_VERSION, MEMORY_OPERATION_LIMIT,
  type Memory, type MemoryChange, type MemoryCursor, type MemoryDraft, type MemoryOperation, type MemorySource, type Suppression,
} from "./types";

export const MEMORY_STORES = ["memories", "suppressions", "operations", "cursors"] as const;
export type MemoryStoreName = typeof MEMORY_STORES[number];

export class MemoryProtectedError extends Error {
  constructor(readonly memoryId: string) { super("A manual memory cannot be changed by automatic edits."); }
}
export class MemoryDuplicateError extends Error {
  constructor(readonly existingId: string) { super("A memory with the same text already exists for this Character."); }
}

export const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(new Error("Memory storage could not be read or written."));
});

export type MemoryTx = { store(name: MemoryStoreName): IDBObjectStore };

/** Keep only the pointer fields; anything else a caller attaches (such as chat text) is dropped. */
export function normalizeSources(sources: readonly MemorySource[]): MemorySource[] {
  const seen = new Set<string>();
  const result: MemorySource[] = [];
  for (const item of sources) {
    if (typeof item?.sessionId !== "string" || typeof item.messageId !== "string" || !item.sessionId || !item.messageId)
      throw new Error("A memory source needs a sessionId and a messageId.");
    const key = `${item.sessionId}\u0000${item.messageId}`;
    if (!seen.has(key)) { seen.add(key); result.push({ sessionId: item.sessionId, messageId: item.messageId }); }
  }
  return result;
}

export const cursorId = (characterId: string, sessionId: string) => `${characterId}\u0000${sessionId}`;

/**
 * Independent `veil-memory-v1` database. Nothing in the app opens it yet; the backup coverage
 * that must exist before production use lands in the next PR.
 */
export class MemoryStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: () => IDBFactory = () => window.indexedDB, readonly now: () => number = Date.now,
    private writeGate: PersistenceWriteGate = browserPersistenceWriteGate) {}

  private open(scope?: PersistenceWriteScope): Promise<IDBDatabase> {
    if (this.database) return this.database;
    return runPersistenceWrite(this.writeGate, () => this.openDatabase(), scope);
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        let operation: IDBOpenDBRequest;
        let rejected = false;
        try { operation = this.factory().open(MEMORY_DATABASE_NAME, MEMORY_DATABASE_VERSION); }
        catch { reject(new Error("Memory storage is unavailable.")); return; }
        operation.onupgradeneeded = () => {
          if (rejected) { operation.transaction?.abort(); return; }
          const db = operation.result;
          const memories = db.createObjectStore("memories", { keyPath: "id" });
          memories.createIndex("characterId", "characterId");
          memories.createIndex("characterFingerprint", ["characterId", "fingerprint"]);
          for (const name of ["suppressions", "operations", "cursors"] as const)
            db.createObjectStore(name, { keyPath: "id" }).createIndex("characterId", "characterId");
        };
        operation.onsuccess = () => {
          const db = operation.result;
          if (rejected) { db.close(); return; }
          db.onversionchange = () => { db.close(); if (this.database === opening) this.database = undefined; };
          resolve(db);
        };
        operation.onerror = () => { rejected = true; reject(new Error("Memory storage is unavailable.")); };
        operation.onblocked = () => { rejected = true; reject(new Error("Close other VEIL tabs to open Memory storage.")); };
      });
      this.database = opening;
      void opening.catch(() => { if (this.database === opening) this.database = undefined; });
    }
    return this.database;
  }

  /**
   * Run `run` in one transaction. Writes take the backup lease first, then the local queue
   * (via the write gate). `run` may only await requests of this transaction.
   */
  async transaction<T>(mode: IDBTransactionMode, run: (tx: MemoryTx) => Promise<T>, outer?: PersistenceWriteScope): Promise<T> {
    if (mode !== "readwrite") return this.perform(mode, run, outer);
    return outer
      ? runPersistenceWrite(this.writeGate, () => this.perform(mode, run, outer), outer)
      : withPersistenceWriteScope(this.writeGate, (scope) => this.perform(mode, run, scope));
  }

  private async perform<T>(mode: IDBTransactionMode, run: (tx: MemoryTx) => Promise<T>, scope?: PersistenceWriteScope): Promise<T> {
    const db = await this.open(scope);
    const tx = db.transaction([...MEMORY_STORES], mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error("Memory storage could not be saved."));
    });
    try {
      const result = await run({ store: (name) => tx.objectStore(name) });
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already complete */ }
      await done.catch(() => {});
      throw error;
    }
  }

  // ---- reads ----

  listMemories(characterId: string): Promise<Memory[]> {
    return this.transaction("readonly", (tx) => request<Memory[]>(tx.store("memories").index("characterId").getAll(characterId)));
  }

  getMemory(id: string): Promise<Memory | undefined> {
    return this.transaction("readonly", (tx) => request<Memory | undefined>(tx.store("memories").get(id)));
  }

  findByFingerprint(characterId: string, text: string): Promise<Memory[]> {
    const fingerprint = memoryFingerprint(text);
    return this.transaction("readonly", (tx) =>
      request<Memory[]>(tx.store("memories").index("characterFingerprint").getAll([characterId, fingerprint])));
  }

  listSuppressions(characterId: string): Promise<Suppression[]> {
    return this.transaction("readonly", (tx) => request<Suppression[]>(tx.store("suppressions").index("characterId").getAll(characterId)));
  }

  listCursors(characterId: string): Promise<MemoryCursor[]> {
    return this.transaction("readonly", (tx) => request<MemoryCursor[]>(tx.store("cursors").index("characterId").getAll(characterId)));
  }

  /** Oldest first, newest last. */
  async listOperations(characterId: string): Promise<MemoryOperation[]> {
    const rows = await this.transaction("readonly", (tx) => request<MemoryOperation[]>(tx.store("operations").index("characterId").getAll(characterId)));
    return rows.sort((a, b) => a.seq - b.seq);
  }

  // ---- writes ----

  /**
   * Apply puts, removals and suppressions as one transaction and record one undo operation (trimmed
   * to the last five per Character in the same transaction). Any failure rolls the whole batch back.
   * `auto: true` marks an automatic edit, which may not touch manual memories.
   */
  applyChange(characterId: string, label: string,
    change: { put?: readonly MemoryDraft[]; remove?: readonly string[]; suppress?: readonly Omit<Suppression, "characterId" | "createdAt">[] },
    options: { auto?: boolean } = {}): Promise<MemoryOperation> {
    return this.transaction("readwrite", async (tx) => {
      const memories = tx.store("memories");
      const changes: MemoryChange[] = [];
      const now = this.now();
      for (const draft of change.put ?? []) {
        if (draft.characterId !== characterId) throw new Error("A memory belongs to a different Character.");
        const before = (await request<Memory | undefined>(memories.get(draft.id))) ?? null;
        if (before && before.characterId !== characterId) throw new Error("A memory belongs to a different Character.");
        if (options.auto && (draft.origin === "manual" || before?.origin === "manual")) throw new MemoryProtectedError(draft.id);
        const fingerprint = memoryFingerprint(draft.text);
        if (!fingerprint) throw new Error("A memory needs text.");
        if (draft.status === "active" || draft.status === "flagged") {
          const same = await request<Memory[]>(memories.index("characterFingerprint").getAll([characterId, fingerprint]));
          const clash = same.find((row) => row.id !== draft.id && (row.status === "active" || row.status === "flagged"));
          if (clash) throw new MemoryDuplicateError(clash.id);
        }
        const after: Memory = { ...draft, sources: normalizeSources(draft.sources), lineage: { ...draft.lineage },
          fingerprint, createdAt: before?.createdAt ?? now, updatedAt: now };
        await request(memories.put(after));
        changes.push({ before, after });
      }
      for (const id of change.remove ?? []) {
        const before = await request<Memory | undefined>(memories.get(id));
        if (!before) continue;
        if (before.characterId !== characterId) throw new Error("A memory belongs to a different Character.");
        if (options.auto && before.origin === "manual") throw new MemoryProtectedError(id);
        await request(memories.delete(id));
        changes.push({ before, after: null });
      }
      const suppressionChanges: NonNullable<MemoryOperation["suppressionChanges"]> = [];
      for (const item of change.suppress ?? []) {
        const existing = await request<Suppression | undefined>(tx.store("suppressions").get(item.id));
        if (existing && existing.characterId !== characterId) throw new Error("A suppression belongs to a different Character.");
        const after = { ...item, characterId, sources: normalizeSources(item.sources), createdAt: now } satisfies Suppression;
        await request(tx.store("suppressions").put(after));
        suppressionChanges.push({ before: existing ?? null, after });
      }
      return this.recordOperation(tx, characterId, label, changes, now, suppressionChanges);
    });
  }

  private async recordOperation(tx: MemoryTx, characterId: string, label: string, changes: MemoryChange[], now: number,
    suppressionChanges: NonNullable<MemoryOperation["suppressionChanges"]>) {
    const operations = tx.store("operations");
    const existing = (await request<MemoryOperation[]>(operations.index("characterId").getAll(characterId))).sort((a, b) => a.seq - b.seq);
    const seq = (existing.at(-1)?.seq ?? 0) + 1;
    const operation: MemoryOperation = { id: `${characterId}\u0000${seq}`, characterId, seq, label, createdAt: now, changes, suppressionChanges };
    await request(operations.put(operation));
    const kept = [...existing, operation];
    for (const old of kept.slice(0, Math.max(0, kept.length - MEMORY_OPERATION_LIMIT)))
      await request(operations.delete(old.id));
    return operation;
  }

  /** Revert the newest operation of a Character and drop its record. Returns it, or undefined if none. */
  undoLastOperation(characterId: string): Promise<MemoryOperation | undefined> {
    return this.transaction("readwrite", async (tx) => {
      const operations = tx.store("operations");
      const last = (await request<MemoryOperation[]>(operations.index("characterId").getAll(characterId))).sort((a, b) => a.seq - b.seq).at(-1);
      if (!last) return undefined;
      const memories = tx.store("memories");
      for (const { before, after } of [...last.changes].reverse()) {
        if (before) await request(memories.put(before));
        else if (after) await request(memories.delete(after.id));
      }
      const suppressions = tx.store("suppressions");
      for (const { before, after } of [...(last.suppressionChanges ?? [])].reverse()) {
        if (before) await request(suppressions.put(before));
        else await request(suppressions.delete(after.id));
      }
      await request(operations.delete(last.id));
      return last;
    });
  }

  /** Create or update the progress/failure row of a session; never touches a pending clear intent. */
  saveCursor(characterId: string, sessionId: string, patch: Partial<Pick<MemoryCursor, "processedMessageId" | "failureCount" | "failureReason">>): Promise<MemoryCursor> {
    return this.transaction("readwrite", async (tx) => {
      const store = tx.store("cursors");
      const id = cursorId(characterId, sessionId);
      const previous = await request<MemoryCursor | undefined>(store.get(id));
      const next: MemoryCursor = { failureCount: 0, ...previous, ...patch, id, characterId, sessionId, updatedAt: this.now() };
      if (next.failureCount === 0) delete next.failureReason;
      await request(store.put(next));
      return next;
    });
  }
}
