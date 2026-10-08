import assert from "node:assert/strict";
import test from "node:test";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { defaultFoundation } from "../lib/foundation-types";

test("Core documents use atomic compare-and-set without overwriting newer data", async () => {
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  assert.equal(await documents.read("profile"), null);
  assert.equal(await documents.putIfAbsent("profile", "one"), "one");
  assert.equal(await documents.putIfAbsent("profile", "stale"), "one");
  assert.equal(await documents.replaceIfCurrent("profile", "stale", "two"), false);
  assert.equal(await documents.replaceIfCurrent("profile", "one", "two"), true);
  assert.equal(await documents.rollbackIfCurrent("profile", "one", null), false);
  assert.equal(await documents.rollbackIfCurrent("profile", "two", "one"), true);
  assert.equal(await documents.read("profile"), "one");
});

test("Core storage reopens a cached connection closed before the next read", async () => {
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  await documents.putIfAbsent("profile", "saved");
  const cached = documents as unknown as { database?: Promise<IDBDatabase> };
  const closed = await cached.database!;

  closed.close();

  assert.equal(await documents.read("profile"), "saved");
  assert.notEqual(await cached.database!, closed);
});

test("Core storage retries transaction creation once and does not retry write failures", async () => {
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  await documents.putIfAbsent("profile", "saved");
  const originalOpen = factory.open.bind(factory);
  let openCalls = 0;
  Object.defineProperty(factory, "open", {
    configurable: true,
    value: (name: string, version?: number) => {
      openCalls++;
      return originalOpen(name, version);
    },
  });
  const databasePrototype = Object.getPrototypeOf(await (documents as unknown as {
    database: Promise<IDBDatabase>;
  }).database) as { transaction: (...args: unknown[]) => IDBTransaction };
  const originalTransaction = databasePrototype.transaction;
  let creationAttempts = 0;
  databasePrototype.transaction = function (...args: unknown[]) {
    creationAttempts++;
    if (creationAttempts <= 2)
      throw new DOMException("The database connection is closing.", "InvalidStateError");
    return originalTransaction.apply(this, args);
  };
  try {
    await assert.rejects(documents.read("profile"), { name: "InvalidStateError" });
    assert.equal(creationAttempts, 2);
    assert.equal(openCalls, 1);
    assert.equal(await documents.read("profile"), "saved");
    assert.equal(openCalls, 2);
  } finally {
    databasePrototype.transaction = originalTransaction;
  }
});

test("Core storage closes an open request that succeeds after onblocked", async () => {
  const factory = new IDBFactory();
  const originalOpen = factory.open.bind(factory);
  let closeCalls = 0;
  Object.defineProperty(factory, "open", {
    configurable: true,
    value: (name: string, version?: number) => {
      const request = originalOpen(name, version);
      let blockedHandler: ((event: Event) => void) | null = null;
      return new Proxy(request, {
        set(target, property, value) {
          if (property === "onblocked") blockedHandler = value;
          if (property === "onsuccess") {
            target.onsuccess = (event) => {
              const database = target.result;
              const close = database.close.bind(database);
              database.close = () => { closeCalls++; close(); };
              blockedHandler?.call(target, new Event("blocked"));
              value.call(target, event);
            };
            return true;
          }
          return Reflect.set(target, property, value, target);
        },
      });
    },
  });
  const documents = new IndexedDBDocumentStorage(() => factory);

  await assert.rejects(documents.read("profile"), /Close other VEIL tabs/);
  assert.equal(closeCalls, 1);
});

test("Foundation uses Core IndexedDB as its only persistence authority", async () => {
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  const storage = createIndexedDBFoundationStorage(documents);
  assert.equal((await storage.load()).user.name, defaultFoundation().user.name);
  assert.equal((await storage.transact((current) => ({
    ...current,
    user: { ...current.user, name: "IndexedDB" },
  }))).user.name, "IndexedDB");
  assert.equal((await createIndexedDBFoundationStorage(documents).load()).user.name, "IndexedDB");
});

