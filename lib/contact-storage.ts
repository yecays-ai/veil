import type { StringStorage } from "./foundation-storage";

export const CONTACT_STORAGE_KEY = "veil.contacts.v1";
export type Contact = { id: string; characterId: string; createdAt: number };
export type ContactDocument = { version: 1; contacts: Contact[] };

function validId(value: unknown) {
  return typeof value === "string" && !!value.trim() && value.length <= 100 &&
    !["__proto__", "constructor", "prototype"].includes(value);
}
export function normalizeContacts(value: unknown): ContactDocument {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seen = new Set<string>();
  const contacts = (Array.isArray(raw.contacts) ? raw.contacts : []).flatMap((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!validId(row.characterId) || seen.has(row.characterId as string)) return [];
    seen.add(row.characterId as string);
    return [{ id: validId(row.id) ? row.id as string : crypto.randomUUID(),
      characterId: row.characterId as string,
      createdAt: typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : 0 }];
  });
  return { version: 1, contacts };
}
export function addContact(document: ContactDocument, characterId: string, now = Date.now()): ContactDocument {
  if (!validId(characterId) || document.contacts.some((item) => item.characterId === characterId)) return document;
  return { ...document, contacts: [...document.contacts,
    { id: crypto.randomUUID(), characterId, createdAt: now }] };
}
export function removeContact(document: ContactDocument, characterId: string): ContactDocument {
  return { ...document, contacts: document.contacts.filter((item) => item.characterId !== characterId) };
}
export function createContactStorage(getStorage: () => StringStorage) {
  let queue = Promise.resolve();
  const load = async () => {
    const raw = getStorage().getItem(CONTACT_STORAGE_KEY);
    return normalizeContacts(raw ? JSON.parse(raw) : null);
  };
  const transact = (update: (current: ContactDocument) => ContactDocument) => {
    const operation = queue.then(async () => {
      const next = normalizeContacts(update(await load()));
      getStorage().setItem(CONTACT_STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("veil-contacts-change"));
      return next;
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  return { load, transact,
    ensureCharacters: (ids: readonly string[]) => transact((current) =>
      ids.reduce((next, id) => addContact(next, id, 0), current)) };
}
export const browserContactStorage = createContactStorage(() => window.localStorage);
