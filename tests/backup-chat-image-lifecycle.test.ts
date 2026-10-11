import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { BACKUP_LOCK_NAME, BackupCoordinator, type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";
import { lockOrigin } from "./generation-lock-fixture";

const image = (text: string) => new Blob([text], { type: "image/png" });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Lets a test hold the operation between "picture saved" and "picture attached".
class PausableChat extends ChatStorage {
  pause?: Promise<void>; entered = deferred(); failCleanup = false;
  override async updateSessionSettings(...args: Parameters<ChatStorage["updateSessionSettings"]>) {
    this.entered.resolve(); await this.pause; return super.updateSessionSettings(...args);
  }
  override async updateGlobalChatBackground(...args: Parameters<ChatStorage["updateGlobalChatBackground"]>) {
    this.entered.resolve(); await this.pause; return super.updateGlobalChatBackground(...args);
  }
  override deleteChatImageIfUnused(...args: Parameters<ChatStorage["deleteChatImageIfUnused"]>) {
    return this.failCleanup ? Promise.reject(new Error("cleanup down")) : super.deleteChatImageIfUnused(...args);
  }
}

function fixture() {
  const origin = lockOrigin(), counts = { shared: 0 }, factory = new IDBFactory();
  const manager: BackupLockManager = { request: ((...args: Parameters<LockManager["request"]>) => {
    if (args[0] === BACKUP_LOCK_NAME && (args[1] as LockOptions).mode === "shared") counts.shared++;
    return origin.client().request(...args);
  }) as BackupLockManager["request"] };
  const store = new PausableChat(() => factory, () => undefined, createPersistenceWriteGate(() => manager));
  // What a snapshot would see: wallpaper references and the stored pictures.
  const snapshot = async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(CHAT_DATABASE_NAME); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    const read = <T,>(name: string) => new Promise<T[]>((resolve, reject) => {
      const all = database.transaction(name).objectStore(name).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error);
    });
    try {
      const [sessions, assets, settings] = await Promise.all([read<{ backgroundImage?: string }>("sessions"),
        read<{ id: string }>("assets"), read<{ globalChatBackgroundImage?: string }>("chatSettings")]);
      return { refs: [...sessions.map((s) => s.backgroundImage), ...settings.map((s) => s.globalChatBackgroundImage)].filter(Boolean) as string[],
        assets: assets.map((a) => a.id) };
    } finally { database.close(); }
  };
  const capture = () => new BackupCoordinator(manager).withSnapshot(snapshot);
  return { store, counts, capture };
}

for (const [name, attach] of [
  ["session wallpaper", (store: ChatStorage, id: string) => store.setSessionBackgroundImage(id, image("one"))],
  ["global wallpaper", (store: ChatStorage) => store.setGlobalChatBackgroundImage(image("one"))],
] as const) {
  test(`${name}: a snapshot never lands between save and attach, and one shared lease covers both`, async () => {
    const { store, counts, capture } = fixture();
    const session = await store.openSession("a");
    counts.shared = 0;
    const gate = deferred(); store.pause = gate.promise;
    const attaching = attach(store, session.id);
    await store.entered.promise;
    let seen: Awaited<ReturnType<typeof capture>> | undefined;
    const snapshot = capture().then((value) => { seen = value; });
    await settle();
    assert.equal(seen, undefined, "the queued snapshot waits while the picture is saved but not attached");
    gate.resolve();
    const id = await attaching; await snapshot;
    assert.deepEqual(seen, { refs: [id], assets: [id] });
    assert.equal(counts.shared, 1, "save and attach share one outer lease");
  });
}

test("a failed attach removes only the picture it saved, keeps every other picture, and passes the error on", async () => {
  const { store, counts, capture } = fixture();
  const a = await store.openSession("a"), b = await store.openSession("b");
  const keptId = await store.setSessionBackgroundImage(b.id, image("b"));
  const globalId = await store.setGlobalChatBackgroundImage(image("global"));
  const unattachedId = await store.saveChatImage(image("pending elsewhere"));
  counts.shared = 0;
  const gate = deferred(); store.pause = gate.promise;
  const failing = store.setSessionBackgroundImage("missing-session", image("new"));
  const outcome = failing.then(() => "ok", (error: Error) => error.message);
  await store.entered.promise;
  let seen: Awaited<ReturnType<typeof capture>> | undefined;
  const snapshot = capture().then((value) => { seen = value; });
  await settle();
  gate.resolve();
  assert.equal(await outcome, "Conversation not found.", "the attach error reaches the caller");
  await snapshot;
  // The queued snapshot ran after the cleanup finished: no orphan from the failed attempt, nothing else lost.
  assert.deepEqual(seen?.assets.sort(), [keptId, globalId, unattachedId].sort());
  assert.deepEqual(seen?.refs.sort(), [keptId, globalId].sort());
  assert.equal(counts.shared, 1, "cleanup runs inside the same lease, so it needs no second one");
  assert.ok(a.id);
});

test("a cleanup failure never hides the attach error and still releases the lease", async () => {
  const { store, counts, capture } = fixture();
  await store.openSession("a");
  counts.shared = 0; store.failCleanup = true;
  await assert.rejects(store.setSessionBackgroundImage("missing-session", image("new")), /Conversation not found\./);
  assert.equal(counts.shared, 1);
  const seen = await capture();
  assert.equal(seen.assets.length, 1, "the leftover picture is unreferenced and is reclaimed after the orphan grace period");
  assert.deepEqual(seen.refs, []);
});

test("an invalid picture is rejected before anything is stored", async () => {
  const { store, capture } = fixture();
  const session = await store.openSession("a");
  await assert.rejects(store.setSessionBackgroundImage(session.id, new Blob(["x"], { type: "text/plain" })), /Choose an image file\./);
  assert.deepEqual(await capture(), { refs: [], assets: [] });
});
