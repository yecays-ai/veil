import type { ChatBackgroundSettings } from "./types";

// Wallpaper asset ids are immutable UUIDs, so a Blob read for an id never goes stale. The most recent
// few are kept together with ONE object URL each and a decoded <img> holding it: the browser caches the
// decoded bitmap per URL, so re-entering a chat paints the wallpaper without decoding it again (a fresh
// URL per visit made it decode after the first frame, which showed as the wallpaper "popping in").
// Eviction revokes the URL, so the set is bounded and nothing outlives it.
const MAX_ENTRIES = 2;
type Entry = { blob: Blob; url: string; image: HTMLImageElement | null; ready: Promise<void>; decoded: boolean };
const entries = new Map<string, Entry>();
let settings = new WeakMap<object, { value: ChatBackgroundSettings; revision: number }>();

function release(entry: Entry) {
  if (entry.image) entry.image.src = "";
  URL.revokeObjectURL(entry.url);
}

/** The object URL of a cached wallpaper that has finished decoding (most recently used), or null. */
export function cachedBackgroundUrl(id: string): string | null {
  const entry = entries.get(id);
  if (!entry) return null;
  entries.delete(id); entries.set(id, entry);
  return entry.decoded ? entry.url : null;
}

/** A wallpaper that was read but is still decoding: callers wait for it instead of reading the Blob again. */
export function pendingBackgroundReady(id: string): Promise<void> | null {
  const entry = entries.get(id);
  return entry && !entry.decoded ? entry.ready : null;
}

/**
 * Keeps the Blob behind one object URL and starts decoding it. `ready` settles once the browser can paint
 * the image (or failed to decode it, which just means a normal paint), so callers can reveal it decoded.
 */
export function rememberBackgroundBlob(id: string, blob: Blob): { url: string; ready: Promise<void> } {
  const existing = entries.get(id);
  if (existing) { cachedBackgroundUrl(id); return { url: existing.url, ready: existing.ready }; }
  const url = URL.createObjectURL(blob);
  const entry: Entry = { blob, url, image: null, ready: Promise.resolve(), decoded: typeof Image === "undefined" };
  if (typeof Image !== "undefined") {
    const image = new Image();
    image.src = url;
    entry.image = image;
    // Settles on success or failure: a failed decode just means a normal paint, not a stuck wallpaper.
    entry.ready = (image.decode ? image.decode() : Promise.resolve()).catch(() => {}).then(() => { entry.decoded = true; });
  }
  entries.set(id, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string;
    release(entries.get(oldest)!);
    entries.delete(oldest);
  }
  return { url, ready: entry.ready };
}

// What a chat last resolved to, keyed by character: lets the wallpaper be chosen in the first frame,
// before the session itself has been read from storage. Valid only while the revision is unchanged.
const MAX_HINTS = 16;
export type BackgroundHint = { image: string | null; blur: number | null };
let hints = new WeakMap<object, Map<string, BackgroundHint & { revision: number }>>();

export function cachedBackgroundHint(owner: object, characterId: string, currentRevision: number): BackgroundHint | null {
  const hint = hints.get(owner)?.get(characterId);
  return hint && hint.revision === currentRevision ? { image: hint.image, blur: hint.blur } : null;
}

export function rememberBackgroundHint(owner: object, characterId: string, hint: BackgroundHint, revision: number) {
  const known = hints.get(owner) ?? new Map<string, BackgroundHint & { revision: number }>();
  known.delete(characterId);
  known.set(characterId, { ...hint, revision });
  while (known.size > MAX_HINTS) known.delete(known.keys().next().value as string);
  hints.set(owner, known);
}

/** The last settings read, usable only while the storage's background revision is unchanged. */
export function cachedBackgroundSettings(owner: object, currentRevision: number): ChatBackgroundSettings | null {
  const snapshot = settings.get(owner);
  return snapshot && snapshot.revision === currentRevision ? snapshot.value : null;
}

/** `readRevision` is the revision observed when the read started, so a change mid-read makes it stale. */
export function rememberBackgroundSettings(owner: object, next: ChatBackgroundSettings, readRevision: number) {
  settings.set(owner, { value: next, revision: readRevision });
}

export function resetChatBackgroundCacheForTests() {
  for (const entry of entries.values()) release(entry);
  entries.clear(); settings = new WeakMap(); hints = new WeakMap();
}
