import assert from "node:assert/strict";
import test from "node:test";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { exportStaticBackup } from "../lib/backup/static-export";
import { BACKUP_LOCAL_KEYS, readStaticBackupSource, type StaticBackupSource } from "../lib/backup/static-source";
import { validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError, type BackupData } from "../lib/backup/format";
import { normalizeWorldBookEntry } from "../lib/worldbook";
import { backupData, sha256, TEST_NOW } from "./backup-fixture";

const metadata = { backupId: "static-test", createdAt: TEST_NOW, sourceCommit: "e71eb9fbb0e5d2b8c93f652b0d159b506d45ba1f" };
const secret = "SIMULATED_API_KEY_DO_NOT_EXPORT";
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=", "base64"));
const blob = () => new Blob([png], { type: "image/png" });

for (const event of ["error", "blocked", "upgradeneeded"] as const) {
  test(`a rejected IndexedDB open (${event}) closes a late successful connection`, async () => {
    const indexedDB = new IDBFactory();
    let closes = 0, aborts = 0, reads = 0;
    const request = Object.assign(new EventTarget(), {
      onerror: null, onblocked: null, onupgradeneeded: null, onsuccess: null,
      result: { close() { closes++; }, transaction() { reads++; throw new Error("Unexpected read"); } },
      transaction: { abort() { aborts++; } },
    }) as unknown as IDBOpenDBRequest;
    indexedDB.databases = async () => [{ name: "veil-core-v1", version: 1 }];
    indexedDB.open = () => request;
    const pending = readStaticBackupSource({ indexedDB, localStorage: { getItem: () => null } });
    await Promise.resolve();
    const rejection = assert.rejects(pending, (error: unknown) =>
      error instanceof BackupValidationError && error.code === "source-unavailable");
    const failure = new Event(event);
    request[`on${event}`]?.call(request, failure as IDBVersionChangeEvent);
    request.dispatchEvent(failure);
    await rejection;
    request.onsuccess?.call(request, new Event("success"));
    assert.equal(closes, 1);
    assert.equal(reads, 0);
    assert.equal(aborts, event === "upgradeneeded" ? 1 : 0);
  });
}

/** Fixture writes happen before export; every database and credential is simulated. */
async function seed(factory: IDBFactory, name: string, stores: Record<string, unknown[]>, version = 1, key = "id") {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => { for (const store of Object.keys(stores)) request.result.createObjectStore(store, { keyPath: key }); };
    request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(Object.keys(stores), "readwrite");
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    for (const [store, rows] of Object.entries(stores)) for (const row of rows) tx.objectStore(store).put(row);
  });
  db.close();
}

/** Build four simulated stores and seven local keys, including both referenced and orphan images. */
async function environment() {
  const indexedDB = new IDBFactory(), data = backupData(), values = new Map<string, string>(), imageId = await sha256(png);
  data.foundation!.universe.relations = [{ id: "relation-test", characterAId: "peter", characterBId: "pep",
    kind: "friend", label: "Friends", aToBContext: "Test A", bToAContext: "Test B", sharedHistory: "Test history" }];
  data.foundation!.user.avatar = "data:image/png;base64," + Buffer.from(png).toString("base64");
  data.contacts!.contacts[0].heroBackground = data.foundation!.user.avatar;
  data.appearance!.current.profile.wallpaper.source = "appearance-asset:" + imageId;
  data.appearance!.presets[0].snapshot.profile.dock.image = "appearance-asset:" + imageId;
  data.appearance!.current.widgets[0].config = { hour12: false, showSeconds: false, characterId: "peter",
    comment: { characterId: "peter", text: "Test weather comment", generatedAt: new Date(TEST_NOW).toISOString() } };
  data.chat.sessions[0].backgroundImage = "chat-image-test";
  data.chat.messages[1].attemptId = "persisted-attempt";
  data.chat.worldBookStates[0].state = { cycle: 2, prefix: [], signature: "Test signature", entries: { "book-test:entry-test": { stickyUntil: 5 } } };
  data.worldbooks!.books[0].entries = [normalizeWorldBookEntry({ content: "Test world entry", name: "Entry" }, "entry-test")];
  for (const [domain, key] of Object.entries(BACKUP_LOCAL_KEYS)) values.set(key, JSON.stringify(data[domain as keyof BackupData]));
  values.set("veil.chat-first-paint-diagnostics", "1"); values.set("unrelated-app.secret", secret);
  await seed(indexedDB, "veil-core-v1", { documents: [{ key: "veil.foundation.v1", value: JSON.stringify(data.foundation), updatedAt: TEST_NOW }] }, 1, "key");
  await seed(indexedDB, "veil-chat-v2", { ...data.chat, assets: [
    { id: "chat-image-test", blob: blob(), createdAt: TEST_NOW }, { id: "chat-orphan", blob: blob(), createdAt: TEST_NOW - 1000 },
  ] });
  await seed(indexedDB, "veil-appearance-images-v1", { assets: [{ id: imageId, blob: blob(), type: "image/png", createdAt: TEST_NOW,
    holders: [{ id: "temporary-holder", at: TEST_NOW }] }] });
  await seed(indexedDB, "veil-api-config-v1", { configs: data.apiConfigs.map((row) => ({ ...row, apiKey: secret })) });
  const reads: string[] = [];
  const source: StaticBackupSource = { indexedDB, localStorage: { getItem(key) { reads.push(key); return values.get(key) ?? null; } } };
  return { source, data, values, reads, imageId };
}

/** Compare logical record arrays by primary key; message sequence is carried by its order field. */
function byId(data: BackupData) {
  const result = structuredClone(data);
  for (const rows of Object.values(result.chat)) rows.sort((a, b) => a.id.localeCompare(b.id));
  result.apiConfigs.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

test("four databases and seven keys round-trip through v1 validation with all owned data and image bytes", async () => {
  const env = await environment(), before = await readStaticBackupSource(env.source);
  env.reads.length = 0;
  const localBefore = new Map(env.values), catalogBefore = await env.source.indexedDB.databases();
  const original = IDBDatabase.prototype.transaction, modes: IDBTransactionMode[] = [];
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    modes.push(args[1] ?? "readonly"); assert.equal(args[1], "readonly");
    return original.apply(this, args);
  };
  let result;
  try { result = await exportStaticBackup(env.source, metadata); }
  finally { IDBDatabase.prototype.transaction = original; }
  assert.equal(modes.length, 4); assert.equal(env.reads.length, 7);
  assert.deepEqual(new Set(env.reads), new Set(Object.values(BACKUP_LOCAL_KEYS)));
  assert.deepEqual(env.values, localBefore); assert.deepEqual(await env.source.indexedDB.databases(), catalogBefore);
  assert.deepEqual(await readStaticBackupSource(env.source), before);
  const checked = await validateBackupPackage(result.manifestJson, result.files);
  assert.deepEqual(byId(checked.data), byId(env.data));
  assert.equal(checked.manifest.assets.length, 3); // Includes the orphan chat image; no collection runs.
  for (const asset of checked.manifest.assets) assert.deepEqual(result.files.get(asset.path), png);
  assert(checked.manifest.assets.some((row) => row.id === env.imageId));
  assert(checked.manifest.assets.some((row) => row.id === "chat-orphan"));
  const output = result.manifestJson + [...result.files.values()].map((bytes) => new TextDecoder().decode(bytes)).join("");
  assert.equal(output.includes(secret), false); assert.equal(output.includes('"apiKey"'), false);
  assert.equal(output.includes("temporary-holder"), false); assert.equal(output.includes("unrelated-app"), false);
  assert.deepEqual(result.warnings, [{ code: "credentials-required", path: "apiConfigs[0]" }]);
});

test("exporting an empty environment neither creates databases nor writes default documents", async () => {
  const indexedDB = new IDBFactory(), requested: string[] = [];
  indexedDB.open = () => { throw new Error("Must not create a missing database"); };
  const result = await exportStaticBackup({ indexedDB, localStorage: { getItem(key) { requested.push(key); return null; } } }, metadata);
  const checked = await validateBackupPackage(result.manifestJson, result.files);
  assert.deepEqual(await indexedDB.databases(), []); assert.equal(requested.length, 7);
  assert.equal(checked.data.foundation, null); assert.equal(checked.data.appearance, null); assert.equal(checked.data.presets, null);
  assert.deepEqual(checked.data.chat, { sessions: [], messages: [], chatSettings: [], worldBookStates: [] });
});

test("the same fixed authorities and metadata produce the same bytes, IDs and counts", async () => {
  const env = await environment(), first = await exportStaticBackup(env.source, metadata), second = await exportStaticBackup(env.source, metadata);
  assert.equal(second.manifestJson, first.manifestJson); assert.deepEqual(second.files, first.files);
  const manifest = JSON.parse(first.manifestJson);
  const chat = manifest.domains.find((row: { domain: string }) => row.domain === "chat");
  assert.equal(chat.records, Object.values(env.data.chat).reduce((sum, rows) => sum + rows.length, 0));
});

test("a read failure or malformed source cannot return a partial successful package or expose secrets", async () => {
  for (const kind of ["local-read", "bad-json", "database-read", "asset-read"] as const) {
    const env = await environment(), originalGetAll = IDBObjectStore.prototype.getAll, originalArrayBuffer = Blob.prototype.arrayBuffer;
    if (kind === "local-read") env.source.localStorage.getItem = () => { throw new Error(secret); };
    if (kind === "bad-json") env.values.set("veil.contacts.v1", '{"secret":"' + secret + '"');
    if (kind === "database-read") IDBObjectStore.prototype.getAll = () => { throw new Error(secret); };
    if (kind === "asset-read") Blob.prototype.arrayBuffer = () => Promise.reject(new Error(secret));
    try { await assert.rejects(exportStaticBackup(env.source, metadata), (error: unknown) => {
      assert(error instanceof BackupValidationError); assert.equal(error.message.includes(secret), false); return true;
    }); } finally { IDBObjectStore.prototype.getAll = originalGetAll; Blob.prototype.arrayBuffer = originalArrayBuffer; }
  }
});

test("missing required images and active generation fail without collecting or repairing their source", async () => {
  const env = await environment();
  env.data.appearance!.presets[0].snapshot.profile.dock.image = "appearance-asset:" + "f".repeat(64);
  env.values.set(BACKUP_LOCAL_KEYS.appearance, JSON.stringify(env.data.appearance));
  await assert.rejects(exportStaticBackup(env.source, metadata), (error: unknown) => error instanceof BackupValidationError && error.code === "missing-asset");
  const active = await environment();
  Object.assign(active.data.chat.sessions[0], { generation: { id: "active", stage: "provider" } });
  await seed(active.source.indexedDB, "veil-chat-v2", { sessions: active.data.chat.sessions });
  const before = await readStaticBackupSource(active.source);
  await assert.rejects(exportStaticBackup(active.source, metadata), (error: unknown) => error instanceof BackupValidationError && error.code === "invalid-data");
  assert.deepEqual(await readStaticBackupSource(active.source), before);
});

test("unknown schema, extra stores/documents and unsupported catalogs fail closed without upgrades", async () => {
  for (const kind of ["new-version", "extra-store", "extra-document", "no-catalog"] as const) {
    const indexedDB = new IDBFactory();
    if (kind === "new-version") await seed(indexedDB, "veil-core-v1", { documents: [] }, 2, "key");
    if (kind === "extra-store") await seed(indexedDB, "veil-core-v1", { documents: [], future: [] }, 1, "key");
    if (kind === "extra-document") await seed(indexedDB, "veil-core-v1", { documents: [{ key: "future", value: "{}" }] }, 1, "key");
    if (kind === "no-catalog") indexedDB.databases = () => Promise.reject(new Error(secret));
    await assert.rejects(exportStaticBackup({ indexedDB, localStorage: { getItem: () => null } }, metadata), (error: unknown) => error instanceof BackupValidationError);
  }
});

test("databases disappearing after enumeration are not bootstrapped by export", async () => {
  const indexedDB = new IDBFactory();
  await seed(indexedDB, "veil-core-v1", { documents: [] }, 1, "key");
  const original = indexedDB.databases.bind(indexedDB);
  indexedDB.databases = async () => {
    const catalog = await original();
    await new Promise<void>((resolve, reject) => {
      const operation = indexedDB.deleteDatabase("veil-core-v1"); operation.onsuccess = () => resolve(); operation.onerror = () => reject(operation.error);
    });
    return catalog;
  };
  await assert.rejects(exportStaticBackup({ indexedDB, localStorage: { getItem: () => null } }, metadata),
    (error: unknown) => error instanceof BackupValidationError);
  assert.deepEqual(await original(), []);
});

test("unsupported persisted values and config extensions are rejected instead of silently omitted", async () => {
  const date = await environment();
  await seed(date.source.indexedDB, "veil-chat-v2", { messages: [{ ...date.data.chat.messages[0], content: new Date(TEST_NOW) }] });
  await assert.rejects(exportStaticBackup(date.source, metadata), (error: unknown) => error instanceof BackupValidationError && error.code === "invalid-source-data");
  const api = await environment();
  await seed(api.source.indexedDB, "veil-api-config-v1", { configs: [{ ...api.data.apiConfigs[0], apiKey: secret, futureHeaders: { key: secret } }] });
  await assert.rejects(exportStaticBackup(api.source, metadata), (error: unknown) => error instanceof BackupValidationError && error.code === "unsupported-source-data");
});

test("a present document containing JSON null is not mistaken for an absent key", async () => {
  const env = await environment(); env.values.set(BACKUP_LOCAL_KEYS.contacts, "null");
  await assert.rejects(exportStaticBackup(env.source, metadata), (error: unknown) => error instanceof BackupValidationError);
  const core = await environment();
  await seed(core.source.indexedDB, "veil-core-v1", { documents: [{ key: "veil.foundation.v1", value: "null", updatedAt: TEST_NOW }] }, 1, "key");
  await assert.rejects(exportStaticBackup(core.source, metadata), (error: unknown) => error instanceof BackupValidationError);
});

test("static export makes no network/model requests and returns no UI or restore side effect", async () => {
  const env = await environment(), saved = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  Object.defineProperty(globalThis, "fetch", { configurable: true, get() { throw new Error("No network is allowed"); } });
  try { await exportStaticBackup(env.source, metadata); }
  finally { if (saved) Object.defineProperty(globalThis, "fetch", saved); else Reflect.deleteProperty(globalThis, "fetch"); }
});

test("an empty legacy session remark is left out of the export copy while stored data is untouched", async () => {
  const env = await environment();
  const rows = env.data.chat.sessions.map((row) => ({ ...row, remark: null }));
  await seed(env.source.indexedDB, "veil-chat-v2", { sessions: rows });
  const before = await readStaticBackupSource(env.source);
  const result = await exportStaticBackup(env.source, metadata);
  const checked = await validateBackupPackage(result.manifestJson, result.files);
  assert.ok(checked.data.chat.sessions.every((row) => !("remark" in row)));
  assert.deepEqual(await readStaticBackupSource(env.source), before);
  assert.ok((before.chat.sessions as Array<Record<string, unknown>>).every((row) => row.remark === null));
});

test("a non-empty legacy remark and other unknown session fields still refuse the export", async () => {
  for (const extra of [{ remark: "Simba" }, { remark: null, other: 1 }, { nickname: null }]) {
    const env = await environment();
    await seed(env.source.indexedDB, "veil-chat-v2", { sessions: env.data.chat.sessions.map((row) => ({ ...row, ...extra })) });
    await assert.rejects(exportStaticBackup(env.source, metadata), (error: unknown) =>
      error instanceof BackupValidationError && error.code === "invalid-data" && error.path === "chat.sessions[0]"
      && /^unexpected-field:/.test(error.detail ?? ""));
  }
});
