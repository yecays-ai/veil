import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { addContact, createContactStorage, removeContact } from "../lib/contact-storage";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { createCharacter } from "../lib/foundation";
import { normalizeCharacterInput } from "../lib/foundation-types";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";

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
  assert.deepEqual(Object.keys(saved.contacts[0]).sort(), ["characterId", "createdAt", "heroBackground", "id", "lastRemarkChange", "remark"]);
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

test("Messages conversation rows keep navigation and expose only a confirmed Delete swipe action", () => {
  const home = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(home, /<div className="conversation-swipe-row"[^>]*data-conversation-row=\{session\.id\}/);
  assert.match(home, /className=\{`conversation-delete-action[\s\S]*?<span className="conversation-delete-label"[\s\S]*?>Delete<\/span>[\s\S]*?<\/button>/);
  assert.match(home, /href=\{group \? `\/messages\/group/);
  assert.match(home, /onPointerDown=\{\(event\) => beginSwipe/);
  assert.match(home, /onPointerMove=\{\(event\) => moveSwipe/);
  assert.match(home, /onPointerUp=\{\(event\) => finishSwipe/);
  assert.match(home, /Delete Conversation\?/);
  assert.match(home, /onClick=\{\(\) => setDeleteTarget\(null\)\}>Cancel/);
  assert.match(home, /onClick=\{\(\) => void confirmDeleteConversation\(\)\}>\{deleteBusy \? "Deleting…" : "Delete"\}/);
  assert.match(home, /chatStorage\.subscribe\(\(\) => void load\(\)\)/);
  assert.doesNotMatch(home, /location\.reload/);
  assert.match(home, /visible\.length > 0 &&\s*<div className="conversation-list">/);
  assert.doesNotMatch(home, /No conversations yet|No group chats yet|No matching chats/);
  assert.match(home, /session\.lastMessagePreview \|\|/);
  assert.match(home, /<span className="conversation-preview">/);
});

test("horizontal swipes preserve vertical scrolling and resist overpull before release settle", async () => {
  const { isHorizontalConversationSwipe, conversationSwipeOffset, conversationSwipeReleaseTarget, conversationDeleteMotion } =
    await import("../lib/chat/swipe-gesture");
  assert.equal(isHorizontalConversationSwipe(-22, 35), false);
  assert.equal(isHorizontalConversationSwipe(-22, 5), true);
  assert.equal(conversationSwipeOffset(0, -84), -84);
  const resisted = conversationSwipeOffset(0, -114);
  assert.ok(resisted < -84 && resisted > -94);
  const extremeOffset = conversationSwipeOffset(0, -10000);
  assert.ok(extremeOffset < -84 && extremeOffset > -100);
  assert.equal(conversationSwipeOffset(0, 20), 0);
  assert.equal(conversationSwipeReleaseTarget(-50), -84);
  assert.equal(conversationSwipeReleaseTarget(-30), 0);
  assert.equal(conversationSwipeReleaseTarget(-84), -84);
  assert.equal(conversationSwipeReleaseTarget(0), 0);

  assert.deepEqual(conversationDeleteMotion(0), { translateX: 84, width: 84, labelOffsetX: 0 });
  assert.deepEqual(conversationDeleteMotion(-42), { translateX: 42, width: 84, labelOffsetX: 0 });
  assert.deepEqual(conversationDeleteMotion(-84), { translateX: 0, width: 84, labelOffsetX: 0 });
  const stretchedAction = conversationDeleteMotion(resisted);
  assert.ok(stretchedAction.width > 84 && stretchedAction.width <= 100);
  assert.ok(stretchedAction.labelOffsetX > 0 && stretchedAction.labelOffsetX <= 8);
});

test("conversation list restores page-colored rows and subtle dividers while confining Delete red to the action", () => {
  const css = readFileSync("app/messages/chat.css", "utf8");
  const wrapper = css.match(/\.conversation-swipe-row\s*\{([^}]+)\}/)?.[1] ?? "";
  const foreground = css.match(/\.conversation-row\s*\{([^}]+)\}/)?.[1] ?? "";
  const action = css.match(/\.chat-app button\.conversation-delete-action\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(wrapper, /background:\s*transparent/);
  assert.match(wrapper, /border-bottom:\s*1px solid color-mix\(in srgb, var\(--theme-text\) 2%, transparent\)/);
  assert.doesNotMatch(wrapper, /#d7464d/);
  assert.match(foreground, /background:\s*var\(--theme-background\)/);
  assert.match(foreground, /z-index:\s*2/);
  assert.match(action, /background:\s*#d7464d/);
  assert.match(action, /color:\s*white/);
  assert.match(action, /border:\s*0/);
  assert.match(action, /border-radius:\s*0/);
  assert.match(action, /outline:\s*0/);
  assert.match(action, /place-items:\s*center/);
  assert.match(action, /width:\s*84px/);
  const home = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(home, /aria-hidden=\{!rowOpen\}/);
  assert.match(home, /const deleteMotion = conversationDeleteMotion\(offset\)/);
  assert.match(home, /style=\{\{ width: `\$\{deleteMotion\.width\}px`, transform: `translateX\(\$\{deleteMotion\.translateX\}px\)` \}\}/);
  assert.match(home, /conversation-delete-label" style=\{\{ transform: `translateX\(\$\{deleteMotion\.labelOffsetX\}px\)` \}\}/);
});

test("conversation title and timestamp share a truncating first line above the preview", () => {
  const css = readFileSync("app/messages/chat.css", "utf8");
  const home = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(css, /\.conversation-title-line\s*\{[^}]*align-items:\s*center/);
  assert.match(css, /\.conversation-title-line strong\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.conversation-title-line time\s*\{[^}]*flex:\s*none/);
  assert.match(home, /<span className="conversation-title-line"><strong>\{name\}<\/strong>[\s\S]*?<time dateTime=/);
  assert.match(home, /<span className="conversation-preview">/);
  assert.match(css, /\.conversation-preview\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.conversation-summary\s*\{[^}]*padding-right:\s*14px/);
  assert.doesNotMatch(css.match(/\.conversation-title-line time\s*\{([^}]+)\}/)?.[1] ?? "", /margin/);
  assert.doesNotMatch(css.match(/\.conversation-row\s*\{([^}]+)\}/)?.[1] ?? "", /width:\s*100%|min-width:/);
});

test("foreground and Delete release together with a light bounce and respect reduced motion", () => {
  const css = readFileSync("app/messages/chat.css", "utf8");
  assert.match(css, /\.conversation-row\s*\{[^}]*transition:\s*transform 280ms cubic-bezier\(\.22, \.82, \.35, 1\.06\)/);
  assert.match(css, /\.chat-app button\.conversation-delete-action\s*\{[^}]*transition:\s*transform 280ms cubic-bezier\(\.22, \.82, \.35, 1\.06\),\s*width 280ms cubic-bezier\(\.22, \.82, \.35, 1\.06\)/);
  assert.match(css, /\.conversation-delete-label\s*\{[^}]*transition:\s*transform 280ms cubic-bezier\(\.22, \.82, \.35, 1\.06\)/);
  assert.match(css, /\.chat-app button\.conversation-delete-action\.is-dragging,[\s\S]*?transition:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.conversation-row, \.chat-app button\.conversation-delete-action,[\s\S]*?\.conversation-delete-label\s*\{\s*transition:\s*none/);
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

test("deleting direct and group Conversations leaves Contacts and Characters intact", async () => {
  const factory = new IDBFactory();
  const chat = new ChatStorage(() => factory);
  const backend = memory(), contacts = createContactStorage(() => backend.storage);
  const foundation = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => factory));
  const savedFoundation = await foundation.transact((current) => {
    const peter = createCharacter(current, normalizeCharacterInput({ name: "Peter" }));
    return createCharacter(peter, normalizeCharacterInput({ name: "Lan" }));
  });
  const [peter, lan] = savedFoundation.characters;
  await contacts.transact((current) => addContact(addContact(current, peter.characterId, 10), lan.characterId, 11));

  const direct = await chat.openSession(peter.characterId);
  await chat.send(direct.id, "private history");
  await chat.deleteSession(direct.id);
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), [peter.characterId, lan.characterId]);
  assert.deepEqual((await foundation.load()).characters.map((item) => item.name), ["Peter", "Lan"]);
  assert.notEqual((await chat.openSession(peter.characterId)).id, direct.id);

  const group = await chat.createGroupSession([peter.characterId, lan.characterId], "Friends");
  await chat.send(group.id, "group history");
  const batch = await chat.beginReply(group.id);
  assert(batch);
  await chat.finalizeReply(batch.assistant.id, "group reply", {
    cycle: 1, prefix: [], entries: { "group:entry": { stickyUntil: 2 } },
  });
  await chat.deleteSession(group.id);
  assert.equal((await chat.listSessions()).some((item) => item.id === group.id), false);
  assert.equal(await chat.readWorldBookState(group.id), null);
  assert.deepEqual((await contacts.load()).contacts.map((item) => item.characterId), [peter.characterId, lan.characterId]);
  assert.deepEqual((await foundation.load()).characters.map((item) => item.name), ["Peter", "Lan"]);
});
