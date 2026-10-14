import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { AppearanceImageStorage } from "../lib/appearance-image-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { ChatStorage } from "../lib/chat/storage";
import { createBindingStorage } from "../lib/binding-storage";
import { createContactStorage } from "../lib/contact-storage";
import { createPresetStorage } from "../lib/preset-storage";
import { createRegexStorage } from "../lib/regex-storage";
import { createWorldBookStorage, deleteWorldBookAndBindings } from "../lib/worldbook-storage";
import { createThemeStorage } from "../lib/theme-storage";
import { createPresenceStorage } from "../lib/presence/storage";
import { BackupCoordinator } from "../lib/backup/coordination";
import { BackupValidationError } from "../lib/backup/format";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { createUnitWriters, digestUnits, recoverRestore, replaceWithBackup, restoreIntoEmpty, RESTORE_JOURNAL_KEY } from "../lib/backup/restore";
import { previewRestore } from "../lib/backup/restore-preview";
import { createSafetyCopyStore } from "../lib/backup/safety-copy";
import { packageFixtureWithImages } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const blocked = (error: unknown) => error instanceof BackupValidationError && error.code === "restore-in-progress";

async function setup() {
  const origin = lockOrigin(), locks = origin.client(), factory = new IDBFactory(), raw = new Map<string, string>();
  const storage = { getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); },
    removeItem: (key: string) => { raw.delete(key); } };
  const device = { indexedDB: factory, localStorage: storage };
  const fixture = await packageFixtureWithImages(), pack = { manifestJson: JSON.stringify(fixture.manifest), files: fixture.files };
  await restoreIntoEmpty(pack.manifestJson, pack.files, device, locks);
  // These instances and connections belong to a tab that was already open before the interruption.
  const gate = createPersistenceWriteGate(() => origin.client(), () => storage), getFactory = () => factory, noLocks = () => undefined;
  const core = new IndexedDBDocumentStorage(getFactory, gate), chat = new ChatStorage(getFactory, noLocks, gate);
  const api = new ApiConfigStorage(getFactory, gate), images = new AppearanceImageStorage(getFactory, Date.now, gate);
  const bindings = createBindingStorage(() => storage, noLocks, gate), contacts = createContactStorage(() => storage, noLocks, gate);
  const presets = createPresetStorage(() => storage, gate), regex = createRegexStorage(() => storage, gate);
  const books = createWorldBookStorage(() => storage, gate), presence = createPresenceStorage(() => storage, noLocks, gate);
  const theme = createThemeStorage(() => storage, images);
  await core.read("foundation"); await chat.listSessions();
  const imageId = fixture.manifest.assets.find((asset) => asset.domain === "appearance")!.id;
  assert.ok(await images.readBlob(imageId), "the old tab's image connection is open before interruption");
  const config = (await api.listApiConfigs())[0];
  await api.saveApiConfig({ ...config, name: "Original simulated config", apiKey: "SIMULATED_ORIGINAL_KEY" });
  await chat.send("character:peter", "original simulated device message");
  await contacts.transact((doc) => ({ ...doc, contacts: [] }));
  const original = await readStaticBackupSource(device);
  const attempts: Record<string, () => Promise<unknown>> = {
    core: () => core.putIfAbsent("intruder", "simulated"), chat: () => chat.send("character:peter", "late old-tab write"),
    api: () => api.saveApiConfig({ ...config, name: "Late change" }), images: () => images.replaceAllAssets([]),
    bindings: () => bindings.transact((doc) => ({ ...doc, global: {} })), contacts: () => contacts.transact((doc) => doc),
    presets: () => presets.transact((doc) => doc), regex: () => regex.transact((doc) => doc),
    books: () => books.transact((doc) => doc), presence: () => presence.transact((doc) => doc),
    theme: () => theme.transact((doc) => doc),
    "resource-delete": () => deleteWorldBookAndBindings("book-test", books, bindings, undefined, undefined, gate),
  };
  async function interrupt(options: { hold?: ReturnType<typeof deferred>; entered?: ReturnType<typeof deferred> } = {}) {
    const confirmed = await previewRestore(pack.manifestJson, pack.files, device, locks), writers = createUnitWriters(device);
    let chatWrites = 0;
    await assert.rejects(replaceWithBackup(pack.manifestJson, pack.files, device, locks, { confirmed, newId: () => "f3-test", writers: {
      ...writers, contacts: { ...writers.contacts, write: async () => {
        options.entered?.resolve(); if (options.hold) await options.hold.promise;
        throw new Error("deterministic interruption");
      } }, chat: { ...writers.chat, write: async (snapshot) => {
        if (++chatWrites > 1) throw new Error("interrupted rollback");
        await writers.chat.write(snapshot);
      } },
    } }));
    assert.ok(raw.has(RESTORE_JOURNAL_KEY));
  }
  return { origin, locks, device, raw, storage, gate, pack, original, attempts, interrupt };
}

for (const domain of ["core", "chat", "api", "images", "bindings", "contacts", "presets", "regex", "books", "presence", "theme", "resource-delete"]) {
  test(`already-open ${domain} writer cannot commit after a restore interruption`, async () => {
    const env = await setup(); await env.interrupt();
    const before = await digestUnits(await readStaticBackupSource(env.device)), raw = new Map(env.raw);
    await assert.rejects(env.attempts[domain](), blocked);
    assert.deepEqual(await digestUnits(await readStaticBackupSource(env.device)), before);
    assert.deepEqual(env.raw, raw);
  });
}

for (const action of ["resume", "rollback"] as const) test(`interruption → rejected old-tab write → ${action} preserves complete data and unlocks later writes`, async () => {
  const env = await setup(); await env.interrupt();
  await assert.rejects(env.attempts.chat(), blocked);
  await recoverRestore(action, env.device, env.locks, action === "resume" ? env.pack : null);
  assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false);
  assert.equal(await createSafetyCopyStore(env.device.indexedDB).load("f3-test"), null);
  const expected = action === "rollback" ? env.original : await (async () => {
    const fixture = await packageFixtureWithImages();
    const { snapshotFromBackup } = await import("../lib/backup/restore");
    const { validateBackupPackage } = await import("../lib/backup/validation");
    return snapshotFromBackup(await validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files), fixture.files);
  })();
  const actual = await readStaticBackupSource(env.device);
  assert.deepEqual(await digestUnits(actual), await digestUnits(expected));
  assert.deepEqual(actual.apiConfigs, expected.apiConfigs);
  await env.attempts.contacts();
  await env.attempts.api();
});

test("writer queued behind restoration rechecks the persisted journal after the exclusive lock releases", async () => {
  const env = await setup(), entered = deferred(), hold = deferred();
  const restoring = env.interrupt({ entered, hold }); await entered.promise;
  const rejected = assert.rejects(env.attempts.contacts(), blocked);
  hold.resolve(); await restoring; await rejected;
  assert.ok(env.raw.has(RESTORE_JOURNAL_KEY));
});

test("an already-started shared write finishes before the restore can establish its journal", async () => {
  const env = await setup(), entered = deferred(), hold = deferred();
  const writing = env.gate.withWrite(async () => { entered.resolve(); await hold.promise; assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false); });
  await entered.promise;
  const exclusive = new BackupCoordinator(env.locks).withSnapshot(async () => {
    env.raw.set(RESTORE_JOURNAL_KEY, "simulated pending journal");
  });
  assert.equal(env.raw.has(RESTORE_JOURNAL_KEY), false);
  hold.resolve(); await writing; await exclusive;
  await assert.rejects(env.attempts.contacts(), blocked);
});

test("missing locks still reject pending journals; unreadable status fails closed; clearing status permits writes", async () => {
  let journal: string | null = "malformed journal", unavailable = false, writes = 0;
  const gate = createPersistenceWriteGate(() => undefined, () => ({ getItem: () => { if (unavailable) throw new Error("private native data"); return journal; } }));
  await assert.rejects(gate.withWrite(async () => { writes++; }), blocked);
  journal = null; unavailable = true;
  await assert.rejects(gate.withWrite(async () => { writes++; }), (error) => error instanceof BackupValidationError && error.code === "restore-state-unavailable");
  unavailable = false; await gate.withWrite(async () => { writes++; });
  assert.equal(writes, 1);
});
