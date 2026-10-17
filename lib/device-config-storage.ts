const STORE = "config", KEY = "default";

/**
 * A service's settings on this device: one row in its own database, on purpose outside backup, restore and the Text
 * API list. A write is done when its transaction commits, not when the request succeeds: a quota error can still abort it.
 */
export class DeviceConfigStorage<T> {
  private database?: Promise<IDBDatabase>;
  constructor(
    private readonly databaseName: string, private readonly label: string,
    private readonly normalize: (value: unknown) => T, private readonly empty: T,
    private readonly factory: () => IDBFactory = () => window.indexedDB,
  ) {}
  private failure(action: string) { return new Error(`${this.label} could not be ${action}.`); }
  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = this.factory().open(this.databaseName, 1);
      opening.onupgradeneeded = () => { opening.result.createObjectStore(STORE); };
      opening.onsuccess = () => {
        opening.result.onversionchange = () => { opening.result.close(); this.database = undefined; };
        resolve(opening.result);
      };
      opening.onerror = () => reject(this.failure("opened"));
    }).catch((error) => { this.database = undefined; throw error; });
    return this.database;
  }
  private request<V>(value: IDBRequest<V>): Promise<V> {
    return new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(this.failure("read or written"));
    });
  }
  private committed(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(this.failure("read or written"));
    });
  }
  async load(): Promise<T> {
    const db = await this.open();
    return this.normalize(await this.request(db.transaction(STORE).objectStore(STORE).get(KEY)) ?? this.empty);
  }
  async save(config: T): Promise<T> {
    const next = this.normalize(config), db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(next, KEY);
    await this.committed(tx);
    return next;
  }
  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    await this.committed(tx);
  }
}
