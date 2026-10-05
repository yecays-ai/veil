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
  version = 1,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(CHAT_DATABASE_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore("sessions", { keyPath: "id" });
      if (includeCharacterIndex)
        sessions.createIndex("characterId", "characterId", { unique: true });
      const messages = db.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("sessionId", "sessionId");
      db.createObjectStore("apiConfigs", { keyPath: "id" });
      if (version >= 3)
        for (const name of ["assets", "chatSettings", "worldBookStates"]) db.createObjectStore(name, { keyPath: "id" });
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

test("a new chat database installs the complete current schema", async () => {
  const factory = new IDBFactory();
  await new ChatStorage(() => factory).listSessions();
  const db = await openDatabase(factory);
  try {
    assert.equal(db.version, CHAT_DATABASE_VERSION);
    assert.deepEqual(Array.from(db.objectStoreNames).sort(), [
      "apiConfigs",
      "assets",
      "chatSettings",
      "messages",
      "sessions",
      "worldBookStates",
    ]);
    assert.deepEqual(Array.from(db.transaction("sessions").objectStore("sessions").indexNames), []);
    assert.deepEqual(Array.from(db.transaction("messages").objectStore("messages").indexNames), [
      "sessionId",
    ]);
  } finally {
    db.close();
  }
});

test("v3 identity upgrade preserves legacy conversation and all session-linked data", async () => {
  const factory = new IDBFactory();
  const old = await createV1Database(factory, true, 3);
  assert.equal(old.transaction("sessions").objectStore("sessions").index("characterId").unique, true);
  const session = { id: "character:peter", characterId: "peter", updatedAt: 123, remark: "Pete",
    nextOrder: 2, lastMessageId: "old-message", lastMessagePreview: "Hello", autoReplyOnKeyboardDismiss: true,
    streamOnline: true, customCSS: ".bubble { color: red; }", backgroundImage: "image", backgroundBlur: 4 };
  const message = { id: "old-message", sessionId: session.id, role: "user", content: "Hello", status: "sent", order: 1, createdAt: "2026-10-06T12:00:00Z" };
  const state = { prefix: [], entries: {}, cycle: 4 };
  const tx = old.transaction(["sessions", "messages", "worldBookStates", "assets", "chatSettings"], "readwrite");
  const done = finish(tx);
  tx.objectStore("sessions").put(session); tx.objectStore("messages").put(message);
  tx.objectStore("worldBookStates").put({ id: session.id, state });
  tx.objectStore("assets").put({ id: "image", blob: new Blob(["image"]) });
  tx.objectStore("chatSettings").put({ id: "chat-background", globalChatBackgroundImage: "image" });
  await done; old.close();
  const storage = new ChatStorage(() => factory);
  assert.deepEqual(await storage.readSession(session.id), { session, messages: [message] });
  assert.deepEqual(await storage.readWorldBookState(session.id), state);
  assert.equal((await storage.openSession("peter")).id, session.id);
  await storage.createSession("peter");
  assert.equal((await storage.openSession("peter")).id, session.id);
  assert.deepEqual(await storage.readSession(session.id), { session, messages: [message] });
  const db = await openDatabase(factory);
  assert.equal(db.transaction("sessions").objectStore("sessions").indexNames.contains("characterId"), false);
  const asset = db.transaction("assets").objectStore("assets").get("image");
  await new Promise<void>((resolve) => { asset.onsuccess = () => { assert.equal(asset.result.blob.size, 5); resolve(); }; });
  db.close();
});

test("independent conversations share a Character and concurrent direct opens do not duplicate", async () => {
  const factory = new IDBFactory(); const storage = new ChatStorage(() => factory);
  const [direct, same] = await Promise.all([storage.openSession("peter"), new ChatStorage(() => factory).openSession("peter")]);
  assert.equal(direct.id, same.id); assert.notEqual(direct.id, "character:peter");
  const second = await storage.createSession("peter");
  assert.notEqual(second.id, direct.id);
  await storage.send(second.id, "Second conversation");
  assert.equal((await storage.readSession(direct.id)).messages.length, 0);
  assert.equal((await storage.readSession(second.id)).messages[0].content, "Second conversation");
  assert.equal((await storage.listSessions()).length, 2);
});

test("an existing v1 database preserves records while adding chat background stores", async () => {
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
  const upgraded = await openDatabase(factory);
  try {
    assert.equal(upgraded.objectStoreNames.contains("assets"), true);
    assert.equal(upgraded.objectStoreNames.contains("chatSettings"), true);
    assert.equal(upgraded.objectStoreNames.contains("worldBookStates"), true);
  } finally {
    upgraded.close();
  }
});

test("a current database without a characterId index supports direct-chat reuse without schema repair", async () => {
  const factory = new IDBFactory();
  const db = await createV1Database(factory, false, CHAT_DATABASE_VERSION);
  db.close();

  const storage = new ChatStorage(() => factory);
  await storage.listSessions();
  const session = await storage.openSession("missing-index");
  assert.equal((await storage.openSession("missing-index")).id, session.id);

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
