import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";

async function database(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(CHAT_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("current chat schema contains only conversation-owned stores", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  await storage.listSessions();
  const db = await database(factory);
  assert.deepEqual([...db.objectStoreNames], ["assets", "chatSettings", "messages", "sessions", "worldBookStates"]);
  assert(!db.objectStoreNames.contains("apiConfigs"));
  const tx = db.transaction(["sessions", "messages"]);
  assert.deepEqual([...tx.objectStore("sessions").indexNames], []);
  assert.deepEqual([...tx.objectStore("messages").indexNames], ["sessionId"]);
  db.close();
});

test("concurrent direct opens reuse one conversation for a Character", async () => {
  const factory = new IDBFactory();
  const first = new ChatStorage(() => factory), second = new ChatStorage(() => factory);
  const [one, two] = await Promise.all([first.openSession("peter"), second.openSession("peter")]);
  assert.equal(one.id, two.id);
  assert.equal((await first.listSessions()).length, 1);
});

test("chat sessions, messages and session-linked settings remain available in the current schema", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const session = await storage.openSession("peter");
  await storage.send(session.id, "hello");
  await storage.updateSessionSettings(session.id, { streamOnline: true, customCSS: ".chat-bubble { opacity: .9; }" });
  const reloaded = await new ChatStorage(() => factory).readSession(session.id);
  assert.equal(reloaded.session.streamOnline, true);
  assert.match(reloaded.session.customCSS ?? "", /opacity/);
  assert.deepEqual(reloaded.messages.map((message) => message.content), ["hello"]);
});

async function seedHistoryAndWorldBookState(storage: ChatStorage, sessionId: string) {
  await storage.send(sessionId, "old history");
  const batch = await storage.beginReply(sessionId);
  assert(batch);
  await storage.finalizeReply(batch.assistant.id, "old reply", {
    cycle: 3, prefix: [], entries: { "book:entry": { stickyUntil: 5 } },
  });
}

test("Clear Conversation History resets messages and WorldBook state but preserves the conversation shell settings", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const imageId = await storage.saveChatImage(new Blob(["background"], { type: "image/png" }));
  await storage.updateSessionSettings(session.id, {
    pinned: true, streamOnline: true, autoReplyOnKeyboardDismiss: true,
    backgroundImage: imageId, customCSS: ".chat-bubble { opacity: .9; }",
  });
  await seedHistoryAndWorldBookState(storage, session.id);
  assert(await storage.readWorldBookState(session.id));

  assert.equal(await storage.clearSession(session.id), 2);
  const saved = await storage.readSession(session.id);
  assert.equal(saved.messages.length, 0);
  assert.equal(await storage.readWorldBookState(session.id), null);
  assert.equal(saved.session.nextOrder, 1);
  assert.equal(saved.session.lastMessageId, undefined);
  assert.equal(saved.session.lastMessagePreview, "");
  assert.equal(saved.session.pinned, true);
  assert.equal(saved.session.streamOnline, true);
  assert.equal(saved.session.autoReplyOnKeyboardDismiss, true);
  assert.equal(saved.session.backgroundImage, imageId);
  assert.match(saved.session.customCSS ?? "", /opacity/);
  assert(await storage.readChatImage(imageId));
});

test("Delete Conversation resets history, removes only its session and unused background asset, and permits a fresh direct session", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const other = await storage.openSession("lan");
  const imageId = await storage.saveChatImage(new Blob(["background"], { type: "image/png" }));
  await storage.updateSessionSettings(session.id, { backgroundImage: imageId });
  await seedHistoryAndWorldBookState(storage, session.id);
  await storage.send(other.id, "other conversation stays");

  let notified = 0;
  const unsubscribe = storage.subscribe(() => { notified++; });
  await storage.deleteSession(session.id);
  unsubscribe();
  assert(notified > 0);
  assert.deepEqual((await storage.listSessions()).map((item) => item.id), [other.id]);
  assert.equal(await storage.readChatImage(imageId), null);
  assert.equal(await storage.readWorldBookState(session.id), null);
  assert.deepEqual((await storage.readSession(other.id)).messages.map((item) => item.content), ["other conversation stays"]);

  const fresh = await storage.openSession("peter");
  assert.notEqual(fresh.id, session.id);
  assert.deepEqual((await storage.readSession(fresh.id)).messages, []);
  assert.equal(await storage.readWorldBookState(fresh.id), null);
});

test("Clear and Delete refuse an active streaming reply without changing conversation data", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await storage.send(session.id, "question");
  const batch = await storage.beginReply(session.id);
  assert(batch);

  await assert.rejects(storage.clearSession(session.id), /reply is in progress/);
  await assert.rejects(storage.deleteSession(session.id), /reply is in progress/);
  const unchanged = await storage.readSession(session.id);
  assert.equal(unchanged.messages.length, 2);
  assert.equal(unchanged.messages[1].status, "streaming");
  assert.equal((await storage.listSessions()).some((item) => item.id === session.id), true);
});

test("open failures keep the safe user-facing storage error", async () => {
  const storage = new ChatStorage(() => { throw new DOMException("blocked", "SecurityError"); });
  await assert.rejects(storage.listSessions(), /Chat storage is unavailable/);
});
