import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createCharacter, deleteCharacter, saveRelation, saveUniverse, updateCharacter } from "../lib/foundation";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";
import { allUniverses, characterUniverseId, createUniverse, editUniverse, sessionUniverseId, universeForCharacter } from "../lib/universe";
import { ChatStorage } from "../lib/chat/storage";
import { sortChatSessions } from "../lib/chat/session-order";
import { createChatEngine } from "./chat-engine-fixture";
import { normalizeWorldBook } from "../lib/worldbook";
import { createPresenceStorage, setUserNote, presenceRecord, removePresence } from "../lib/presence/storage";
import { MemoryStorage } from "../lib/memory/storage";
import { deleteCharacterMemory } from "../lib/memory/lifecycle";
import { createPack, setPackCharacter, packsForCharacter, emptyStickerDocument } from "../lib/chat/sticker-storage";
import { backupData, packageFixture } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { saveUser } from "../lib/foundation";

function setup() {
  let document = saveUniverse(defaultFoundation(), "Spider-Man", "SPIDER_WORLD_SECRET");
  document = createUniverse(document, "Call of Duty");
  const worlds = allUniverses(document);
  document = editUniverse(document, worlds[1].id, (d) => saveUniverse(d, d.universe.name, "COD_WORLD_SECRET"));
  for (const [name, universeId] of [["Peter", worlds[0].id], ["Ghost", worlds[1].id], ["Soap", worlds[1].id]]) {
    document = createCharacter(document, { ...normalizeCharacterInput({ name }), universeId });
  }
  document.runtime.timeAware = false;
  const [peter, ghost, soap] = document.characters;
  const storage = new ChatStorage(() => new IDBFactory(), undefined, undefined, false, undefined, async () => document);
  return { document, worlds, peter, ghost, soap, storage };
}

test("two named partitions persist ownership, scoped relations and rename without moving Characters", () => {
  const { worlds, peter, ghost, soap, ...app } = setup();
  let document = app.document;
  document = editUniverse(document, worlds[1].id, (d) => saveRelation(d, { characterAId: ghost.characterId, characterBId: soap.characterId,
    label: "COD_RELATION_SECRET", kind: "friend", aToBContext: null, bToAContext: null, sharedHistory: null }));
  assert.throws(() => saveRelation(document, { characterAId: peter.characterId, characterBId: ghost.characterId,
    label: "wrong", kind: null, aToBContext: null, bToAContext: null, sharedHistory: null }), /existing Characters/);
  const reloaded = normalizeFoundation(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(reloaded, document);
  assert.equal(universeForCharacter(reloaded, ghost).relations[0].label, "COD_RELATION_SECRET");
  assert.equal(universeForCharacter(reloaded, peter).relations.length, 0);
  const renamed = editUniverse(reloaded, worlds[1].id, (d) => saveUniverse(d, "Call of Duty renamed", "COD_WORLD_SECRET"));
  assert.equal(characterUniverseId(renamed.characters[1]), worlds[1].id);
  assert.throws(() => updateCharacter(renamed, peter.characterId, { ...peter, universeId: worlds[1].id }), /cannot be changed/);
  assert.throws(() => createCharacter(renamed, { ...normalizeCharacterInput({ name: "Invalid" }), universeId: "missing" }), /existing Universe/);
  const deleted = deleteCharacter(renamed, ghost.characterId);
  assert.deepEqual(deleted.characters.find((c) => c.characterId === peter.characterId), peter);
  assert.equal(universeForCharacter(deleted, soap).relations.length, 0);
  assert.equal(deleted.user.name, document.user.name);
});

test("global sessions retain both worlds, sort on new messages, preserve group ownership after all members leave", async () => {
  const { document, peter, ghost, soap, worlds, storage } = setup();
  const a = await storage.openSession(peter.characterId), b = await storage.openSession(ghost.characterId);
  assert.equal(a.universeId, worlds[0].id); assert.equal(b.universeId, worlds[1].id);
  assert.equal((await storage.openSession(peter.characterId)).id, a.id);
  await storage.send(a.id, "hello Peter"); await storage.send(b.id, "hello Ghost");
  assert.equal((await storage.listSessions()).length, 2);
  assert.equal(sortChatSessions(await storage.listSessions())[0].id, b.id);
  assert.deepEqual((await storage.readSession(a.id)).messages.map((m) => m.content), ["hello Peter"]);
  await assert.rejects(storage.createGroupSession([peter.characterId, ghost.characterId], "Mixed"), /same Universe/);
  const group = await storage.createGroupSession([ghost.characterId, soap.characterId], "COD group");
  await storage.removeGroupMembers([ghost.characterId, soap.characterId]);
  const empty = (await storage.readSession(group.id)).session;
  assert.equal(sessionUniverseId(document, empty), worlds[1].id);
  await storage.deleteSession(a.id);
  assert.equal((await storage.readSession(b.id)).messages[0].content, "hello Ghost");
});

test("reply and proactive generation resolve the Character world and reject explicitly bound foreign WorldBooks", async () => {
  const { document, peter, ghost, worlds, storage } = setup();
  const books = worlds.map((u, index) => normalizeWorldBook({ name: u.name, universeId: u.id,
    entries: [{ content: index ? "COD_BOOK_SECRET" : "SPIDER_BOOK_SECRET", constant: true }] }));
  const prompts: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_c, turns) {
    prompts.push(turns.map((t) => t.content).join("\n")); yield "Hello.";
  }, undefined, undefined, async () => ({ version: 1, books }), undefined,
  async () => ({ global: { worldBookIds: books.map((b) => b.id) }, characters: {} }), undefined, undefined,
  async () => {}, async () => undefined, async () => {});
  const a = await storage.openSession(peter.characterId), b = await storage.openSession(ghost.characterId);
  await storage.send(a.id, "hi"); await engine.requestReply(a.id);
  await storage.send(b.id, "hi"); await engine.requestReply(b.id);
  assert.match(prompts[0], /SPIDER_WORLD_SECRET/); assert.match(prompts[0], /SPIDER_BOOK_SECRET/);
  assert.doesNotMatch(prompts[0], /COD_WORLD_SECRET|COD_BOOK_SECRET/);
  assert.match(prompts[1], /COD_WORLD_SECRET/); assert.match(prompts[1], /COD_BOOK_SECRET/);
  assert.doesNotMatch(prompts[1], /SPIDER_WORLD_SECRET|SPIDER_BOOK_SECRET/);
  await engine.initiate(b.id);
  assert.match(prompts[2], /COD_WORLD_SECRET/); assert.doesNotMatch(prompts[2], /SPIDER_WORLD_SECRET|SPIDER_BOOK_SECRET/);
});

test("Memory, Presence and sticker bindings keep Character ownership after another world is modified or deleted", async () => {
  const { peter, ghost } = setup();
  const factory = new IDBFactory(); const memory = new MemoryStorage(() => factory);
  for (const c of [peter, ghost]) await memory.applyChange(c.characterId, "add", { put: [{ id: c.characterId, characterId: c.characterId,
    kind: "fact", text: `${c.name} only`, subject: "character", status: "active", origin: "manual", sources: [], lineage: {} }] });
  assert.deepEqual((await memory.listMemories(peter.characterId)).map((m) => m.text), ["Peter only"]);
  await deleteCharacterMemory(memory, peter.characterId);
  assert.deepEqual((await memory.listMemories(ghost.characterId)).map((m) => m.text), ["Ghost only"]);
  const rows = new Map<string, string>();
  const presence = createPresenceStorage(() => ({ getItem: (k) => rows.get(k) ?? null, setItem: (k, v) => { rows.set(k, v); }, removeItem: (k) => { rows.delete(k); } }));
  await presence.transact((d) => setUserNote(setUserNote(d, peter.characterId, "Peter note", { changedAt: 1, source: null }), ghost.characterId, "Ghost note", { changedAt: 1, source: null }));
  await presence.transact((d) => removePresence(d, peter.characterId));
  assert.equal(presenceRecord(await presence.load(), ghost.characterId)?.userNote?.text, "Ghost note");
  const stickers = setPackCharacter(createPack(emptyStickerDocument(), "Peter pack", "", "pack", 1), "pack", peter.characterId, true);
  assert.equal(packsForCharacter(stickers, ghost.characterId).length, 0);
});

test("backup preserves multiple Universes and refuses foreign session ownership and unknown book ownership", async () => {
  const { document, worlds, peter, storage } = setup();
  const session = await storage.openSession(peter.characterId);
  const data = backupData(); data.foundation = document; data.contacts = null; data.presence = null; data.bindings = null; data.appearance = null;
  data.memory = { memories: [], suppressions: [], operations: [], cursors: [], backgrounds: [], states: [] };
  data.chat = { sessions: [session], messages: [], chatSettings: [], worldBookStates: [] };
  data.worldbooks = { version: 1, books: [normalizeWorldBook({ name: "COD", universeId: worlds[1].id })] };
  const check = async () => { const pkg = await packageFixture(data); return validateBackupPackage(JSON.stringify(pkg.manifest), pkg.files); };
  assert.deepEqual((await check()).data.foundation, document);
  data.chat.sessions[0] = { ...session, universeId: worlds[1].id };
  await assert.rejects(check());
  data.chat.sessions[0] = session; data.worldbooks.books[0].universeId = "missing";
  await assert.rejects(check());
});

test("legacy Character ownership follows the stored primary through load and a later transaction", async () => {
  let raw = JSON.stringify({ universe: { id: "stored-primary", name: "Stored world" },
    characters: [{ characterId: "legacy", name: "Legacy" }] });
  const storage = createIndexedDBFoundationStorage({
    read: async () => raw,
    putIfAbsent: async (_key, value) => value,
    replaceIfCurrent: async (_key, expected, value) => { if (raw !== expected) return false; raw = value; return true; },
    rollbackIfCurrent: async () => false,
  });
  const loaded = await storage.load();
  assert.equal(loaded.characters.length, 1);
  assert.equal(loaded.characters[0].universeId, "stored-primary");
  const saved = await storage.transact((d) => saveUser(d, { ...d.user, name: "Updated user" }));
  assert.deepEqual(saved.characters, loaded.characters);
  assert.deepEqual((await storage.load()).characters, loaded.characters);
  assert.equal(JSON.parse(raw).characters[0].universeId, "stored-primary");
});

test("additional Universe ids normalize before deduplication and Character membership", () => {
  const id100 = "a".repeat(100);
  const document = normalizeFoundation({ universe: { id: " primary ", name: "Primary" }, universes: [
    { id: " cod ", name: "First COD" }, { id: "cod", name: "Duplicate COD" },
    { id: " primary ", name: "Duplicate primary" }, { id: " ", name: "Blank" },
    { id: `${id100}extra`, name: "Long" }, { id: id100, name: "Duplicate long" },
  ], characters: [{ characterId: "ghost", name: "Ghost", universeId: " cod " },
    { characterId: "long", name: "Long", universeId: `${id100}extra` }] });
  assert.deepEqual(allUniverses(document).map((u) => [u.id, u.name]), [["primary", "Primary"], ["cod", "First COD"], [id100, "Long"]]);
  assert.deepEqual(document.characters.map((c) => c.universeId), ["cod", id100]);
  assert.deepEqual(normalizeFoundation(JSON.parse(JSON.stringify(document))), document);
});

test("a partial WorldBook backup needs no Foundation; a present Foundation still validates ownership", async () => {
  const data = backupData();
  data.foundation = null; data.appearance = null; data.contacts = null; data.bindings = null; data.presence = null;
  data.chat = { sessions: [], messages: [], chatSettings: [], worldBookStates: [] };
  data.memory = { memories: [], suppressions: [], operations: [], cursors: [], backgrounds: [], states: [] };
  data.worldbooks = { version: 1, books: [normalizeWorldBook({ name: "Partial book", universeId: "partial-world" })] };
  const check = async () => { const pkg = await packageFixture(data); return validateBackupPackage(JSON.stringify(pkg.manifest), pkg.files); };
  assert.equal((await check()).data.worldbooks?.books[0].universeId, "partial-world");
  data.foundation = normalizeFoundation({ universe: { id: "other", name: "Other" } });
  await assert.rejects(check(), (error: unknown) => (error as { code: string }).code === "cross-character-reference");
  data.foundation = normalizeFoundation({ universe: { id: "partial-world", name: "Partial world" } });
  assert.equal((await check()).data.worldbooks?.books.length, 1);
});
