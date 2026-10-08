export type StoredDocument = { key: string; value: string; updatedAt: number };

export interface DocumentStorage {
  read(key: string): Promise<string | null>;
  putIfAbsent(key: string, value: string): Promise<string>;
  replaceIfCurrent(key: string, expected: string | null, value: string): Promise<boolean>;
  rollbackIfCurrent(key: string, expected: string, previous: string | null): Promise<boolean>;
}

export const CORE_DATABASE_NAME = "veil-core-v1";
export const CORE_DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";

const request = <T>(operation: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(new Error("Core storage could not be read or written."));
  });

function isInvalidStateError(error: unknown): boolean {
  return !!error && typeof error === "object" &&
    (error as { name?: unknown }).name === "InvalidStateError";
}

export class IndexedDBDocumentStorage implements DocumentStorage {
  private database?: Promise<IDBDatabase>;

  constructor(private factory: () => IDBFactory = () => window.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        let operation: IDBOpenDBRequest;
        let blocked = false;
        try {
          operation = this.factory().open(CORE_DATABASE_NAME, CORE_DATABASE_VERSION);
        } catch {
          reject(new Error("Core storage is unavailable. Existing data has not been changed."));
          return;
        }
        operation.onupgradeneeded = () => {
          if (!operation.result.objectStoreNames.contains(DOCUMENT_STORE))
            operation.result.createObjectStore(DOCUMENT_STORE, { keyPath: "key" });
        };
        operation.onsuccess = () => {
          const database = operation.result;
          if (blocked) {
            database.close();
            return;
          }
          database.addEventListener("close", () => {
            if (this.database === opening) this.database = undefined;
          });
          database.onversionchange = () => {
            database.close();
            if (this.database === opening) this.database = undefined;
          };
          resolve(database);
        };
        operation.onerror = () =>
          reject(new Error("Core storage is unavailable. Existing data has not been changed."));
        operation.onblocked = () => {
          blocked = true;
          reject(new Error("Close other VEIL tabs to upgrade core storage."));
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
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const opening = this.open();
    const database = await opening;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(DOCUMENT_STORE, mode);
    } catch (error) {
      if (!isInvalidStateError(error)) throw error;
      if (this.database === opening) this.database = undefined;
      const recoveredOpening = this.open();
      const recoveredDatabase = await recoveredOpening;
      try {
        transaction = recoveredDatabase.transaction(DOCUMENT_STORE, mode);
      } catch (retryError) {
        if (isInvalidStateError(retryError) && this.database === recoveredOpening)
          this.database = undefined;
        throw retryError;
      }
    }
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () =>
        reject(new Error("Core storage transaction failed. Existing data has not been changed."));
    });
    try {
      const result = await run(transaction.objectStore(DOCUMENT_STORE));
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed or aborted.
      }
      await done.catch(() => {});
      throw error;
    }
  }

  read(key: string): Promise<string | null> {
    return this.transaction("readonly", async (store) => {
      const saved = await request<StoredDocument | undefined>(store.get(key));
      return saved?.value ?? null;
    });
  }

  putIfAbsent(key: string, value: string): Promise<string> {
    return this.transaction("readwrite", async (store) => {
      const saved = await request<StoredDocument | undefined>(store.get(key));
      if (saved) return saved.value;
      await request(store.add({ key, value, updatedAt: Date.now() } satisfies StoredDocument));
      return value;
    });
  }

  replaceIfCurrent(key: string, expected: string | null, value: string): Promise<boolean> {
    return this.transaction("readwrite", async (store) => {
      const saved = await request<StoredDocument | undefined>(store.get(key));
      if ((saved?.value ?? null) !== expected) return false;
      await request(store.put({ key, value, updatedAt: Date.now() } satisfies StoredDocument));
      return true;
    });
  }

  rollbackIfCurrent(
    key: string,
    expected: string,
    previous: string | null,
  ): Promise<boolean> {
    return this.transaction("readwrite", async (store) => {
      const saved = await request<StoredDocument | undefined>(store.get(key));
      if (saved?.value !== expected) return false;
      if (previous === null) await request(store.delete(key));
      else
        await request(
          store.put({ key, value: previous, updatedAt: Date.now() } satisfies StoredDocument),
        );
      return true;
    });
  }
}

export const browserDocumentStorage = new IndexedDBDocumentStorage();

