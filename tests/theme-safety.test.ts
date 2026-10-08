import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { AppearanceImageStorage, HOLDER_LEASE_MS, withThemeSnapshotImages } from "../lib/appearance-image-storage";
import { createThemeStorage, persistAppearanceImage } from "../lib/theme-storage";
import { ThemeImageUrls } from "../lib/theme-image-urls";
import { defaultSnapshot, themeImageAssetId, themeImageAssetIds, type ThemeDocument } from "../lib/theme-types";

const KEY = "companion-phone.appearance.v1";
const document = (): ThemeDocument => ({ version: 1, current: defaultSnapshot(), presets: [] });
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory);
  const peerImages = new AppearanceImageStorage(() => factory);
  return { values, storage, images, peerImages, themes: createThemeStorage(() => storage, images),
    peer: createThemeStorage(() => storage, peerImages) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("Theme loading is read-only; failed hydration cannot publish defaults or collect saved images", async () => {
  const { storage, images, themes } = fixture();
  await themes.save(document());
  const original = storage.getItem(KEY);
  const broken = createThemeStorage(() => ({ ...storage, getItem: () => { throw new Error("read failed"); } }), images);
  await assert.rejects(broken.load(), /read failed/);
  await assert.rejects(broken.transact(() => document()), /read failed/);
  assert.equal(storage.getItem(KEY), original);
  storage.setItem(KEY, "{invalid");
  await assert.rejects(themes.load(), /invalid/);
  assert.equal(storage.getItem(KEY), "{invalid");
});

test("concurrent Theme writers update the latest persisted authority, not stale snapshots", async () => {
  const { themes, peer } = fixture();
  await themes.save(document());
  await Promise.all([themes.load(), peer.load()]);
  await Promise.all([
    themes.transact((saved) => ({ ...saved, current: { ...saved.current,
      profile: { ...saved.current.profile, colors: { ...saved.current.profile.colors, accent: "#112233" } } } })),
    peer.transact((saved) => ({ ...saved, current: { ...saved.current,
      profile: { ...saved.current.profile, text: { ...saved.current.profile.text, size: 19 } } } })),
  ]);
  const saved = await themes.load();
  assert.equal(saved.current.profile.colors.accent, "#112233");
  assert.equal(saved.current.profile.text.size, 19);
});

test("cross-client collection preserves staged uploads until publication, and saved preset references afterward", async () => {
  const { themes, peer, images, peerImages } = fixture();
  await themes.save(document());
  const entered = deferred<string>();
  const resume = deferred<void>();
  const uploading = persistAppearanceImage("data:image/png;base64,AQIDBA==", async (source) => {
    entered.resolve(source!);
    await resume.promise;
    await themes.transact((saved) => ({ ...saved, current: { ...saved.current,
      profile: { ...saved.current.profile, wallpaper: { ...saved.current.profile.wallpaper, source } } } }));
  }, images);
  const reference = await entered.promise;
  await peer.transact((saved) => saved); // another tab saves and runs GC while upload is staged
  assert(await peerImages.readBlob(themeImageAssetId(reference)!));
  resume.resolve();
  await uploading;
  await peer.transact((saved) => ({ ...saved, current: defaultSnapshot(),
    presets: [{ id: "saved", name: "Saved", snapshot: saved.current }] }));
  assert(await images.readBlob(themeImageAssetId(reference)!));
  await themes.transact((saved) => ({ ...saved, presets: [] }));
  assert.equal(await images.readBlob(themeImageAssetId(reference)!), null);
});

test("independent staged owners and imported references survive peer GC; unreadable authority aborts GC", async () => {
  const { images, peerImages, themes } = fixture();
  const blob = new Blob(["image"], { type: "image/png" });
  const first = await images.stageBlobs([blob]);
  const second = await peerImages.stageBlobs([blob]);
  const id = themeImageAssetId(first.references[0])!;
  await first.release();
  await images.collect(() => new Set());
  assert(await images.readBlob(id));
  await second.release();
  await assert.rejects(images.collect(() => { throw new Error("authority unavailable"); }));
  assert(await images.readBlob(id));
  const snapshot = { ...defaultSnapshot(), profile: { ...defaultSnapshot().profile,
    wallpaper: { ...defaultSnapshot().profile.wallpaper, source: first.references[0] } } };
  await withThemeSnapshotImages(snapshot, async (stored) => {
    await peerImages.collect(() => new Set());
    assert(await images.readBlob(id));
    await themes.save({ ...document(), current: stored });
  }, images);
  await peerImages.collect(() => themeImageAssetIds({ ...document(), current: snapshot }));
  assert(await images.readBlob(id));
});

test("disposed image owner never creates an Object URL after its pending read completes", async () => {
  const pending = deferred<Blob | null>();
  const created: string[] = [], revoked: string[] = [];
  const urls = new ThemeImageUrls(() => pending.promise,
    () => { created.push("blob:late"); return "blob:late"; }, (url) => { revoked.push(url); });
  const saved = document();
  saved.current.profile.wallpaper.source = `appearance-asset:${"a".repeat(64)}`;
  const reading = urls.sync(saved);
  urls.dispose();
  pending.resolve(new Blob(["late"]));
  assert.equal(await reading, null);
  assert.deepEqual(created, []);
  assert.deepEqual(revoked, []);
});

test("superseded image owner revokes unfinished URLs and keeps only the latest published URLs", async () => {
  const pending = deferred<Blob | null>();
  const created: string[] = [], revoked: string[] = [];
  const urls = new ThemeImageUrls(async (id) => id === "b".repeat(64) ? pending.promise : new Blob([id]),
    () => { const url = `blob:${created.length}`; created.push(url); return url; }, (url) => { revoked.push(url); });
  const old = document();
  old.current.profile.wallpaper.source = `appearance-asset:${"a".repeat(64)}`;
  old.current.profile.dock.image = `appearance-asset:${"b".repeat(64)}`;
  const reading = urls.sync(old);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(created, ["blob:0"]);
  const latest = document();
  latest.current.profile.wallpaper.source = `appearance-asset:${"c".repeat(64)}`;
  const published = await urls.sync(latest);
  pending.resolve(new Blob(["late"]));
  assert.equal(await reading, null);
  assert.deepEqual(Object.values(published!), ["blob:1"]);
  assert.deepEqual(revoked, ["blob:0"]);
  urls.dispose();
  assert.deepEqual(revoked, ["blob:0", "blob:1"]);
});

test("a staging holder left by an interrupted owner stops pinning its image after the lease", async () => {
  let clock = 1_000;
  const factory = new IDBFactory();
  const images = new AppearanceImageStorage(() => factory, () => clock);
  const staged = await images.stageBlobs([new Blob(["image"], { type: "image/png" })]);
  const id = themeImageAssetId(staged.references[0])!;
  // The owner never calls release(): its tab closed mid-publication.
  clock += HOLDER_LEASE_MS - 1;
  await images.collect(() => new Set());
  assert(await images.readBlob(id), "a live holder still protects the image");
  clock += 2;
  await images.collect(() => new Set());
  assert.equal(await images.readBlob(id), null, "an expired holder no longer pins the blob");
});
