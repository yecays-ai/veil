import {
  THEME_IMAGE_ASSET_PREFIX,
  themeImageAssetId,
  type ThemeSnapshot,
} from "./theme-types";

export const APPEARANCE_IMAGE_DATABASE_NAME = "veil-appearance-images-v1";
export const APPEARANCE_IMAGE_DATABASE_VERSION = 1;
const STORE = "assets";
type ImageAsset = { id: string; blob: Blob; type: string; createdAt: number };

const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(new Error("Appearance image storage could not be read or written."));
});

function blobFromDataUrl(source: string): Blob {
  const match = source.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error("Appearance image data is invalid.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}

async function imageId(blob: Blob): Promise<string> {
  if (!blob.size || !blob.type.startsWith("image/"))
    throw new Error("Appearance image is empty or invalid.");
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    throw new Error("Appearance image storage is unavailable.");
  }
}

export class AppearanceImageStorage {
  private database?: Promise<IDBDatabase>;
  constructor(private factory: () => IDBFactory = () => window.indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        let operation: IDBOpenDBRequest;
        try { operation = this.factory().open(APPEARANCE_IMAGE_DATABASE_NAME, APPEARANCE_IMAGE_DATABASE_VERSION); }
        catch { reject(new Error("Appearance image storage is unavailable.")); return; }
        operation.onupgradeneeded = () => {
          if (!operation.result.objectStoreNames.contains(STORE))
            operation.result.createObjectStore(STORE, { keyPath: "id" });
        };
        operation.onsuccess = () => {
          const db = operation.result;
          db.onversionchange = () => {
            db.close();
            if (this.database === opening) this.database = undefined;
          };
          resolve(db);
        };
        operation.onerror = () => reject(new Error("Appearance image storage is unavailable."));
        operation.onblocked = () => reject(new Error("Close other VEIL tabs to open Appearance image storage."));
      });
      this.database = opening;
      void opening.catch(() => { if (this.database === opening) this.database = undefined; });
    }
    return this.database;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error("Appearance image storage could not be saved."));
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

  async saveBlobs(blobs: readonly Blob[]): Promise<string[]> {
    const ids = await Promise.all(blobs.map(imageId));
    await this.transaction("readwrite", async (store) => {
      for (let index = 0; index < blobs.length; index++)
        await request(store.put({ id: ids[index], blob: blobs[index], type: blobs[index].type,
          createdAt: Date.now() } satisfies ImageAsset));
    });
    return ids.map((id) => `${THEME_IMAGE_ASSET_PREFIX}${id}`);
  }

  readBlob(id: string): Promise<Blob | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) return Promise.resolve(null);
    return this.transaction("readonly", async (store) => {
      const asset = await request<ImageAsset | undefined>(store.get(id));
      return asset?.blob ?? null;
    });
  }

  async assertPresent(ids: ReadonlySet<string>): Promise<void> {
    if (!ids.size) return;
    const saved = await this.transaction("readonly", async (store) => request<IDBValidKey[]>(store.getAllKeys()));
    const available = new Set(saved.filter((id): id is string => typeof id === "string"));
    if ([...ids].some((id) => !available.has(id)))
      throw new Error("An Appearance image asset is missing. Choose the image again before saving.");
  }

  collect(usedIds: ReadonlySet<string>): Promise<void> {
    return this.transaction("readwrite", async (store) => {
      const saved = await request<IDBValidKey[]>(store.getAllKeys());
      for (const id of saved)
        if (typeof id === "string" && !usedIds.has(id)) await request(store.delete(id));
    });
  }
}

export const browserAppearanceImageStorage = new AppearanceImageStorage();

export async function storeThemeImageSource(
  source: string | null,
  storage: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<string | null> {
  if (!source?.startsWith("data:image/")) return source;
  return (await storage.saveBlobs([blobFromDataUrl(source)]))[0];
}

export async function storeThemeSnapshotImages(
  snapshot: ThemeSnapshot,
  storage: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<ThemeSnapshot> {
  const profile = snapshot.profile;
  const sources = [profile.wallpaper.source, ...Object.values(profile.icons), profile.dock.image];
  const inline = sources.map((source) => source?.startsWith("data:image/") ? source : null);
  const references = await storage.saveBlobs(inline.flatMap((source) => source ? [blobFromDataUrl(source)] : []));
  let next = 0;
  const storedBySource = new Map<string, string>();
  for (const source of inline)
    if (source) storedBySource.set(source, references[next++]);
  const replacement = (source: string | null) => source?.startsWith("data:image/") ? storedBySource.get(source)! : source;
  const icons = Object.fromEntries(Object.entries(profile.icons).map(([id, source]) => [id, replacement(source)]));
  return { ...snapshot, profile: { ...profile,
    wallpaper: { ...profile.wallpaper, source: replacement(profile.wallpaper.source) },
    icons,
    dock: { ...profile.dock, image: replacement(profile.dock.image) },
  } };
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Appearance image could not be exported."));
    reader.onerror = () => reject(new Error("Appearance image could not be exported."));
    reader.readAsDataURL(blob);
  });
}

export async function inlineThemeSnapshotImages(
  snapshot: ThemeSnapshot,
  storage: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<ThemeSnapshot> {
  const profile = snapshot.profile;
  const inline = async (source: string | null) => {
    const id = themeImageAssetId(source);
    if (!id) return source;
    const blob = await storage.readBlob(id);
    if (!blob) throw new Error("An Appearance image asset is missing and cannot be exported.");
    return blobDataUrl(blob);
  };
  const [wallpaper, dock, iconEntries] = await Promise.all([
    inline(profile.wallpaper.source), inline(profile.dock.image),
    Promise.all(Object.entries(profile.icons).map(async ([id, source]) => [id, await inline(source)] as const)),
  ]);
  return { ...snapshot, profile: { ...profile,
    wallpaper: { ...profile.wallpaper, source: wallpaper },
    dock: { ...profile.dock, image: dock },
    icons: Object.fromEntries(iconEntries),
  } };
}
