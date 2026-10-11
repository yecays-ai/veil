import type { StringStorage } from "./storage-types";
import { browserPersistenceWriteGate, type PersistenceWriteGate } from "./backup/persistence-write-gate";

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
// Same-Contact conflict rule: when `base` (the values the editor started from) is given,
// only fields the user actually changed are applied; untouched fields keep whatever is
// currently stored, so a concurrent edit to the other field is not rolled back. If both
// sides changed the same field, the later committed write wins. Without `base`, the whole
// patch is applied (previous behavior).
export function updateContact(document: ContactDocument, characterId: string,
  patch: Pick<Contact, "remark" | "heroBackground">, now = Date.now(),
  base?: Pick<Contact, "remark" | "heroBackground">): ContactDocument {
  if (!document.contacts.some((item) => item.characterId === characterId)) throw new Error("Contact not found.");
  if (patch.heroBackground !== null && !isContactHeroBackground(patch.heroBackground)) throw new Error("Invalid Contact background.");
  return { ...document, contacts: document.contacts.map((contact) => {
    if (contact.characterId !== characterId) return contact;
    const remark = base && normalizeContactRemark(base.remark) === normalizeContactRemark(patch.remark)
      ? contact.remark : normalizeContactRemark(patch.remark);
    const heroBackground = base && base.heroBackground === patch.heroBackground
      ? contact.heroBackground : patch.heroBackground;
    return { ...contact, remark, heroBackground,
      lastRemarkChange: contact.remark === remark ? contact.lastRemarkChange
        : { type: "remark-changed", fromRemark: contact.remark, toRemark: remark, createdAt: now } };
  }) };
}
/** The remark change `next` made relative to `before` for one Contact, or null when this write left the remark alone. */
export function remarkChangeMade(before: ContactDocument, next: ContactDocument, characterId: string): ContactRemarkChange | null {
  const was = before.contacts.find((item) => item.characterId === characterId)?.lastRemarkChange ?? null;
  const now = next.contacts.find((item) => item.characterId === characterId)?.lastRemarkChange ?? null;
  return now && now !== was ? now : null;
}
export function removeContact(document: ContactDocument, characterId: string): ContactDocument {
  return { ...document, contacts: document.contacts.filter((item) => item.characterId !== characterId) };
}
const WRITE_ATTEMPTS = 3;
/**
 * Writes are one read-modify-write of the whole document, so they are coordinated at three levels:
 * 1. This instance queues its own writes in order.
 * 2. Across tabs, each write holds an exclusive Web Lock (`CONTACT_STORAGE_KEY`), so cooperating
 *    tabs run their read-modify-write one at a time and every write starts from the latest document.
 *    Without Web Locks (`getLocks()` undefined) only levels 1 and 3 apply.
 * 3. Just before writing, the stored value is re-read; if another context changed it since the
 *    read, the update is recomputed from the new value (at most WRITE_ATTEMPTS times, then the
 *    write fails and nothing is saved). This narrows, but cannot close, the gap between that
 *    re-read and setItem, which localStorage cannot make atomic; it is not a substitute for the lock.
 * A failed write never changes stored data and never blocks later writes.
 */
export function createContactStorage(getStorage: () => StringStorage,
  getLocks: () => Pick<LockManager, "request"> | undefined = () => globalThis.navigator?.locks,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate) {
  let queue: Promise<unknown> = Promise.resolve();
  const parse = (raw: string | null) => normalizeContacts(raw ? JSON.parse(raw) : null);
  const load = async () => parse(getStorage().getItem(CONTACT_STORAGE_KEY));
  const commit = (update: (current: ContactDocument) => ContactDocument): ContactDocument => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const before = getStorage().getItem(CONTACT_STORAGE_KEY);
      const next = normalizeContacts(update(parse(before)));
      if (getStorage().getItem(CONTACT_STORAGE_KEY) !== before) continue;
      getStorage().setItem(CONTACT_STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("veil-contacts-change"));
      return next;
    }
    throw new Error("Contacts changed in another tab. Nothing was saved; try again.");
  };
  const transact = (update: (current: ContactDocument) => ContactDocument) => {
    const run = () => writeGate.withWrite(async () => {
      const locks = getLocks();
      return locks ? await locks.request(CONTACT_STORAGE_KEY, { mode: "exclusive" }, async () => commit(update))
        : commit(update);
    });
    const operation = queue.then(run, run);
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
