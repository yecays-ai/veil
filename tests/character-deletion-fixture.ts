import { IDBFactory } from "fake-indexeddb";
import { createBindingStorage } from "../lib/binding-storage";
import type { PersistenceWriteGate, PersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import type { CleanupDeps } from "../lib/character-deletion";
import { deleteCharacterMemory } from "../lib/memory/lifecycle";
import { MemoryStorage } from "../lib/memory/storage";
import { ChatStorage } from "../lib/chat/storage";
import { addContact, createContactStorage, updateContact } from "../lib/contact-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { saveRelation, setNodePosition } from "../lib/foundation";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";
import { AppearanceImageStorage } from "../lib/appearance-image-storage";
import { addSituation, advanceLastSeen, createPresenceStorage, setRoutine, type PresenceDocument } from "../lib/presence/storage";
import { createThemeStorage } from "../lib/theme-storage";
import type { BindingDocument } from "../lib/bindings";
import type { ContactDocument } from "../lib/contact-storage";
import { normalizeDocument, type ThemeDocument } from "../lib/theme-types";

export const A = "char-alice-0001", B = "char-bob-0002", C = "char-carol-0003", D = "char-dave-0004";
export const HERO = "data:image/png;base64,iVBORw0KGgo=";
const png = (label: string) => new Blob([label], { type: "image/png" });

/** Real Foundation, Chat, Contacts, Bindings and Appearance stores over fake IndexedDB and an in-memory localStorage. */
export async function buildWorld(options: { aBackground?: "shared" | "exclusive"; gate?: PersistenceWriteGate } = {}) {
  const factory = new IDBFactory(), values = new Map<string, string>();
  const raw = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const { gate } = options, noLocks = () => undefined;
  const foundation = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => factory, gate));
  const chat = gate ? new ChatStorage(() => factory, noLocks, gate) : new ChatStorage(() => factory);
  const themeStore = createThemeStorage(() => raw, new AppearanceImageStorage(() => factory, Date.now, gate));
  const contactStore = createContactStorage(() => raw, gate && noLocks, gate), bindingStore = createBindingStorage(() => raw, gate && noLocks, gate);
  const presenceStore = createPresenceStorage(() => raw, gate && noLocks, gate);

  await foundation.transact((document) => {
    let next: FoundationDocument = { ...document, characters: [A, B, C, D].map((characterId) => ({ characterId,
      ...normalizeCharacterInput({ name: characterId.split("-")[1], avatar: HERO }) })) };
    const relation = (a: string, b: string) => ({ characterAId: a, characterBId: b, kind: null, label: `${a}-${b}`, aToBContext: null, bToAContext: null, sharedHistory: null });
    next = saveRelation(next, relation(A, B)); next = saveRelation(next, relation(B, C));
    for (const [index, id] of [A, B, C, D].entries()) next = setNodePosition(next, id, { x: 10 + index, y: 20 + index });
    return next;
  });

  const shared = await chat.saveChatImage(png("shared wallpaper")), exclusive = await chat.saveChatImage(png("alice only"));
  const sessionA = await chat.openSession(A), sessionB = await chat.openSession(B);
  for (const text of ["a1", "a2", "a3"]) await chat.send(sessionA.id, text);
  for (const text of ["b1", "b2"]) await chat.send(sessionB.id, text);
  await chat.updateSessionSettings(sessionA.id, { backgroundImage: options.aBackground === "exclusive" ? exclusive : shared, customCSS: ".chat-bubble { opacity: .9; }" });
  await chat.updateSessionSettings(sessionB.id, { backgroundImage: shared });
  await chat.updateGlobalChatBackground(shared);
  await putRaw(factory, "worldBookStates", { id: sessionA.id, state: { cycle: 1, prefix: [], entries: {} } });
  await putRaw(factory, "worldBookStates", { id: sessionB.id, state: { cycle: 2, prefix: [], entries: {} } });
  const trio = await chat.createGroupSession([A, B, C], "Trio"), pair = await chat.createGroupSession([B, C], "Pair");
  const duo = await chat.createGroupSession([A, B], "Duo"), withDave = await chat.createGroupSession([A, D], "Alice and Dave");

  await contactStore.transact((document) => addContact(addContact(document, A), B));
  for (const id of [A, B]) await contactStore.transact((document) => updateContact(document, id, { remark: `remark ${id}`, heroBackground: HERO }));
  await bindingStore.transact(() => ({ global: { apiConfigId: "api" }, characters: {
    [A]: { defaults: { presetId: "preset-a" }, apps: {} }, [B]: { defaults: { presetId: "preset-b" }, apps: {} } } }));

  const routine = { blocks: [{ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080, status: "busy" as const }], defaultStatus: "online" as const, jitterMinutes: 30 };
  for (const id of [A, B]) {
    await presenceStore.transact((document) => setRoutine(document, id, routine, { changedAt: 1, source: "generated" }));
    await presenceStore.transact((document) => addSituation(document, id, { status: "offline", reason: `mission ${id}`, startsAt: 5_000, endsAt: 9_000 }, { changedAt: 5_000, source: "msg-1" }, 5_000));
    await presenceStore.transact((document) => advanceLastSeen(document, id, { lastOnlineAt: 4_000, lastMessageAt: 4_500 }, 6_000));
  }

  const comment = (characterId: string, text: string) => ({ characterId, text, generatedAt: "2026-10-08T00:00:00.000Z" });
  const base = normalizeDocument(null);
  const layout = (aWidget: boolean): ThemeDocument["current"] => ({ ...base.current, widgets: [
    { id: "ht-a", type: "here-there", size: "4x2", page: 1, row: 1, col: 1, config: { hour12: true, showSeconds: false, ...(aWidget ? { characterId: A, comment: comment(A, "alice remark") } : { characterId: D, comment: comment(D, "dave remark") }) } },
    { id: "ht-b", type: "here-there", size: "4x2", page: 1, row: 3, col: 1, config: { hour12: false, showSeconds: false, characterId: B, comment: comment(B, "bob remark") } },
    { id: "clock", type: "clock", size: "2x2", page: 1, row: 5, col: 1, config: { hour12: false, showSeconds: true } }] });
  await themeStore.transact(() => ({ ...base, current: layout(true), presets: [
    { id: "preset-with-a", name: "With Alice", snapshot: layout(true) }, { id: "preset-without", name: "Without", snapshot: layout(false) }] }));

  const memoryStorage = new MemoryStorage(() => factory, Date.now, gate);
  const deps: CleanupDeps = {
    theme: { load: () => themeStore.load(), update: (update, scope) => themeStore.transact(update, scope) },
    contacts: { load: () => contactStore.load(), update: (update, scope) => contactStore.transact(update, scope) },
    bindings: { load: () => bindingStore.load(), update: (update, scope) => bindingStore.transact(update, scope) },
    presence: { load: () => presenceStore.load(), update: (update, scope) => presenceStore.transact(update, scope) },
    chat,
    memory: { deleteCharacter: (characterId, scope) => deleteCharacterMemory(memoryStorage, characterId, scope) },
  };
  const commitFoundation = (update: (document: FoundationDocument) => FoundationDocument, scope?: PersistenceWriteScope) => foundation.transact(update, scope);
  return { factory, foundation, chat, deps, commitFoundation, themeStore, contactStore, bindingStore, presenceStore, raw: values,
    memoryStorage, ids: { sessionA, sessionB, trio, pair, duo, withDave, shared, exclusive }, snapshot: () => snapshot(factory, { foundation, themeStore, contactStore, bindingStore, presenceStore }) };
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = factory.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function putRaw(factory: IDBFactory, store: string, value: unknown) {
  const db = await open(factory, "veil-chat-v2");
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
async function readAll(factory: IDBFactory, store: string): Promise<unknown[]> {
  const db = await open(factory, "veil-chat-v2");
  const rows = await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close();
  return rows;
}
export async function putWorldBookState(factory: IDBFactory, sessionId: string) { await putRaw(factory, "worldBookStates", { id: sessionId, state: { cycle: 9, prefix: [], entries: {} } }); }

/** Every persisted record of every store, as plain data, so a test can compare whole worlds and search for a leftover ID. */
export async function snapshot(factory: IDBFactory, stores: { foundation: { load(): Promise<FoundationDocument> }; themeStore: { load(): Promise<ThemeDocument> };
  contactStore: { load(): Promise<ContactDocument> }; bindingStore: { load(): Promise<BindingDocument> };
  presenceStore: { load(): Promise<PresenceDocument> } }) {
  const sort = (rows: unknown[]) => [...rows].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const assets = (await readAll(factory, "assets")).map((asset) => { const { id, blob } = asset as { id: string; blob: Blob }; return { id, size: blob.size }; });
  return { foundation: await stores.foundation.load(), theme: await stores.themeStore.load(), contacts: await stores.contactStore.load(),
    bindings: await stores.bindingStore.load(), presence: await stores.presenceStore.load(), sessions: sort(await readAll(factory, "sessions")), messages: sort(await readAll(factory, "messages")),
    worldBookStates: sort(await readAll(factory, "worldBookStates")), assets: sort(assets), chatSettings: sort(await readAll(factory, "chatSettings")) };
}
export type World = Awaited<ReturnType<typeof buildWorld>>;
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
