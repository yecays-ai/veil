import { EMPTY_TTS_CONFIG, normalizeTtsConfig, type TtsConfig } from "./config";

export const TTS_DATABASE_NAME = "veil-tts-config-v1";
const STORE = "config", KEY = "default";

const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(new Error("Voice settings could not be read or written."));
});

/** A write is done when its transaction commits, not when the request succeeds: a quota error can still abort it. */
const committed = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(new Error("Voice settings could not be read or written."));
});

/** One row in its own database, on purpose outside backup, restore and the Text API list. */
export class TtsConfigStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: () => IDBFactory = () => window.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = this.factory().open(TTS_DATABASE_NAME, 1);
      opening.onupgradeneeded = () => { opening.result.createObjectStore(STORE); };
      opening.onsuccess = () => {
        opening.result.onversionchange = () => { opening.result.close(); this.database = undefined; };
        resolve(opening.result);
      };
      opening.onerror = () => reject(new Error("Voice settings could not be opened."));
    }).catch((error) => { this.database = undefined; throw error; });
    return this.database;
  }
  async load(): Promise<TtsConfig> {
    const db = await this.open();
    return normalizeTtsConfig(await request(db.transaction(STORE).objectStore(STORE).get(KEY)) ?? EMPTY_TTS_CONFIG);
  }
  async save(config: TtsConfig): Promise<TtsConfig> {
    const next = normalizeTtsConfig(config), db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(next, KEY);
    await committed(tx);
    return next;
  }
  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    await committed(tx);
  }
}
export const browserTtsConfigStorage = new TtsConfigStorage();
