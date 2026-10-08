import {
  THEME_IMAGE_ASSET_PREFIX,
  themeImageAssetId,
  type ThemeSnapshot,
} from "./theme-types";

export const APPEARANCE_IMAGE_DATABASE_NAME = "veil-appearance-images-v1";
export const APPEARANCE_IMAGE_DATABASE_VERSION = 1;
const STORE = "assets";
type ImageAsset = { id: string; blob: Blob; type: string; createdAt: number; holders?: string[] };

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
    return this.writeBlobs(blobs);
  }

  private async writeBlobs(blobs: readonly Blob[], heldIds: readonly string[] = [], holder?: string): Promise<string[]> {
    const ids = await Promise.all(blobs.map(imageId));
    await this.transaction("readwrite", async (store) => {
      for (let index = 0; index < blobs.length; index++) {
        const previous = await request<ImageAsset | undefined>(store.get(ids[index]));
        await request(store.put({ id: ids[index], blob: blobs[index], type: blobs[index].type,
          createdAt: previous?.createdAt ?? Date.now(), holders: previous?.holders } satisfies ImageAsset));
      }
      if (holder) for (const id of new Set([...ids, ...heldIds])) {
        const asset = await request<ImageAsset | undefined>(store.get(id));
        if (!asset) throw new Error("An Appearance image asset is missing. Choose the image again before saving.");
        await request(store.put({ ...asset, holders: [...new Set([...(asset.holders ?? []), holder])] }));
      }
    });
    return ids.map((id) => `${THEME_IMAGE_ASSET_PREFIX}${id}`);
  }

  async stageBlobs(blobs: readonly Blob[], heldIds: readonly string[] = []) {
    const holder = crypto.randomUUID();
    const references = await this.writeBlobs(blobs, heldIds, holder);
    const ids = new Set([...references.map((reference) => themeImageAssetId(reference)!), ...heldIds]);
    return { references, release: () => this.transaction("readwrite", async (store) => {
      for (const id of ids) {
        const asset = await request<ImageAsset | undefined>(store.get(id));
        if (asset) await request(store.put({ ...asset, holders: asset.holders?.filter((value) => value !== holder) }));
      }
    }) };
  }

  // The existing asset transaction serializes Theme publication and collection across tabs.
  // publish is synchronous: no unrelated asynchronous work is performed inside the transaction.
  async publish<T>(publish: (available: ReadonlySet<string>) => T): Promise<T> {
    let published = false;
    let result!: T;
    try {
      await this.transaction("readwrite", async (store) => {
        const ids = await request<IDBValidKey[]>(store.getAllKeys());
        result = publish(new Set(ids.filter((id): id is string => typeof id === "string")));
        published = true;
      });
    } catch (error) {
      // No assets are changed in this transaction. Once synchronous localStorage publication
      // succeeded, a later transaction abort cannot undo that successful Theme write.
      if (!published) throw error;
    }
    return result;
  }

  readBlob(id: string): Promise<Blob | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) return Promise.resolve(null);
    return this.transaction("readonly", async (store) => {
      const asset = await request<ImageAsset | undefined>(store.get(id));
      return asset?.blob ?? null;
    });
  }

  collect(resolveUsedIds: () => ReadonlySet<string>): Promise<void> {
    return this.transaction("readwrite", async (store) => {
      const saved = await request<ImageAsset[]>(store.getAll());
      // Read the persisted authority while holding the same transaction lock as publishers.
      // Failure to read/parse references aborts collection rather than treating them as empty.
      const usedIds = resolveUsedIds();
      for (const asset of saved)
        if (!usedIds.has(asset.id) && !asset.holders?.length) await request(store.delete(asset.id));
    });
  }
}

export const browserAppearanceImageStorage = new AppearanceImageStorage();

export async function withThemeImageSource<T>(source: string | null, apply: (reference: string | null) => Promise<T>,
  storage: AppearanceImageStorage = browserAppearanceImageStorage): Promise<T> {
  const inline = source?.startsWith("data:image/");
  const id = themeImageAssetId(source);
  if (!inline && !id) return apply(source);
  const staged = await storage.stageBlobs(inline ? [blobFromDataUrl(source!)] : [], id ? [id] : []);
  try { return await apply(inline ? staged.references[0] : source); }
  finally { await staged.release().catch(() => {}); }
}

export async function storeThemeSnapshotImages(
  snapshot: ThemeSnapshot,
  storage: AppearanceImageStorage = browserAppearanceImageStorage,
): Promise<ThemeSnapshot> {
  return withThemeSnapshotImages(snapshot, async (stored) => stored, storage);
}

export async function withThemeSnapshotImages<T>(snapshot: ThemeSnapshot, apply: (stored: ThemeSnapshot) => Promise<T>,
  storage: AppearanceImageStorage = browserAppearanceImageStorage): Promise<T> {
  const profile = snapshot.profile;
  const sources = [profile.wallpaper.source, ...Object.values(profile.icons), profile.dock.image];
  const inline = sources.map((source) => source?.startsWith("data:image/") ? source : null);
  const staged = await storage.stageBlobs(inline.flatMap((source) => source ? [blobFromDataUrl(source)] : []),
    sources.flatMap((source) => { const id = themeImageAssetId(source); return id ? [id] : []; }));
  const references = staged.references;
  let next = 0;
  const storedBySource = new Map<string, string>();
  for (const source of inline)
    if (source) storedBySource.set(source, references[next++]);
  const replacement = (source: string | null) => source?.startsWith("data:image/") ? storedBySource.get(source)! : source;
  const icons = Object.fromEntries(Object.entries(profile.icons).map(([id, source]) => [id, replacement(source)]));
  const stored = { ...snapshot, profile: { ...profile,
    wallpaper: { ...profile.wallpaper, source: replacement(profile.wallpaper.source) },
    icons,
    dock: { ...profile.dock, image: replacement(profile.dock.image) },
  } };
  try { return await apply(stored); }
  finally { await staged.release().catch(() => {}); }
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
