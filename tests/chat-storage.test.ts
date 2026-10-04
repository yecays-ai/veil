import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import {
  CHAT_DATABASE_NAME,
  CHAT_DATABASE_VERSION,
  ChatStorage,
} from "../lib/chat/storage";

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createV1Database(
  factory: IDBFactory,
  includeCharacterIndex = true,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(CHAT_DATABASE_NAME, CHAT_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore("sessions", { keyPath: "id" });
      if (includeCharacterIndex)
        sessions.createIndex("characterId", "characterId", { unique: true });
      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("sessionId", "sessionId");
      db.createObjectStore("apiConfigs", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finish(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

test("a new chat database installs the complete v1 schema", async () => {
  const factory = new IDBFactory();
  await new ChatStorage(() => factory).listSessions();
  const db = await openDatabase(factory);
  try {
    assert.equal(db.version, CHAT_DATABASE_VERSION);
    assert.deepEqual(Array.from(db.objectStoreNames).sort(), [
      "apiConfigs",
      "messages",
      "sessions",
    ]);
    assert.deepEqual(Array.from(db.transaction("sessions").objectStore("sessions").indexNames), [
      "characterId",
    ]);
    assert.deepEqual(Array.from(db.transaction("messages").objectStore("messages").indexNames), [
      "sessionId",
    ]);
  } finally {
    db.close();
  }
});

test("an existing v1 database preserves records and reopens safely", async () => {
  const factory = new IDBFactory();
  const db = await createV1Database(factory);
  const transaction = db.transaction(
    ["sessions", "messages", "apiConfigs"],
    "readwrite",
  );
  transaction.objectStore("sessions").add({
    id: "character:legacy",
    characterId: "legacy",
    updatedAt: 0,
    remark: null,
    autoReplyOnKeyboardDismiss: false,
    nextOrder: 2,
  });
  transaction.objectStore("messages").add({
    id: "legacy-message",
    sessionId: "character:legacy",
    role: "user",
    content: "Stored message",
    status: "sent",
    createdAt: 0,
    order: 1,
  });
  transaction.objectStore("apiConfigs").add({
    id: "legacy-api",
    baseUrl: "https://provider.example/v1",
    apiKey: "test-key",
    model: "test-model",
  });
  await finish(transaction);
  db.close();

  const first = new ChatStorage(() => factory);
  const second = new ChatStorage(() => factory);
  assert.deepEqual(await first.openSession("legacy"), await second.openSession("legacy"));
  assert.deepEqual(
    (await first.readSession("character:legacy")).messages.map((message) =>
      message.content,
    ),
    ["Stored message"],
  );
  assert.equal((await second.getApiConfig("legacy-api"))?.model, "test-model");
});

test("a damaged same-version database is not silently repaired", async () => {
  const factory = new IDBFactory();
  const db = await createV1Database(factory, false);
  db.close();

  const storage = new ChatStorage(() => factory);
  await storage.listSessions();
  await assert.rejects(() => storage.openSession("missing-index"));

  const reopened = await openDatabase(factory);
  try {
    assert.equal(
      reopened
        .transaction("sessions")
        .objectStore("sessions")
        .indexNames.contains("characterId"),
      false,
    );
  } finally {
    reopened.close();
  }
});
