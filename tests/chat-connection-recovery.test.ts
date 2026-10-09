import assert from "node:assert/strict";
import test from "node:test";
import { forceCloseDatabase, IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";

const cached = (storage: ChatStorage) => storage as unknown as { database?: Promise<IDBDatabase> };
async function fixture() {
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory);
  const session = await storage.openSession("a");
  await storage.send(session.id, "Original");
  return { factory, storage, session };
}

test("CF-01: the same ChatStorage recovers list and Send after abnormal close", async () => {
  const { storage, session } = await fixture();
  forceCloseDatabase(await cached(storage).database! as never);
  assert.equal((await storage.listSessions())[0].id, session.id);
  forceCloseDatabase(await cached(storage).database! as never);
  await storage.send(session.id, "After close");
  assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["Original", "After close"]);
});

test("CF-01: transaction creation recovers once, and a second failure is not retried", async () => {
  const { factory, storage } = await fixture();
  const open = factory.open.bind(factory); let opens = 0;
  factory.open = (...args) => { opens++; return open(...args); };
  const db = await cached(storage).database!;
  const prototype = Object.getPrototypeOf(db) as IDBDatabase;
  const transaction = prototype.transaction; let creations = 0;
  prototype.transaction = function (...args: Parameters<IDBDatabase["transaction"]>) {
    if (++creations <= 2) throw new DOMException("Closed", "InvalidStateError");
    return transaction.apply(this, args);
  };
  try {
    await assert.rejects(storage.listSessions(), { name: "InvalidStateError" });
    assert.equal(creations, 2, "exactly one recovery attempt");
    assert.equal(opens, 1);
    assert.equal((await storage.listSessions()).length, 1);
  } finally { prototype.transaction = transaction; }
});

test("CF-01: an InvalidStateError after transaction creation never replays a write", async () => {
  const { factory, storage, session } = await fixture();
  const db = await cached(storage).database!;
  const prototype = Object.getPrototypeOf(db.transaction("messages", "readwrite").objectStore("messages")) as IDBObjectStore;
  const put = prototype.put, open = factory.open.bind(factory); let writes = 0, opens = 0;
  factory.open = (...args) => { opens++; return open(...args); };
  prototype.put = () => { writes++; throw new DOMException("Write failed", "InvalidStateError"); };
  try {
    await assert.rejects(storage.send(session.id, "Must not replay"), { name: "InvalidStateError" });
    assert.equal(writes, 1); assert.equal(opens, 0);
  } finally { prototype.put = put; }
  assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["Original"]);
});

test("CF-01: a blocked request closes its late successful connection", async () => {
  const factory = new IDBFactory(), open = factory.open.bind(factory); let closes = 0;
  factory.open = (...args) => {
    const request = open(...args); let blocked: ((event: Event) => void) | null = null;
    return new Proxy(request, { set(target, property, value) {
      if (property === "onblocked") blocked = value;
      if (property === "onsuccess") {
        target.onsuccess = (event) => {
          const close = target.result.close.bind(target.result);
          target.result.close = () => { closes++; close(); };
          blocked?.call(target, new Event("blocked")); value.call(target, event);
        }; return true;
      }
      return Reflect.set(target, property, value, target);
    } });
  };
  await assert.rejects(new ChatStorage(() => factory).listSessions(), /Close other VEIL tabs/);
  assert.equal(closes, 1);
});
