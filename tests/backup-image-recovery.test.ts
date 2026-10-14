import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createUnitWriters, recoverRestore, replaceWithBackup, restoreIntoEmpty, RESTORE_JOURNAL_KEY,
  type RestoreDevice } from "../lib/backup/restore";
import { previewRestore } from "../lib/backup/restore-preview";
import { readStaticBackupSource, type StaticBackupSnapshot } from "../lib/backup/static-source";
import { createSafetyCopyStore } from "../lib/backup/safety-copy";
import { packageFixtureWithImages, replacePayload, sha256 } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";

function device() {
  const raw = new Map<string, string>();
  const target: RestoreDevice = { indexedDB: new IDBFactory(), localStorage: {
    getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); }, removeItem: (k) => { raw.delete(k); },
  } };
  return { target, raw };
}
async function pictures(snapshot: StaticBackupSnapshot) {
  const rows = async (assets: unknown[]) => Promise.all(assets.map(async (asset) => {
    const { blob, ...metadata } = asset as { id: string; blob: Blob };
    return { ...metadata, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  }));
  return { appearance: await rows(snapshot.appearanceAssets), chat: await rows(snapshot.chat.assets) };
}
const pack = (f: Awaited<ReturnType<typeof packageFixtureWithImages>>) => ({ manifestJson: JSON.stringify(f.manifest), files: f.files });

for (const action of ["resume", "rollback"] as const) {
  test(`empty restore with both image domains can ${action} after a persisted rollback interruption`, async () => {
    const { target, raw } = device(), locks = lockOrigin().client(), archive = pack(await packageFixtureWithImages());
    const writers = createUnitWriters(target);
    await assert.rejects(restoreIntoEmpty(archive.manifestJson, archive.files, target, locks, { writers: { ...writers,
      presets: { ...writers.presets, write: async () => { throw new Error("injected write"); } },
      appearanceAssets: { ...writers.appearanceAssets, clear: async () => { throw new Error("interrupted rollback"); } },
    } }));
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), true);
    assert.equal((await readStaticBackupSource(target)).appearanceAssets.length, 1);
    await recoverRestore(action, target, lockOrigin().client(), action === "resume" ? archive : null);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
    if (action === "rollback") assert.deepEqual(await pictures(await readStaticBackupSource(target)), { appearance: [], chat: [] });
    else {
      const clean = device().target;
      await restoreIntoEmpty(archive.manifestJson, archive.files, clean, locks);
      assert.deepEqual(await pictures(await readStaticBackupSource(target)), await pictures(await readStaticBackupSource(clean)));
    }
  });
}

for (const action of ["resume", "rollback"] as const) {
  test(`replace safety copy preserves image bytes through interrupted ${action}`, async () => {
    const { target, raw } = device(), locks = lockOrigin().client();
    const first = pack(await packageFixtureWithImages());
    await restoreIntoEmpty(first.manifestJson, first.files, target, locks);
    const original = await pictures(await readStaticBackupSource(target));
    const f = await packageFixtureWithImages();
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const hash = await sha256(bytes);
    for (const asset of f.manifest.assets) {
      asset.sha256 = hash; asset.bytes = bytes.length;
      // This PR exercises interruption recovery with observably different unit metadata.
      // Same-metadata/different-byte recovery is tracked as a separate digest defect.
      asset.createdAt++;
      if (asset.domain === "appearance") asset.id = hash;
      f.files.set(asset.path, bytes);
    }
    const appearance = JSON.parse(new TextDecoder().decode(f.files.get("domains/appearance.json")));
    appearance.current.profile.wallpaper.source = `appearance-asset:${hash}`;
    await replacePayload(f, "appearance", appearance);
    const archive = pack(f), confirmed = await previewRestore(archive.manifestJson, archive.files, target, locks);
    const writers = createUnitWriters(target);
    let appearanceWrites = 0;
    await assert.rejects(replaceWithBackup(archive.manifestJson, archive.files, target, locks, { confirmed, newId: () => "image-recovery-test",
      writers: { ...writers,
        appearance: { ...writers.appearance, write: async () => { throw new Error("injected write"); } },
        appearanceAssets: { ...writers.appearanceAssets, write: async (snapshot) => {
          if (++appearanceWrites > 1) throw new Error("interrupted rollback");
          await writers.appearanceAssets.write(snapshot);
        } },
      } }));
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), true);
    const copy = await createSafetyCopyStore(target.indexedDB).load("image-recovery-test");
    assert.ok(copy);
    assert.deepEqual(await pictures(copy), original);
    assert.notDeepEqual(await pictures(await readStaticBackupSource(target)), original);
    await recoverRestore(action, target, lockOrigin().client(), action === "resume" ? archive : null);
    assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
    assert.equal(await createSafetyCopyStore(target.indexedDB).load("image-recovery-test"), null);
    if (action === "rollback") assert.deepEqual(await pictures(await readStaticBackupSource(target)), original);
    else {
      const clean = device().target;
      await restoreIntoEmpty(archive.manifestJson, archive.files, clean, locks);
      assert.deepEqual(await pictures(await readStaticBackupSource(target)), await pictures(await readStaticBackupSource(clean)));
    }
  });
}
