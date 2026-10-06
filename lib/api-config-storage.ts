import { normalizeApiConfig, type ApiConfig, type NamedApiConfig } from "./api-config";

export const API_CONFIG_DATABASE_NAME = "veil-api-config-v1";
export const API_CONFIG_DATABASE_VERSION = 1;
const STORE = "configs";

const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(new Error("Text API storage could not be read or written."));
});

export class ApiConfigStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: () => IDBFactory = () => window.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) this.database = new Promise((resolve, reject) => {
      const opening = this.factory().open(API_CONFIG_DATABASE_NAME, API_CONFIG_DATABASE_VERSION);
      opening.onupgradeneeded = () => opening.result.createObjectStore(STORE, { keyPath: "id" });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(new Error("Text API storage is unavailable."));
      opening.onblocked = () => reject(new Error("Close other VEIL tabs to open Text API storage."));
    });
    return this.database;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error("Text API storage could not be saved."));
    });
    try {
      const result = await run(tx.objectStore(STORE));
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* already complete */ }
      await done.catch(() => {});
      throw error;
    }
  }

  getApiConfig(id: string): Promise<NamedApiConfig | undefined> {
    return this.transaction("readonly", async (store) => {
      const config = await request<ApiConfig | undefined>(store.get(id));
      return config ? normalizeApiConfig(config) : undefined;
    });
  }

  listApiConfigs(): Promise<NamedApiConfig[]> {
    return this.transaction("readonly", async (store) =>
      (await request<ApiConfig[]>(store.getAll())).map(normalizeApiConfig));
  }

  saveApiConfig(config: ApiConfig): Promise<void> {
    return this.transaction("readwrite", async (store) => { await request(store.put(normalizeApiConfig(config))); });
  }

  deleteApiConfig(id: string): Promise<void> {
    return this.transaction("readwrite", async (store) => { await request(store.delete(id)); });
  }
}

export const browserApiConfigStorage = new ApiConfigStorage();
