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

test("open failures keep the safe user-facing storage error", async () => {
  const storage = new ChatStorage(() => { throw new DOMException("blocked", "SecurityError"); });
  await assert.rejects(storage.listSessions(), /Chat storage is unavailable/);
});
