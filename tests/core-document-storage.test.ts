import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { defaultFoundation } from "../lib/foundation-types";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set("veil.foundation.v1", initial);
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
}

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

test("Foundation migrates once after validation and leaves legacy data untouched", async () => {
  const original = defaultFoundation();
  const legacyDocument = { ...original, user: { ...original.user, name: "Legacy" } };
  const legacyRaw = JSON.stringify(legacyDocument);
  const legacy = memoryStorage(legacyRaw);
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  const storage = createIndexedDBFoundationStorage(documents, () => legacy.storage);

  assert.equal((await storage.load()).user.name, "Legacy");
  assert.equal(legacy.values.get("veil.foundation.v1"), legacyRaw);
  legacy.storage.setItem("veil.foundation.v1", JSON.stringify({
    ...legacyDocument,
    user: { ...legacyDocument.user, name: "Changed legacy" },
  }));
  assert.equal((await storage.load()).user.name, "Legacy");
  assert.equal((await storage.transact((current) => ({
    ...current,
    user: { ...current.user, name: "IndexedDB" },
  }))).user.name, "IndexedDB");
});

test("invalid legacy Foundation is rejected before Core storage is changed", async () => {
  const legacy = memoryStorage("{broken");
  const factory = new IDBFactory();
  const documents = new IndexedDBDocumentStorage(() => factory);
  const storage = createIndexedDBFoundationStorage(documents, () => legacy.storage);
  await assert.rejects(storage.load(), /could not be read/);
  assert.equal(await documents.read("veil.foundation.v1"), null);
  assert.equal(legacy.values.get("veil.foundation.v1"), "{broken");
});
