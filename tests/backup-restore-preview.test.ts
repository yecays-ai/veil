import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate, withPersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { previewRestore, restorePreviewChanged } from "../lib/backup/restore-preview";
import { BackupValidationError } from "../lib/backup/format";
import { acquireGenerationLock } from "../lib/chat/generation-lock";
import { lockOrigin } from "./generation-lock-fixture";
import { buildWorld } from "./character-deletion-fixture";
import { backupData, packageFixture, replacePayload, TEST_NOW, type Fixture } from "./backup-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function fixture() {
  const origin = lockOrigin(), manager = origin.client() as unknown as BackupLockManager;
  const gate = createPersistenceWriteGate(() => manager);
  const world = await buildWorld({ gate });
  await world.bindingStore.transact(() => ({ global: {}, characters: {} }));
  const source = { indexedDB: world.factory, localStorage: { getItem: (key: string) => world.raw.get(key) ?? null } };
  const emptyFactory = new IDBFactory();
  const empty = { indexedDB: emptyFactory, localStorage: { getItem: () => null } };
  const pack = async (backup?: Fixture) => { const f = backup ?? await packageFixture(); return [JSON.stringify(f.manifest), f.files] as const; };
  const markGeneration = async (sessionId: string) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = world.factory.open("veil-chat-v2"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite"), store = tx.objectStore("sessions");
      store.get(sessionId).onsuccess = (event) => store.put({ ...(event.target as IDBRequest).result, generation: { id: "attempt-1", stage: "provider" } });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  };
  return { origin, manager, gate, world, source, empty, emptyFactory, pack, markGeneration };
}

test("an empty device is empty-restore, counts line up, and the precheck creates nothing there", async () => {
  const { manager, empty, emptyFactory, pack } = await fixture();
  const [manifest, files] = await pack();
  const preview = await previewRestore(manifest, files, empty, manager, { now: () => TEST_NOW });
  assert.equal(preview.mode, "empty-restore");
  assert.equal(preview.target, "empty");
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.capturedAt, TEST_NOW);
  assert.equal(preview.backupId, "simulated-backup");
  assert.equal(preview.domains.foundation?.backup, 1);
  assert.equal(preview.domains.foundation?.current, 0);
  assert.equal(preview.domains.chat?.backup, 7);
  assert.ok(preview.warnings.some((warning) => warning.code === "credentials-required"), "API keys must be re-entered");
  assert.deepEqual(await emptyFactory.databases(), [], "reading an empty device does not create a database");
});

test("a device with data needs an explicit replace, never a merge", async () => {
  const { manager, source, pack } = await fixture();
  const [manifest, files] = await pack();
  const preview = await previewRestore(manifest, files, source, manager);
  assert.equal(preview.mode, "replace-required");
  assert.equal(preview.target, "has-data");
  assert.deepEqual(preview.blockers, []);
  assert.ok((preview.domains.chat?.current ?? 0) > 0);
});

test("the report is a point-in-time snapshot: any change on the device makes it stale", async () => {
  const { manager, source, world, pack } = await fixture();
  const [manifest, files] = await pack();
  const first = await previewRestore(manifest, files, source, manager);
  assert.equal(restorePreviewChanged(first, await previewRestore(manifest, files, source, manager)), false);
  // A write that changes no count still changes the digest.
  await world.themeStore.transact((theme) => ({ ...theme, current: { ...theme.current, profile: { ...theme.current.profile,
    colors: { ...theme.current.profile.colors, accent: "#123456" } } } }));
  assert.equal(restorePreviewChanged(first, await previewRestore(manifest, files, source, manager)), true);
});

test("a live reply, a crash-leftover marker and a marker inside the package are three different blockers", async () => {
  const { origin, manager, source, world, pack, markGeneration, empty } = await fixture();
  const sessionId = world.ids.sessionA.id;
  const [manifest, files] = await pack();
  await markGeneration(sessionId);

  const stale = await previewRestore(manifest, files, source, manager);
  assert.equal(stale.mode, "blocked");
  assert.deepEqual(stale.blockers.map((b) => b.code), ["local-generation-stale"]);

  const reply = await acquireGenerationLock(world.factory, sessionId, origin.client() as unknown as LockManager);
  assert.ok(reply);
  const live = await previewRestore(manifest, files, source, manager);
  assert.deepEqual(live.blockers.map((b) => b.code), ["local-generation-active"]);
  await reply!();

  const damaged = await packageFixture(), data = backupData();
  await replacePayload(damaged, "chat", { ...data.chat, sessions: data.chat.sessions.map((s, i) => i ? s : { ...s, generation: { id: "x", stage: "provider" } }) });
  const [damagedManifest, damagedFiles] = await pack(damaged);
  const inPackage = await previewRestore(damagedManifest, damagedFiles, empty, manager);
  assert.equal(inPackage.mode, "blocked");
  assert.deepEqual(inPackage.blockers.map((b) => b.code), ["backup-generation-marker"]);
  assert.equal(inPackage.target, "unknown", "an unusable package is not compared with the device");
});

test("other package failures stay backup-invalid and keep the validation code", async () => {
  const { manager, empty } = await fixture();
  const broken = await packageFixture();
  broken.files.set("domains/foundation.json", new TextEncoder().encode(JSON.stringify({ tampered: true })));
  const preview = await previewRestore(JSON.stringify(broken.manifest), broken.files, empty, manager);
  assert.equal(preview.mode, "blocked");
  assert.equal(preview.blockers[0].code, "backup-invalid");
  assert.ok("error" in preview.blockers[0] && preview.blockers[0].error.length > 0);
});

test("an unreadable device is reported, not assumed empty", async () => {
  const { manager, pack, emptyFactory } = await fixture();
  await new Promise<void>((resolve, reject) => {
    const request = emptyFactory.open("veil-chat-v2", 9); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  const [manifest, files] = await pack();
  const preview = await previewRestore(manifest, files, { indexedDB: emptyFactory, localStorage: { getItem: () => null } }, manager);
  assert.equal(preview.mode, "blocked");
  assert.equal(preview.target, "unknown");
  assert.equal(preview.blockers[0].code, "target-unreadable");
  assert.equal(preview.targetDigest, null);
});

test("the device is read inside the exclusive snapshot lock, and coordination errors keep their codes", async () => {
  const { manager, gate, source, pack } = await fixture();
  const [manifest, files] = await pack();
  const entered = deferred(), finish = deferred();
  const writing = withPersistenceWriteScope(gate, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  let done = false;
  const previewing = previewRestore(manifest, files, source, manager).then((value) => { done = true; return value; });
  await settle();
  assert.equal(done, false, "the precheck waits for the in-flight logical write");
  finish.resolve(); await writing;
  assert.equal((await previewing).mode, "replace-required");
  await assert.rejects(previewRestore(manifest, files, source, undefined),
    (error) => error instanceof BackupValidationError && error.code === "coordination-unavailable");
});

test("a report is also stale when the package counts change under the same backup id", async () => {
  const { manager, empty, pack } = await fixture();
  const [manifest, files] = await pack();
  const first = await previewRestore(manifest, files, empty, manager);
  const edited = { ...first, domains: { ...first.domains, chat: { backup: 99, current: 0 } } };
  assert.equal(restorePreviewChanged(first, edited), true);
  assert.equal(restorePreviewChanged(first, { ...first, assets: null }), true);
});
