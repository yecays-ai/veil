import type { ChatBackgroundSettings } from "./types";

// Wallpaper asset ids are immutable UUIDs, so a Blob read for an id never goes stale. Only the most
// recent few are retained (each pins its bytes). Object URLs are NOT cached: every mounted chat
// creates its own from the Blob and revokes it on unmount.
const MAX_BLOBS = 2;
const blobs = new Map<string, Blob>();
let settings: { value: ChatBackgroundSettings; revision: number } | null = null;

export function cachedBackgroundBlob(id: string): Blob | null {
  const blob = blobs.get(id);
  if (!blob) return null;
  blobs.delete(id); blobs.set(id, blob); // most recently used
  return blob;
}

export function rememberBackgroundBlob(id: string, blob: Blob): Blob {
  const existing = cachedBackgroundBlob(id);
  if (existing) return existing;
  blobs.set(id, blob);
  while (blobs.size > MAX_BLOBS) blobs.delete(blobs.keys().next().value as string);
  return blob;
}

/** The last settings read, usable only while the storage's background revision is unchanged. */
export function cachedBackgroundSettings(currentRevision: number): ChatBackgroundSettings | null {
  return settings && settings.revision === currentRevision ? settings.value : null;
}

/** `readRevision` is the revision observed when the read started, so a change mid-read makes it stale. */
export function rememberBackgroundSettings(next: ChatBackgroundSettings, readRevision: number) {
  settings = { value: next, revision: readRevision };
}

export function resetChatBackgroundCacheForTests() {
  blobs.clear(); settings = null;
}
