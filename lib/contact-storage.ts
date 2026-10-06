import type { StringStorage } from "./storage-types";

export const CONTACT_STORAGE_KEY = "veil.contacts.v1";
export type ContactRemarkChange = { type: "remark-changed"; fromRemark: string | null; toRemark: string | null; createdAt: number };
export type Contact = { id: string; characterId: string; createdAt: number;
  remark: string | null; heroBackground: string | null; lastRemarkChange: ContactRemarkChange | null };
export type ContactDocument = { version: 1; contacts: Contact[] };

export function normalizeContactRemark(value: unknown): string | null {
  return typeof value === "string" ? value.trim().slice(0, 100) || null : null;
}
export function isContactHeroBackground(value: unknown): value is string {
  return typeof value === "string" && value.length <= 600_000 && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value);
}
export function contactDisplayName(contact: Pick<Contact, "remark"> | undefined, characterName: string): string {
  return normalizeContactRemark(contact?.remark) ?? characterName;
}
export function contactRemarkContext(contact: Contact): string | null {
  return contact.remark ? `The user's current contact remark for you is ${JSON.stringify(contact.remark)}.` : null;
}

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
    const event = row.lastRemarkChange && typeof row.lastRemarkChange === "object"
      ? row.lastRemarkChange as Record<string, unknown> : {};
    return [{ id: validId(row.id) ? row.id as string : crypto.randomUUID(),
      characterId: row.characterId as string,
      createdAt: typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : 0,
      remark: normalizeContactRemark(row.remark),
      heroBackground: isContactHeroBackground(row.heroBackground) ? row.heroBackground : null,
      lastRemarkChange: event.type === "remark-changed" && typeof event.createdAt === "number" && Number.isFinite(event.createdAt)
        ? { type: "remark-changed" as const, fromRemark: normalizeContactRemark(event.fromRemark),
          toRemark: normalizeContactRemark(event.toRemark), createdAt: event.createdAt } : null }];
  });
  return { version: 1, contacts };
}
export function addContact(document: ContactDocument, characterId: string, now = Date.now()): ContactDocument {
  if (!validId(characterId) || document.contacts.some((item) => item.characterId === characterId)) return document;
  return { ...document, contacts: [...document.contacts,
    { id: crypto.randomUUID(), characterId, createdAt: now, remark: null, heroBackground: null, lastRemarkChange: null }] };
}
export function updateContact(document: ContactDocument, characterId: string,
  patch: Pick<Contact, "remark" | "heroBackground">, now = Date.now()): ContactDocument {
  if (!document.contacts.some((item) => item.characterId === characterId)) throw new Error("Contact not found.");
  if (patch.heroBackground !== null && !isContactHeroBackground(patch.heroBackground)) throw new Error("Invalid Contact background.");
  const remark = normalizeContactRemark(patch.remark);
  return { ...document, contacts: document.contacts.map((contact) => contact.characterId !== characterId ? contact : {
    ...contact, remark, heroBackground: patch.heroBackground,
    lastRemarkChange: contact.remark === remark ? contact.lastRemarkChange
      : { type: "remark-changed", fromRemark: contact.remark, toRemark: remark, createdAt: now },
  }) };
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
  const exportPortable = async () => JSON.stringify(await load());
  const restorePortable = async (serialized: string) => {
    const raw: unknown = JSON.parse(serialized);
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as ContactDocument).contacts))
      throw new Error("Invalid Contacts backup.");
    const rows = (raw as ContactDocument).contacts;
    if (rows.some((row) => !row || !validId(row.characterId)
      || (row.heroBackground != null && !isContactHeroBackground(row.heroBackground))))
      throw new Error("Invalid Contacts backup.");
    const incoming = normalizeContacts(raw);
    return transact((current) => {
      const contacts = new Map(current.contacts.map((contact) => [contact.characterId, contact]));
      incoming.contacts.forEach((contact) => contacts.set(contact.characterId, contact));
      return { version: 1, contacts: [...contacts.values()] };
    });
  };
  return { load, transact, exportPortable, restorePortable };
}
export const browserContactStorage = createContactStorage(() => window.localStorage);
