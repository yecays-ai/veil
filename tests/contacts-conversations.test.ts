import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { addContact, createContactStorage, removeContact } from "../lib/contact-storage";
import { ChatStorage } from "../lib/chat/storage";

function memory() {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } } };
}

test("Contact relations reference Characters without copying profiles and remain unique", async () => {
  const backend = memory(), storage = createContactStorage(() => backend.storage);
  await storage.transact((current) => addContact(current, "peter", 10));
  await storage.transact((current) => addContact(current, "peter", 20));
  const saved = await storage.load();
  assert.equal(saved.contacts.length, 1);
  assert.deepEqual(Object.keys(saved.contacts[0]).sort(), ["characterId", "createdAt", "id"]);
  assert.equal(saved.contacts[0].characterId, "peter");
  assert.equal((await storage.ensureCharacters(["peter", "ghost", "ghost"])).contacts.length, 2);
  assert.equal(removeContact(await storage.load(), "peter").contacts.some((item) => item.characterId === "peter"), false);
});

test("existing direct sessions migrate idempotently to contacts without changing chat history", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const direct = await chat.openSession("peter"); await chat.send(direct.id, "Old message");
  const backend = memory(), contacts = createContactStorage(() => backend.storage);
  const sessionIds = (await chat.listSessions()).filter((item) => item.type !== "group").map((item) => item.characterId);
  await contacts.ensureCharacters(sessionIds); await contacts.ensureCharacters(sessionIds);
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), ["peter"]);
  assert.equal((await chat.openSession("peter")).id, direct.id);
  assert.equal((await chat.readSession(direct.id)).messages[0].content, "Old message");
});

test("groups reference Contact Characters and never replace the unique direct chat", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const group = await chat.createGroupSession(["peter", "ghost", "peter"], "Friends");
  assert.equal(group.type, "group");
  assert.deepEqual(group.participantIds, ["peter", "ghost"]);
  const direct = await chat.openSession("peter");
  assert.notEqual(direct.id, group.id);
  assert.equal((await chat.openSession("peter")).id, direct.id);
  assert.equal((await chat.listSessions()).length, 2);
});

test("Chats and Contacts expose the required mobile navigation and creation entries", () => {
  const chats = readFileSync("components/chat/messages-home.tsx", "utf8");
  const chatCss = readFileSync("app/messages/chat.css", "utf8");
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(chats, /New Message/); assert.match(chats, /New Group/); assert.match(chats, /Add Friend/);
  assert.match(chats, /session\.type === "group"/); assert.match(chats, /RootAppHeader/);
  assert.match(chats, /chat-action-popover/); assert.match(chats, /CirclePlus/);
  assert.match(chatCss, /\.chat-action-layer[^}]+background: transparent/);
  assert.doesNotMatch(chatCss.match(/\.chat-action-layer[^}]+}/)?.[0] ?? "", /backdrop-filter/);
  assert.match(contacts, /useContacts/); assert.match(contacts, /href="\/contacts\/add"/);
  assert.match(contacts, /backHref="\/contacts"/);
});
