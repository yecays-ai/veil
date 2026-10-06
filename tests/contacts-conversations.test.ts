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
  assert.equal("ensureCharacters" in storage, false);
  assert.equal(removeContact(await storage.load(), "peter").contacts.some((item) => item.characterId === "peter"), false);
});

test("adding a Contact never creates a Conversation and existing chats do not create Contacts", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const backend = memory(), contacts = createContactStorage(() => backend.storage);
  await contacts.transact((current) => addContact(current, "peter", 10));
  assert.equal((await chat.listSessions()).length, 0);
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), ["peter"]);

  const direct = await chat.openSession("ghost");
  await chat.send(direct.id, "Existing chat");
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), ["peter"]);
  assert.equal((await chat.openSession("ghost")).id, direct.id);
  assert.equal((await chat.readSession(direct.id)).messages[0].content, "Existing chat");
  await chat.clearSession(direct.id);
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), ["peter"]);
});

test("New Message single-select opens or creates the one direct Conversation", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const first = await chat.openSession("peter");
  const second = await chat.openSession("peter");
  assert.equal(first.id, second.id);
  assert.equal((await chat.listSessions()).length, 1);
  const source = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(source, /if \(mode === "single"\) return <button[\s\S]*?openDirect\(character\.characterId\)/);
  assert.match(source, /async function openDirect\(characterId: string\)[\s\S]*?chatStorage\.openSession\(characterId\)/);
  assert.match(source, /router\.push\(`\/messages\/\$\{encodeURIComponent\(characterId\)\}`\)/);
});

test("group multi-select continues to Create Group and creates a group Conversation", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const group = await chat.createGroupSession(["peter", "lan"], "Friends");
  assert.equal(group.type, "group");
  assert.deepEqual(group.participantIds, ["peter", "lan"]);
  assert.equal((await chat.listSessions()).length, 1);
  const source = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(source, /mode === "multi"[\s\S]*?aria-pressed/);
  assert.match(source, /selectedContacts\.length < 2[\s\S]*?Next/);
  assert.match(source, /chatStorage\.createGroupSession\(members\.map/);
  assert.match(source, /\/messages\/group\//);
});

test("normal Contacts still opens Contact Profile and Add Contact creates only the relation", () => {
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  const normal = contacts.match(/return <Link className="social-row"[\s\S]*?ContactProfile/)?.[0] ?? contacts;
  const add = contacts.match(/export function AddContactPage\(\)[\s\S]*?export function CreateGroupPage/)?.[0] ?? "";
  assert.match(normal, /\/contacts\//);
  assert.match(contacts, /export function ContactProfile/);
  assert.match(add, /addContact\(current, character\.characterId\)/);
  assert.doesNotMatch(add, /chatStorage\.openSession|createGroupSession/);
});

test("Messages menu has only its two actions and uses the shared Contacts routes", () => {
  const chats = readFileSync("components/chat/messages-home.tsx", "utf8");
  const hook = readFileSync("components/use-contacts.ts", "utf8");
  const contactStorage = readFileSync("lib/contact-storage.ts", "utf8");
  assert.match(chats, /New Message/); assert.match(chats, /New Group/);
  assert.match(chats, /\/contacts\?mode=single/); assert.match(chats, /\/contacts\?mode=multi/);
  assert.doesNotMatch(chats, /Add Friend|Add Contact|chat-sheet|contact-picker-list|contactCharacters/);
  assert.doesNotMatch(hook, /chatStorage|ensureCharacters/);
  assert.doesNotMatch(contactStorage, /ensureCharacters/);
  assert.match(readFileSync("app/contacts/create-group/page.tsx", "utf8"), /CreateGroupPage/);
});

test("Messages popover, search and filters use the flatter pill treatment", () => {
  const chats = readFileSync("components/chat/messages-home.tsx", "utf8");
  const chatCss = readFileSync("app/messages/chat.css", "utf8");
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(chats, /role="menuitem"/);
  assert.doesNotMatch(chats, /Add Friend|Add Contact|chat-sheet|contact-picker-list/);
  assert.match(chatCss, /\.chat-app \.chat-action-popover button[^}]+border: 0/);
  assert.match(chatCss, /\.chat-app \.chat-action-popover button \+ button[^}]+border-top/);
  assert.match(chatCss, /\.chat-app \.messages-filters button[^}]+border-radius: 999px/);
  assert.match(chatCss, /\.chat-app \.messages-search:focus-within/);
  assert.doesNotMatch(chatCss, /\.chat-sheet|\.contact-picker-list|\.picker-check|\.group-create-footer/);
  assert.match(contacts, /aria-label="Add Contact"/);
});

test("group Conversations remain separate from unique direct Conversations", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  const group = await chat.createGroupSession(["peter", "ghost", "peter"], "Friends");
  assert.equal(group.type, "group");
  assert.deepEqual(group.participantIds, ["peter", "ghost"]);
  const direct = await chat.openSession("peter");
  assert.notEqual(direct.id, group.id);
  assert.equal((await chat.openSession("peter")).id, direct.id);
  assert.equal((await chat.listSessions()).length, 2);
});
