import type { StringStorage } from "../storage-types";
import { browserPersistenceWriteGate, runPersistenceWrite, type PersistenceWriteGate } from "../backup/persistence-write-gate";
import { normalizeStickerUrl, STICKER_NAME_MAX, type StickerRow } from "./sticker-import";
import { stickerLabel, type MessageSticker } from "./sticker-message";

// The user's sticker library: packs of named image links, and which Characters may send each pack. One small
// document of its own; it holds links only (no image data), never reads or writes chat, Character or Memory data,
// and a pack outlives any chat. Reading never writes.

export const STICKER_STORAGE_KEY = "veil.stickers.v1";
export const STICKER_CHANGE_EVENT = "veil-stickers-change";
export const PACK_NAME_MAX = 40;
export const PACK_NOTE_MAX = 500;
export const MAX_PACKS = 50;
export const MAX_STICKERS_PER_PACK = 500;
const MAX_BINDINGS = 200;

export type Sticker = { id: string; name: string; url: string };
export type StickerPack = {
  id: string;
  name: string;
  /** Absent until set. */
  note?: string;
  stickers: Sticker[];
  /** Characters allowed to send from this pack. Absent while none is bound. */
  characterIds?: string[];
  createdAt: number;
};
export type StickerDocument = { version: 1; packs: StickerPack[] };
export const emptyStickerDocument = (): StickerDocument => ({ version: 1, packs: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string"
  ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("").trim() : "";
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function normalizeSticker(value: unknown): Sticker | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.url !== "string") return null;
  const name = text(value.name, STICKER_NAME_MAX), url = normalizeStickerUrl(value.url);
  return name && url ? { id: value.id, name, url } : null;
}

/** Drops what cannot be read (a bad row never blocks the rest) and enforces the limits. */
export function normalizeStickerDocument(value: unknown): StickerDocument {
  if (!isRecord(value) || !Array.isArray(value.packs)) return emptyStickerDocument();
  const ids = new Set<string>(), packs: StickerPack[] = [];
  for (const raw of value.packs.slice(0, MAX_PACKS)) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || ids.has(raw.id)) continue;
    const name = text(raw.name, PACK_NAME_MAX);
    if (!name) continue;
    ids.add(raw.id);
    const stickerIds = new Set<string>();
    const stickers = (Array.isArray(raw.stickers) ? raw.stickers : []).map(normalizeSticker)
      .filter((item): item is Sticker => !!item && !stickerIds.has(item.id) && !!stickerIds.add(item.id)).slice(0, MAX_STICKERS_PER_PACK);
    const note = typeof raw.note === "string" ? Array.from(raw.note.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim()).slice(0, PACK_NOTE_MAX).join("") : "";
    const characterIds = Array.isArray(raw.characterIds)
      ? [...new Set(raw.characterIds.filter((id): id is string => typeof id === "string" && !!id))].slice(0, MAX_BINDINGS) : [];
    packs.push({ id: raw.id, name, ...(note ? { note } : {}), stickers, ...(characterIds.length ? { characterIds } : {}),
      createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0 });
  }
  return { version: 1, packs };
}

// ── Pure changes: each takes the document and returns the next one. ──

const mapPack = (document: StickerDocument, packId: string, change: (pack: StickerPack) => StickerPack): StickerDocument =>
  ({ ...document, packs: document.packs.map((pack) => pack.id === packId ? change(pack) : pack) });

export function createPack(document: StickerDocument, name: string, note = "", id = newId("pack"), now = Date.now()): StickerDocument {
  const clean = text(name, PACK_NAME_MAX);
  if (!clean) throw new Error("给图集起个名字。");
  if (document.packs.length >= MAX_PACKS) throw new Error(`最多 ${MAX_PACKS} 个图集。`);
  const cleanNote = Array.from(note.trim()).slice(0, PACK_NOTE_MAX).join("");
  return { ...document, packs: [...document.packs, { id, name: clean, ...(cleanNote ? { note: cleanNote } : {}), stickers: [], createdAt: now }] };
}
export const deletePack = (document: StickerDocument, packId: string): StickerDocument =>
  ({ ...document, packs: document.packs.filter((pack) => pack.id !== packId) });

export function updatePackInfo(document: StickerDocument, packId: string, info: { name?: string; note?: string }): StickerDocument {
  return mapPack(document, packId, (pack) => {
    const name = info.name === undefined ? pack.name : text(info.name, PACK_NAME_MAX);
    if (!name) throw new Error("图集名不能为空。");
    const note = info.note === undefined ? pack.note ?? "" : Array.from(info.note.trim()).slice(0, PACK_NOTE_MAX).join("");
    const next: StickerPack = { ...pack, name };
    delete next.note;
    return note ? { ...next, note } : next;
  });
}

/** Adds rows to a pack; a link already in the pack is skipped. Returns the document and how many were added. */
export function addStickers(document: StickerDocument, packId: string, rows: readonly StickerRow[], makeId = () => newId("stk")): { document: StickerDocument; added: number; full: boolean } {
  let added = 0, full = false;
  const next = mapPack(document, packId, (pack) => {
    const urls = new Set(pack.stickers.map((sticker) => sticker.url)), stickers = [...pack.stickers];
    for (const row of rows) {
      const name = text(row.name, STICKER_NAME_MAX), url = normalizeStickerUrl(row.url);
      if (!name || !url || urls.has(url)) continue;
      if (stickers.length >= MAX_STICKERS_PER_PACK) { full = true; break; }
      urls.add(url); stickers.push({ id: makeId(), name, url }); added++;
    }
    return { ...pack, stickers };
  });
  return { document: next, added, full };
}
export function renameSticker(document: StickerDocument, packId: string, stickerId: string, name: string): StickerDocument {
  const clean = text(name, STICKER_NAME_MAX);
  if (!clean) throw new Error("表情名不能为空。");
  return mapPack(document, packId, (pack) => ({ ...pack, stickers: pack.stickers.map((item) => item.id === stickerId ? { ...item, name: clean } : item) }));
}
export const removeSticker = (document: StickerDocument, packId: string, stickerId: string): StickerDocument =>
  mapPack(document, packId, (pack) => ({ ...pack, stickers: pack.stickers.filter((item) => item.id !== stickerId) }));

/** Binds or unbinds one Character; a pack may be bound to any number of Characters. */
export function setPackCharacter(document: StickerDocument, packId: string, characterId: string, bound: boolean): StickerDocument {
  return mapPack(document, packId, (pack) => {
    const ids = new Set(pack.characterIds ?? []);
    if (bound) ids.add(characterId); else ids.delete(characterId);
    const next: StickerPack = { ...pack };
    delete next.characterIds;
    return ids.size ? { ...next, characterIds: [...ids] } : next;
  });
}
/** Removes a deleted Character from every pack. */
export function unbindCharacter(document: StickerDocument, characterId: string): StickerDocument {
  return document.packs.some((pack) => pack.characterIds?.includes(characterId))
    ? { ...document, packs: document.packs.map((pack) => {
      if (!pack.characterIds?.includes(characterId)) return pack;
      const { characterIds, ...rest } = pack;
      const left = characterIds.filter((id) => id !== characterId);
      return left.length ? { ...rest, characterIds: left } : rest;
    }) } : document;
}

export const packsForCharacter = (document: StickerDocument, characterId: string) =>
  document.packs.filter((pack) => pack.characterIds?.includes(characterId) && pack.stickers.length);

export const toMessageSticker = (pack: Pick<StickerPack, "id" | "name">, sticker: Sticker): MessageSticker =>
  ({ packId: pack.id, packName: pack.name, stickerId: sticker.id, name: sticker.name, url: sticker.url });

// ── What a Character is offered, and how its choice is checked. ──

/** A short code for this reply only (S01, S02 …), so same-named stickers in different packs stay distinct. */
export type StickerChoice = { code: string; packId: string; stickerId: string; label: string };
export const STICKER_MENU_LIMIT = 100;

export function stickerMenu(document: StickerDocument, characterId: string, limit = STICKER_MENU_LIMIT): StickerChoice[] {
  const choices: StickerChoice[] = [];
  for (const pack of packsForCharacter(document, characterId))
    for (const sticker of pack.stickers) {
      if (choices.length >= limit) return choices;
      choices.push({ code: `S${String(choices.length + 1).padStart(2, "0")}`, packId: pack.id, stickerId: sticker.id,
        label: stickerLabel({ packName: pack.name, name: sticker.name }) });
    }
  return choices;
}

/** The model's code → the sticker, checked against what is stored now. Unknown, unbound or removed → null. */
export function resolveStickerChoice(document: StickerDocument, characterId: string, choices: readonly StickerChoice[], code: unknown): MessageSticker | null {
  if (typeof code !== "string") return null;
  const choice = choices.find((item) => item.code === code.trim().toUpperCase());
  if (!choice) return null;
  const pack = packsForCharacter(document, characterId).find((item) => item.id === choice.packId);
  const sticker = pack?.stickers.find((item) => item.id === choice.stickerId);
  return pack && sticker ? toMessageSticker(pack, sticker) : null;
}

/**
 * Tolerance for a Character that writes a code on a line of its own instead of in the action line: the last line that is
 * exactly one of the codes offered this turn is taken as the choice and removed from the text. Anything else stays as written.
 */
export function takeBareStickerCode(text: string, choices: readonly StickerChoice[]): { text: string; code: string } | null {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const code = lines[index].trim();
    if (!choices.some((choice) => choice.code === code)) continue;
    lines.splice(index, 1);
    return { text: lines.join("\n").trim(), code };
  }
  return null;
}

// ── Storage: one document, written whole, coordinated like Presence and Contacts. ──

const WRITE_ATTEMPTS = 3;
export function createStickerStorage(getStorage: () => StringStorage,
  getLocks: () => Pick<LockManager, "request"> | undefined = () => globalThis.navigator?.locks,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate) {
  let queue: Promise<unknown> = Promise.resolve();
  const parse = (raw: string | null): StickerDocument => {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (isRecord(value) && typeof value.version === "number" && value.version > 1)
      throw new Error("表情包数据来自更新版本的 VEIL，未做任何修改。");
    return normalizeStickerDocument(value);
  };
  const load = async () => parse(getStorage().getItem(STICKER_STORAGE_KEY));
  const commit = (change: (current: StickerDocument) => StickerDocument): StickerDocument => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const before = getStorage().getItem(STICKER_STORAGE_KEY), current = parse(before);
      const next = normalizeStickerDocument(change(current)), serialized = JSON.stringify(next);
      if (getStorage().getItem(STICKER_STORAGE_KEY) !== before) continue;
      if (serialized === before || (before === null && !next.packs.length)) return next;
      getStorage().setItem(STICKER_STORAGE_KEY, serialized);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(STICKER_CHANGE_EVENT));
      return next;
    }
    throw new Error("表情包在另一个标签页被修改，未保存，请重试。");
  };
  const transact = (change: (current: StickerDocument) => StickerDocument) => runPersistenceWrite(writeGate, async () => {
    const run = async () => {
      const locks = getLocks();
      return locks ? await locks.request(STICKER_STORAGE_KEY, { mode: "exclusive" }, async () => commit(change)) : commit(change);
    };
    const operation = queue.then(run, run);
    queue = operation.then(() => {}, () => {});
    return operation;
  });
  return { load, transact };
}
export type StickerStorage = ReturnType<typeof createStickerStorage>;
export const browserStickerStorage = createStickerStorage(() => window.localStorage);
