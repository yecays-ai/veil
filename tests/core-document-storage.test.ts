import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
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
