/** Source authority must never bootstrap, upgrade or repair a database. Caller owns the backup lease. */
export async function readExistingMemorySource<T>(factory: IDBFactory, name: string, version: number, stores: readonly string[],
  read: (tx: IDBTransaction) => Promise<T>): Promise<T | null> {
  const catalog = await factory.databases(), existing = catalog.find((db) => db.name === name);
  if (!existing) return null;
  if (existing.version !== version) throw new Error("Memory source schema unavailable.");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(name); let rejected = false;
    const fail = () => { rejected = true; reject(new Error("Memory source unavailable.")); };
    opening.onupgradeneeded = () => { opening.transaction?.abort(); fail(); };
    opening.onerror = opening.onblocked = fail;
    opening.onsuccess = () => { if (rejected) opening.result.close(); else resolve(opening.result); };
  });
  try {
    if (db.version !== version || db.objectStoreNames.length !== stores.length || stores.some((store) => !db.objectStoreNames.contains(store)))
      throw new Error("Memory source schema unavailable.");
    db.onversionchange = () => db.close();
    const tx = db.transaction([...stores], "readonly");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error("Memory source read failed."));
    });
    void done.catch(() => {});
    try { const result = await read(tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch { /* terminal */ } await done.catch(() => {}); throw error; }
  } finally { db.close(); }
}
