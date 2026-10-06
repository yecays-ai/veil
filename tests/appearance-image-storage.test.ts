import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { AppearanceImageStorage, storeThemeSnapshotImages } from "../lib/appearance-image-storage";
import { createThemeStorage, persistAppearanceImage } from "../lib/theme-storage";
import { defaultSnapshot, type ThemeDocument } from "../lib/theme-types";
import { themeImageAssetId } from "../lib/theme-types";
import type { StringStorage } from "../lib/storage-types";

class MemoryStorage implements StringStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

async function countAssets(factory: IDBFactory) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("veil-appearance-images-v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<number>((resolve, reject) => {
    const transaction = database.transaction("assets", "readonly");
    const request = transaction.objectStore("assets").count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const image = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
const dataUrl = "data:image/png;base64,AQIDBA==";

test("Appearance saves image blobs separately and reloads lightweight references", async () => {
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const reference = (await images.saveBlobs([image()]))[0];
  const document: ThemeDocument = { version: 1, current: { ...defaultSnapshot(), profile: {
    ...defaultSnapshot().profile, wallpaper: { ...defaultSnapshot().profile.wallpaper, source: reference },
  } }, presets: [] };
  const storage = new MemoryStorage();
  const themes = createThemeStorage(() => storage, images);
  await themes.save(document);
  assert(!storage.getItem("companion-phone.appearance.v1")?.includes("data:image/"));
  assert(storage.getItem("companion-phone.appearance.v1")?.includes(reference));
  assert.deepEqual(await themes.load(), document);
  const blob = await images.readBlob(themeImageAssetId(reference)!);
  assert.deepEqual([...new Uint8Array(await blob!.arrayBuffer())], [1, 2, 3, 4]);
});

test("snapshots share image references and GC waits for the final reference", async () => {
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const [reference] = await images.saveBlobs([image()]);
  const snapshot = { ...defaultSnapshot(), profile: { ...defaultSnapshot().profile,
    wallpaper: { ...defaultSnapshot().profile.wallpaper, source: reference } } };
  const storage = new MemoryStorage();
  const themes = createThemeStorage(() => storage, images);
  const shared: ThemeDocument = { version: 1, current: snapshot,
    presets: [{ id: "a", name: "A", snapshot }, { id: "b", name: "B", snapshot }] };
  await themes.save(shared);
  assert.equal(await countAssets(factory), 1);

  await themes.save({ ...shared, presets: [shared.presets[1]] });
  assert(await images.readBlob(themeImageAssetId(reference)!));
  await themes.save({ ...shared, current: defaultSnapshot(), presets: [] });
  assert.equal(await images.readBlob(themeImageAssetId(reference)!), null);
  assert.equal(await countAssets(factory), 0);
});

test("imported theme image data is stored once and translated to an asset reference", async () => {
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const snapshot = { ...defaultSnapshot(), profile: { ...defaultSnapshot().profile,
    wallpaper: { ...defaultSnapshot().profile.wallpaper, source: dataUrl },
    dock: { ...defaultSnapshot().profile.dock, image: dataUrl },
  } };
  const stored = await storeThemeSnapshotImages(snapshot, images);
  assert.match(stored.profile.wallpaper.source ?? "", /^appearance-asset:[a-f0-9]{64}$/);
  assert.equal(stored.profile.wallpaper.source, stored.profile.dock.image);
  assert.equal(await countAssets(factory), 1);
});

test("imported image references stay paired with their original Theme fields", async () => {
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const otherDataUrl = "data:image/png;base64,AgMEBQ==";
  const snapshot = { ...defaultSnapshot(), profile: { ...defaultSnapshot().profile,
    wallpaper: { ...defaultSnapshot().profile.wallpaper, source: dataUrl },
    icons: { messages: otherDataUrl },
    dock: { ...defaultSnapshot().profile.dock, image: "data:image/png;base64,BQYHCA==" },
  } };

  const stored = await storeThemeSnapshotImages(snapshot, images);
  const bytes = async (source: string | undefined) => {
    const id = themeImageAssetId(source);
    const blob = id ? await images.readBlob(id) : null;
    return blob ? [...new Uint8Array(await blob.arrayBuffer())] : null;
  };
  assert.deepEqual(await bytes(stored.profile.wallpaper.source ?? undefined), [1, 2, 3, 4]);
  assert.deepEqual(await bytes(stored.profile.icons.messages), [2, 3, 4, 5]);
  assert.deepEqual(await bytes(stored.profile.dock.image ?? undefined), [5, 6, 7, 8]);
});

test("asset write failure never applies a theme reference", async () => {
  const failed = new AppearanceImageStorage(() => { throw new Error("unavailable"); });
  const storage = new MemoryStorage();
  const themes = createThemeStorage(() => storage, failed);
  const before = await themes.load();
  let applied = false;
  await assert.rejects(() => persistAppearanceImage(dataUrl, async (reference) => {
    applied = true;
    await themes.save({ ...before, current: { ...before.current, profile: {
      ...before.current.profile, wallpaper: { ...before.current.profile.wallpaper, source: reference },
    } } });
  }, failed));
  assert.equal(applied, false);
  assert.equal(storage.getItem("companion-phone.appearance.v1"), null);
  assert.equal((await themes.load()).current.profile.wallpaper.source, null);
});

test("failed Theme document write preserves the prior document and collects its new orphan image", async () => {
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const storage = new MemoryStorage();
  const themes = createThemeStorage(() => storage, images);
  const before = await themes.load();
  await themes.save(before);
  const [reference] = await images.saveBlobs([image()]);
  storage.failWrites = true;
  await assert.rejects(() => themes.save({ ...before, current: { ...before.current,
    profile: { ...before.current.profile, wallpaper: { ...before.current.profile.wallpaper, source: reference } } } }));
  storage.failWrites = false;
  assert.deepEqual(await themes.load(), before);
  assert.equal(await images.readBlob(themeImageAssetId(reference)!), null);
});
