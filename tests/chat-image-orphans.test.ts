import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_IMAGE_ORPHAN_GRACE_MS, ChatStorage } from "../lib/chat/storage";

// The shared prototype of every object store, to inject faults without importing library internals.
type StorePrototype = { delete(...args: unknown[]): unknown; getAll(...args: unknown[]): unknown };
const storePrototype = () => new Promise<StorePrototype>((resolve, reject) => {
  const open = new IDBFactory().open("prototype-probe");
  open.onupgradeneeded = () => resolve(Object.getPrototypeOf(open.result.createObjectStore("s")) as StorePrototype);
  open.onerror = () => reject(open.error);
});
const png = (label: string) => new Blob([label], { type: "image/png" });

// Moves the clock the storage reads; every test restores it.
async function withClock<T>(run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try { return await run((ms) => { offset += ms; }); }
  finally { Date.now = realNow; }
}
const exists = async (storage: ChatStorage, id: string) => (await storage.readChatImage(id)) !== null;
const PAST_GRACE = CHAT_IMAGE_ORPHAN_GRACE_MS + 1000;

test("an image saved but never attached is reclaimed by a later save once past the grace period", async () => {
  await withClock(async (advance) => {
    const storage = new ChatStorage(() => new IDBFactory());
    const orphan = await storage.saveChatImage(png("orphan")); // the attach step never happened
    await storage.saveChatImage(png("another"));
    assert(await exists(storage, orphan), "nothing is reclaimed inside the grace period");
    advance(PAST_GRACE);
    const next = await storage.saveChatImage(png("next"));
    assert(!(await exists(storage, orphan)), "the unreferenced image was reclaimed");
    assert(await exists(storage, next), "the image being saved is kept");
  });
});

test("images referenced by a conversation or by the global background are never reclaimed", async () => {
  await withClock(async (advance) => {
    const storage = new ChatStorage(() => new IDBFactory());
    const session = await storage.openSession("peter");
    const conversation = await storage.saveChatImage(png("conversation"));
    await storage.updateSessionSettings(session.id, { backgroundImage: conversation });
    const global = await storage.saveChatImage(png("global"));
    await storage.updateGlobalChatBackground(global);
    const orphan = await storage.saveChatImage(png("orphan"));
    advance(PAST_GRACE * 5);
    await storage.saveChatImage(png("trigger"));
    assert(await exists(storage, conversation));
    assert(await exists(storage, global));
    assert(!(await exists(storage, orphan)));
    // A replaced reference is released by the existing path and no longer protects its image.
    const replacement = await storage.saveChatImage(png("replacement"));
    await storage.updateSessionSettings(session.id, { backgroundImage: replacement });
    assert(!(await exists(storage, conversation)));
    assert(await exists(storage, global));
  });
});

test("an image inside the grace period survives another window's save, and its attach still succeeds", async () => {
  await withClock(async (advance) => {
    const factory = new IDBFactory();
    const windowA = new ChatStorage(() => factory), windowB = new ChatStorage(() => factory);
    const session = await windowA.openSession("peter");
    const pending = await windowA.saveChatImage(png("pending"));
    advance(CHAT_IMAGE_ORPHAN_GRACE_MS - 60_000);
    await windowB.saveChatImage(png("other window"));
    await windowA.updateSessionSettings(session.id, { backgroundImage: pending });
    assert.equal((await windowB.readSession(session.id)).session.backgroundImage, pending);
    assert(await exists(windowB, pending));
  });
});

test("an attach racing a sweep of the same old image never leaves a reference to a missing image", async () => {
  for (const attachFirst of [true, false]) await withClock(async (advance) => {
    const factory = new IDBFactory();
    const windowA = new ChatStorage(() => factory), windowB = new ChatStorage(() => factory);
    const session = await windowA.openSession("peter");
    const old = await windowA.saveChatImage(png("old"));
    advance(PAST_GRACE);
    const attach = () => windowA.updateSessionSettings(session.id, { backgroundImage: old }).then(() => "attached", () => "refused");
    const sweep = () => windowB.saveChatImage(png("sweeper"));
    const [outcome] = attachFirst ? await Promise.all([attach(), sweep()]) : (await Promise.all([sweep(), attach()])).reverse();
    const attachedTo = (await windowA.readSession(session.id)).session.backgroundImage;
    if (attachedTo === old) {
      assert.equal(outcome, "attached");
      assert(await exists(windowA, old), "a referenced image must still exist");
    } else {
      assert.equal(outcome, "refused", "an attach that lost the race fails instead of dangling");
      assert(!(await exists(windowA, old)));
    }
  });
});

test("a reclamation that fails midway changes nothing, and a retry finishes the job", async () => {
  await withClock(async (advance) => {
    const storage = new ChatStorage(() => new IDBFactory());
    const first = await storage.saveChatImage(png("first")), second = await storage.saveChatImage(png("second"));
    advance(PAST_GRACE);
    const proto = await storePrototype(), original = proto.delete;
    let deletes = 0;
    proto.delete = function (this: IDBObjectStore, ...args: unknown[]) {
      if (++deletes === 2) throw new Error("storage failed");
      return original.apply(this, args);
    };
    try { await assert.rejects(storage.saveChatImage(png("failing")), /storage failed/); }
    finally { proto.delete = original; }
    assert(await exists(storage, first), "the aborted transaction deleted nothing");
    assert(await exists(storage, second));
    const done = await storage.saveChatImage(png("retry"));
    assert(!(await exists(storage, first)));
    assert(!(await exists(storage, second)));
    assert(await exists(storage, done));
  });
});

test("repeating the reclamation is harmless, and entering or reading a conversation never scans assets", async () => {
  await withClock(async (advance) => {
    const storage = new ChatStorage(() => new IDBFactory());
    const session = await storage.openSession("peter");
    const kept = await storage.saveChatImage(png("kept"));
    await storage.updateSessionSettings(session.id, { backgroundImage: kept });
    const orphan = await storage.saveChatImage(png("orphan"));
    advance(PAST_GRACE);
    const proto = await storePrototype(), original = proto.getAll;
    let assetScans = 0;
    proto.getAll = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === "assets") assetScans++;
      return original.apply(this, args);
    };
    try {
      await storage.openSession("peter"); await storage.readExistingSession("peter"); await storage.readSession(session.id);
      await storage.readChatBackgroundSettings(); await storage.readChatImage(orphan);
      assert.equal(assetScans, 0, "chat entry and reads do not scan the asset store");
      assert(await exists(storage, orphan), "and therefore do not reclaim");
      await storage.saveChatImage(png("one"));
      assert.equal(assetScans, 1, "only saving an image scans, once");
    } finally { proto.getAll = original; }
    assert(!(await exists(storage, orphan)));
    const survivors = [];
    for (let round = 0; round < 3; round++) { await storage.saveChatImage(png(`again ${round}`)); survivors.push(await exists(storage, kept)); }
    assert.deepEqual(survivors, [true, true, true]);
    assert.equal((await storage.readSession(session.id)).session.backgroundImage, kept);
  });
});

test("an asset of unknown age is never reclaimed", async () => {
  await withClock(async (advance) => {
    const factory = new IDBFactory();
    const storage = new ChatStorage(() => factory);
    const legacy = await storage.saveChatImage(png("legacy"));
    // Simulate an asset written without a usable timestamp.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open("veil-chat-v2"); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("assets", "readwrite"), store = tx.objectStore("assets");
      const read = store.get(legacy);
      read.onsuccess = () => { store.put({ ...read.result, createdAt: undefined }); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
    advance(PAST_GRACE * 10);
    await storage.saveChatImage(png("trigger"));
    assert(await exists(storage, legacy));
  });
});
