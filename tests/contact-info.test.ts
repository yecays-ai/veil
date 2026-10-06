import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { addContact, normalizeContacts, updateContact, removeContact, contactDisplayName, createContactStorage } from "../lib/contact-storage";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createCharacter } from "../lib/foundation";
import { normalizeCharacterInput } from "../lib/foundation-types";
import { contactReturnTarget } from "../lib/contact-navigation";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=";
function backend() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("Contact remark normalizes, falls back to Character name and keeps structured relationship metadata", () => {
  let document = addContact(normalizeContacts(null), "peter", 100);
  assert.equal(contactDisplayName(document.contacts[0], "Peter"), "Peter");
  document = updateContact(document, "peter", { remark: " Simba ", heroBackground: null }, 200);
  assert.equal(contactDisplayName(document.contacts[0], "Peter"), "Simba");
  assert.deepEqual(document.contacts[0].lastRemarkChange, { type: "remark-changed", fromRemark: null, toRemark: "Simba", createdAt: 200 });
  document = updateContact(document, "peter", { remark: "Simba", heroBackground: image }, 300);
  assert.equal(document.contacts[0].lastRemarkChange?.createdAt, 200);
  document = updateContact(document, "peter", { remark: "  ", heroBackground: null }, 400);
  assert.equal(contactDisplayName(document.contacts[0], "Peter"), "Peter");
  assert.equal(document.contacts[0].lastRemarkChange?.fromRemark, "Simba");
});

test("Contact display helper applies the current remark only to direct contact identity", () => {
  const contact = addContact(normalizeContacts(null), "peter", 100).contacts[0];
  const renamed = updateContact({ version: 1, contacts: [contact] }, "peter", { remark: " Simba ", heroBackground: null }).contacts[0];
  assert.equal(contactDisplayName(renamed, "Peter Parker"), "Simba");
  assert.equal(contactDisplayName({ ...renamed, remark: "  " }, "Peter Parker"), "Peter Parker");
  assert.equal(contactDisplayName(undefined, "Peter Parker"), "Peter Parker");
});

test("Contact Info return targets permit only Contacts or the matching direct chat", () => {
  assert.equal(contactReturnTarget("peter", undefined), "/contacts");
  assert.equal(contactReturnTarget("peter", "direct"), "/messages/peter");
  assert.equal(contactReturnTarget("peter parker", "direct"), "/messages/peter%20parker");
  assert.equal(contactReturnTarget("", "direct"), "/contacts");
  assert.equal(contactReturnTarget("peter", "external"), "/contacts");
});

test("Contact changes preserve Foundation, unique chat, history and both chat backgrounds with zero network calls", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Unexpected provider/network call"); });
  const factory = new IDBFactory();
  const foundation = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => factory));
  const saved = await foundation.transact((current) => createCharacter(current, normalizeCharacterInput({ name: "Peter", avatar: image, presence: "online" })));
  const peter = saved.characters.at(-1)!;
  const chat = new ChatStorage(() => factory);
  const session = await chat.openSession(peter.characterId);
  await chat.send(session.id, "Existing history");
  const background = await chat.saveChatImage(new Blob(["background"], { type: "image/png" }));
  await chat.updateGlobalChatBackground(background);
  await chat.updateSessionSettings(session.id, { backgroundImage: background });
  const beforeChat = await chat.readSession(session.id);
  const memory = backend(), contacts = createContactStorage(() => memory);
  await contacts.transact((current) => addContact(addContact(current, peter.characterId, 100), "other", 100));
  await contacts.transact((current) => updateContact(current, peter.characterId, { remark: "Simba", heroBackground: image }, 200));
  const reloaded = await createContactStorage(() => memory).load();
  assert.equal(reloaded.contacts[0].remark, "Simba");
  assert.equal(reloaded.contacts[0].heroBackground, image);
  assert.equal(reloaded.contacts[1].heroBackground, null);
  assert.equal("presence" in reloaded.contacts[0], false);
  assert.deepEqual(await foundation.load(), saved);
  assert.deepEqual(await chat.readSession(session.id), beforeChat);
  assert.equal((await chat.readChatBackgroundSettings()).globalChatBackgroundImage, background);
  await contacts.transact((current) => removeContact(current, peter.characterId));
  assert.equal((await contacts.load()).contacts.some((contact) => contact.characterId === peter.characterId), false);
  assert.deepEqual(await foundation.load(), saved);
  assert.deepEqual(await chat.readSession(session.id), beforeChat);
  await contacts.transact((current) => addContact(current, peter.characterId));
  assert.equal((await chat.openSession(peter.characterId)).id, session.id);
  assert.equal(requests, 0);
});

test("portable Contacts backup carries remark, image and metadata without credentials and rejects unsafe images", async () => {
  const memory = backend(), source = createContactStorage(() => memory);
  await source.transact((current) => addContact(current, "peter", 100));
  await source.transact((current) => updateContact(current, "peter", { remark: "Simba", heroBackground: image }, 200));
  const serialized = await source.exportPortable();
  const restoreMemory = backend(), restored = createContactStorage(() => restoreMemory);
  await restored.restorePortable(serialized);
  assert.deepEqual(await restored.load(), await source.load());
  assert.doesNotMatch(serialized, /apiKey|presence|personality/);
  await assert.rejects(restored.restorePortable(JSON.stringify({ contacts: [{ characterId: "peter", heroBackground: "javascript:alert(1)" }] })));
  assert.deepEqual(await restored.load(), await source.load());
  assert.equal(normalizeContacts({ contacts: [{ characterId: "p", remark: " ", presence: "online", heroBackground: "https://example.test/image" }] }).contacts[0].heroBackground, null);
});

test("failed Contact save retains previous relationship data", async () => {
  const memory = backend(); let fail = false;
  const store = createContactStorage(() => ({ ...memory, setItem: (key, value) => { if (fail) throw new Error("Quota exceeded"); memory.setItem(key, value); } }));
  await store.transact((current) => addContact(current, "peter", 100));
  const before = await store.load(); fail = true;
  await assert.rejects(store.transact((current) => updateContact(current, "peter", { remark: "Simba", heroBackground: image })));
  assert.deepEqual(await store.load(), before);
});

test("Contact Info route structure has real actions and honest placeholders with no authoring or last-active UI", () => {
  const info = readFileSync("components/contact-info.tsx", "utf8");
  const list = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(list, /contactDisplayName\(contactByCharacter/);
  assert.match(list, /contactMatches\(character\.name, contactByCharacter/);
  for (const text of ["Back to Contacts", "Edit", "Save", "Cancel", "Message", "Shared Media", "Relationship", "Contact since", "Block Contact", "Delete Contact"])
    assert.ok(info.includes(text));
  assert.match(info, /disabled title="Call unavailable"/);
  assert.match(info, /disabled title="Video unavailable"/);
  assert.match(info, /<button type="button" disabled>Block Contact/);
  assert.match(info, /\[0, 1, 2, 3\]\.map/);
  assert.match(info, /href=\{`\/social\//);
  assert.match(info, /className="contact-hero-background-trigger" aria-label="Change Hero Background"/);
  assert.match(info, /className="contact-hero-name-input" aria-label="Contact name"/);
  assert.doesNotMatch(info, /Contact Remark|>Choose Background<|autoFocus/);
  assert.match(info, /This removes the Contact relationship\. The Character, conversation and chat history will remain\./);
  assert.match(info, /className="contact-danger-area"/);
  assert.match(info, /className="contact-delete-dialog"/);
  assert.match(info, /useLayoutEffect\(\(\) => \{[\s\S]*?showModal\(\);[\s\S]*?focus\(\{ preventScroll: true \}\)/);
  assert.match(info, /<dialog ref=\{ref\} tabIndex=\{-1\}/);
  assert.match(info, /character\.presence/);
  assert.doesNotMatch(info, /occupation|location\.label|lastActive|Last active|\/characters\/|requestReply|chat\/provider|PageShell|primary-button/);
  const social = readFileSync("components/character-social-profile.tsx", "utf8");
  assert.doesNotMatch(social, /\/characters\/|personality|backstory|speakingStyle/);
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(room, /contactDisplayName\(contact, character\.name\)/);
  assert.match(room, /<Link href=\{`\/contacts\/\$\{encodeURIComponent\(character\.characterId\)\}\?from=direct`\}[\s\S]*?className="chat-contact-summary page-title"/);
  const messages = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(messages, /group \? session\.title \?\? "Group" : character[\s\S]*?contactDisplayName\(contactByCharacter/);
  assert.doesNotMatch(messages, /group \? session\.title \?\? "Group" : session\.remark/);
  assert.doesNotMatch(room, /session\?\.remark \|\| character\.name/);
  const css = readFileSync("app/contacts/contact-info.css", "utf8");
  assert.match(css, /\.contact-danger-area button:first-child::after\s*\{[^}]*right:\s*18px;[^}]*left:\s*18px/);
  assert.match(css, /\.contact-danger-area\s*\{[^}]*border-radius:\s*16px;[^}]*background:\s*var\(--theme-surface\)/);
  assert.match(css, /\.contact-delete-dialog button\s*\{[^}]*border-radius:\s*12px/);
  assert.match(css, /\.contact-delete-dialog:focus\s*\{\s*outline:\s*none/);
  assert.match(readFileSync("lib/ui-copy.ts", "utf8"), /genderSuggestions: \["Male", "Female", "Non-binary", "Prefer not to say"\]/);
});
