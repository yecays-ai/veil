import type { StaticBackupSnapshot } from "./static-source";

export const SAFETY_DATABASE_NAME = "veil-restore-safety-v1";
const STORE = "copies";
type Row = { restoreId: string; createdAt: number; snapshot: StaticBackupSnapshot };

/**
 * A temporary full copy of the device made before an explicit replace, so a failed or interrupted replace can
 * be undone. It lives in its own database (not read by export or preview) and is deleted when the restore ends.
 * Rows keep API keys: the copy never leaves this browser and exists only to put the device back exactly as it was.
 */
export type SafetyCopyStore = {
  save(restoreId: string, snapshot: StaticBackupSnapshot, createdAt: number): Promise<void>;
  load(restoreId: string): Promise<StaticBackupSnapshot | null>;
  remove(restoreId: string): Promise<void>;
};

export function createSafetyCopyStore(factory: IDBFactory): SafetyCopyStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(SAFETY_DATABASE_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "restoreId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error("safety-copy-unavailable"));
  });
  const run = async <T,>(mode: IDBTransactionMode, job: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const operation = job(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(operation.result);
        tx.onerror = tx.onabort = () => reject(new Error("safety-copy-failed"));
      });
    } finally { database.close(); }
  };
  return {
    save: async (restoreId, snapshot, createdAt) => { await run("readwrite", (s) => s.put({ restoreId, createdAt, snapshot } satisfies Row)); },
    load: async (restoreId) => ((await run<Row | undefined>("readonly", (s) => s.get(restoreId))) ?? null)?.snapshot ?? null,
    remove: async (restoreId) => { await run("readwrite", (s) => s.delete(restoreId)); },
  };
}
