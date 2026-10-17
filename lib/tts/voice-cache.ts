import { providerOf, speechEndpoint, ttsConfigProblem, type TtsConfig } from "./config";
import { synthesizeSpeech } from "./speech";

/**
 * Spoken audio is remade from the message text at any time, so it lives apart from the chat database:
 * it is never backed up, has a size cap, and is dropped when the text, voice or service behind it changes.
 */
export const VOICE_CACHE_DATABASE = "veil-voice-cache-v1";
export const VOICE_CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
const STORE = "audio";

/** New clips are kept as bytes (`data`); a clip saved earlier as a `blob` is still read and is replaced the next time it is made. */
type Row = { messageId: string; fingerprint: string; data?: ArrayBuffer; type?: string; blob?: Blob; bytes: number; usedAt: number };
const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(new Error("Voice cache could not be read or written."));
});
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error("Voice cache could not be written."));
});

/** What the audio depends on. Any change here makes an old clip unusable. The key itself is not part of it. */
export async function voiceFingerprint(text: string, voice: string, config: Pick<TtsConfig, "baseUrl" | "model" | "provider" | "region">): Promise<string> {
  let endpoint = config.baseUrl.trim();
  try { endpoint = speechEndpoint(config); } catch { /* an invalid URL cannot be used for speech anyway */ }
  // OpenAI-compatible clips keep the fingerprint they always had; another provider is part of it.
  const provider = providerOf(config);
  const bytes = new TextEncoder().encode(JSON.stringify([text, voice.trim(), config.model.trim(), endpoint, ...(provider === "openai" ? [] : [provider])]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * iOS Safari can refuse to play a file-backed blob read from IndexedDB ("The operation is not supported") or fail to read it at all,
 * which made a saved clip look missing. Bytes are stored and the player gets an in-memory blob, the kind a fresh clip is.
 */
const playable = (bytes: BlobPart, type?: string) => new Blob([bytes], { type: type || "audio/mpeg" });

export class VoiceCache {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: () => IDBFactory = () => window.indexedDB, private limit = VOICE_CACHE_LIMIT_BYTES) {}
  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const opening = this.factory().open(VOICE_CACHE_DATABASE, 1);
      opening.onupgradeneeded = () => { opening.result.createObjectStore(STORE, { keyPath: "messageId" }); };
      opening.onsuccess = () => {
        opening.result.onversionchange = () => { opening.result.close(); this.database = undefined; };
        resolve(opening.result);
      };
      opening.onerror = () => reject(new Error("Voice cache could not be opened."));
    }).catch((error) => { this.database = undefined; throw error; });
    return this.database;
  }
  /** The stored clip for this message when it was made from exactly this fingerprint; a stale clip is deleted. */
  async get(messageId: string, fingerprint: string): Promise<Blob | null> {
    const db = await this.open(), tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
    const row = await request<Row | undefined>(store.get(messageId));
    if (!row) return null;
    if (row.fingerprint !== fingerprint) { store.delete(messageId); await done(tx); return null; }
    store.put({ ...row, usedAt: Date.now() });
    await done(tx);
    if (row.data) return playable(row.data, row.type);
    return row.blob ? playable(await row.blob.arrayBuffer(), row.blob.type) : null;
  }
  /** Stores a clip, then drops the least recently played ones until the cache fits its cap. */
  async put(messageId: string, fingerprint: string, blob: Blob): Promise<void> {
    const data = await blob.arrayBuffer(); // read before the transaction opens: nothing unrelated runs inside it
    const db = await this.open(), tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
    store.put({ messageId, fingerprint, data, type: blob.type, bytes: blob.size, usedAt: Date.now() } satisfies Row);
    const rows = await request<Row[]>(store.getAll());
    let total = rows.reduce((sum, row) => sum + row.bytes, blob.size) - (rows.find((row) => row.messageId === messageId)?.bytes ?? 0);
    for (const row of rows.filter((item) => item.messageId !== messageId).sort((a, b) => a.usedAt - b.usedAt)) {
      if (total <= this.limit) break;
      store.delete(row.messageId); total -= row.bytes;
    }
    await done(tx);
  }
  async keys(): Promise<string[]> {
    const db = await this.open();
    return (await request(db.transaction(STORE).objectStore(STORE).getAllKeys())).map(String);
  }
  async remove(messageIds: readonly string[]): Promise<void> {
    if (!messageIds.length) return;
    const db = await this.open(), tx = db.transaction(STORE, "readwrite");
    for (const id of messageIds) tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}
export const browserVoiceCache = new VoiceCache();

const inflight = new Map<string, Promise<Blob>>();
let swept = false;

/**
 * Drops clips whose message no longer exists (deleted, cleared, recalled, a deleted Character), once per page load.
 * `existing` answers which of the given message ids are still stored; this runs before the first clip is made, never inside a transaction.
 */
export async function sweepVoiceCache(existing: (ids: string[]) => Promise<ReadonlySet<string>>, cache: VoiceCache = browserVoiceCache): Promise<void> {
  if (swept) return;
  swept = true;
  try {
    const keys = await cache.keys();
    if (!keys.length) return;
    const alive = await existing(keys);
    await cache.remove(keys.filter((id) => !alive.has(id)));
  } catch { swept = false; }
}
export const resetVoiceSweepForTests = () => { swept = false; inflight.clear(); };

type Source = { messageId: string; text: string; voice: string; config: TtsConfig };
/**
 * The audio for one voice bubble. A saved clip is reused; otherwise one request is shared within this page. Other tabs
 * share it only when Web Locks are available and the first tab has stored the clip. The request is not tied to the
 * bubble: leaving the page does not waste it.
 */
export function voiceAudio(source: Source, cache: VoiceCache = browserVoiceCache,
  options: { synthesize?: typeof synthesizeSpeech; locks?: LockManager | undefined } = {}): Promise<Blob> {
  const problem = ttsConfigProblem(source.config);
  if (problem) return Promise.reject(new Error(problem));
  const synthesize = options.synthesize ?? synthesizeSpeech, locks = "locks" in options ? options.locks : (typeof navigator === "undefined" ? undefined : navigator.locks);
  const task = (async () => {
    const fingerprint = await voiceFingerprint(source.text, source.voice, source.config), key = `${source.messageId}:${fingerprint}`;
    const shared = inflight.get(key);
    if (shared) return shared;
    const make = async () => {
      const saved = await cache.get(source.messageId, fingerprint).catch(() => null);
      if (saved) return saved;
      const blob = await synthesize(source.config, { text: source.text, voice: source.voice }, new AbortController().signal);
      await cache.put(source.messageId, fingerprint, blob).catch(() => {}); // a full or blocked cache still lets the clip play once
      return blob;
    };
    const pending: Promise<Blob> = (async () => locks ? await locks.request(`veil-voice:${key}`, make) : await make())();
    inflight.set(key, pending);
    return pending.finally(() => inflight.delete(key));
  })();
  return task;
}
