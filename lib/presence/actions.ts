import { PRESENCE_VALUES, type Character, type FoundationDocument } from "../foundation-types";
import { normalizeSituation } from "./compute";
import { isReactionEmoji } from "../chat/reactions";
import { normalizeTransferAmount, normalizeTransferNote, type TransferAction } from "../chat/transfer";
import { normalizeGiftContent, normalizeGiftIcon, type GiftAction } from "../chat/gift";
import {
  addSituation, cancelUpcoming, endSituation, markSignatureChange, markSituationChange, presenceRecord, setUserNote,
  type PresenceDocument, type PresenceRecord,
} from "./storage";

/** What a Character may change about itself in a reply. Parsed from one trailing tag, never shown to the user. */
export type CharacterActions = {
  signature?: string | null;
  /** What the Character calls the user; "" clears it. */
  userNote?: string | null;
  situation?: { status: string; reason?: string; startInMinutes?: number; durationMinutes?: number };
  endSituation?: "current" | "all";
  cancelUpcoming?: true;
  /** One emoji reacting to the user's message this reply answers. Applied by the chat, not by Presence. */
  reactToUser?: string;
  /** One of this reply's sticker codes (S01 …), sent as the Character's own last bubble. Checked and applied by the chat. */
  sticker?: string;
  /** Withdraw your immediately previous completed message after this reply is committed. */
  recallPrevious?: true;
  transfer?: { amount: number; note: string };
  transferAction?: { messageId: string; action: TransferAction };
  gift?: { icon: string; content: string };
  giftAction?: { messageId: string; action: GiftAction };
};
export const ACTION_TAG = "veil-action";
const OPEN = `<${ACTION_TAG}>`, CLOSE = `</${ACTION_TAG}>`;
// Provisional, like the other Presence constants: long enough that the Character does not flap, short enough
// that a real event can still change things the same evening.
export const SITUATION_COOLDOWN_MS = 30 * 60_000;
export const SIGNATURE_COOLDOWN_MS = 12 * 60 * 60_000;
export const NOTE_COOLDOWN_MS = 12 * 60 * 60_000;
const SIGNATURE_MAX = 200;
const NOTE_MAX = 100;
const MAX_START_IN_MS = 7 * 24 * 60 * 60_000;
export const CHARACTER_SOURCE_PREFIX = "character:";

/** The reply as the user should see it (every action tag, finished or still streaming, removed) and the actions it carried. */
export function splitActions(raw: string): { text: string; actions: CharacterActions | null } {
  let text = "", actions: CharacterActions | null = null, rest = raw;
  for (;;) {
    const start = rest.indexOf(OPEN);
    if (start < 0) break;
    text += rest.slice(0, start);
    const end = rest.indexOf(CLOSE, start);
    if (end < 0) { rest = ""; break; } // Unfinished tag: cut it, so a half-written action is never shown.
    const parsed = parseActions(rest.slice(start + OPEN.length, end));
    rest = rest.slice(end + CLOSE.length);
    // Only a tag that ends the reply is an action; one quoted mid-reply is stripped but never applied.
    if (parsed && !rest.trim()) actions = parsed;
  }
  text += rest;
  // A tag that is only starting to stream ("<veil-act") is held back until it is clearly not a tag.
  for (let length = Math.min(OPEN.length - 1, text.length); length > 0; length--)
    if (text.endsWith(OPEN.slice(0, length))) { text = text.slice(0, -length); break; }
  return { text: actions || text !== raw ? text.trimEnd() : text, actions };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Control, zero-width and bidi characters out, whitespace collapsed, at most 200 characters. */
const cleanText = (value: string, max: number): string | null => {
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, max).join("").trim() || null;
};
export const cleanSignature = (value: string) => cleanText(value, SIGNATURE_MAX);
/** Same cleaning as a signature, at most 100 characters (the length of the user's own remark). */
export const cleanUserNote = (value: string) => cleanText(value, NOTE_MAX);

function parseActions(json: string): CharacterActions | null {
  let value: unknown;
  try { value = JSON.parse(json); } catch { return null; }
  if (!isRecord(value)) return null;
  const actions: CharacterActions = {};
  if (typeof value.signature === "string") actions.signature = cleanSignature(value.signature);
  if (typeof value.userNote === "string") actions.userNote = cleanUserNote(value.userNote);
  const situation = value.situation;
  if (isRecord(situation) && typeof situation.status === "string") {
    const minutes = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
    actions.situation = { status: situation.status, ...(typeof situation.reason === "string" ? { reason: situation.reason } : {}),
      ...(minutes(situation.startInMinutes) !== undefined ? { startInMinutes: minutes(situation.startInMinutes) } : {}),
      ...(minutes(situation.durationMinutes) !== undefined ? { durationMinutes: minutes(situation.durationMinutes) } : {}) };
  }
  if (value.endSituation === "current" || value.endSituation === "all") actions.endSituation = value.endSituation;
  if (value.cancelUpcoming === true) actions.cancelUpcoming = true;
  if (isReactionEmoji(value.reactToUser)) actions.reactToUser = value.reactToUser;
  if (typeof value.sticker === "string" && /^S\d{2,3}$/i.test(value.sticker.trim())) actions.sticker = value.sticker.trim().toUpperCase();
  if (value.recallPrevious === true) actions.recallPrevious = true;
  if (isRecord(value.transfer) && value.transfer.recipient === "user" && typeof value.transfer.amount === "number" && Number.isFinite(value.transfer.amount)) {
    try { actions.transfer = { amount: normalizeTransferAmount(value.transfer.amount), note: normalizeTransferNote(typeof value.transfer.note === "string" ? value.transfer.note : "") }; }
    catch { /* Invalid requested transfer is ignored; other reply actions remain usable. */ }
  }
  if (isRecord(value.transferAction) && typeof value.transferAction.messageId === "string" &&
      /^[\w-]{8,80}$/.test(value.transferAction.messageId) && ["receive", "decline", "return"].includes(String(value.transferAction.action)))
    actions.transferAction = { messageId: value.transferAction.messageId, action: value.transferAction.action as TransferAction };
  if (isRecord(value.gift) && typeof value.gift.icon === "string" && typeof value.gift.content === "string") {
    try { actions.gift = { icon: normalizeGiftIcon(value.gift.icon), content: normalizeGiftContent(value.gift.content) }; }
    catch { /* Invalid gift payload is ignored; other reply actions remain usable. */ }
  }
  if (isRecord(value.giftAction) && typeof value.giftAction.messageId === "string" && /^[\w-]{8,80}$/.test(value.giftAction.messageId)
      && (value.giftAction.action === "accept" || value.giftAction.action === "decline"))
    actions.giftAction = { messageId: value.giftAction.messageId, action: value.giftAction.action };
  return Object.keys(actions).length ? actions : null;
}

export type ActionAllowance = { situation: boolean; signature: boolean; note: boolean };
const ownChangeAt = (mark: { changedAt: number; source: string | null } | null | undefined) =>
  mark?.source?.startsWith(CHARACTER_SOURCE_PREFIX) ? mark.changedAt : -Infinity;

/** Uses the same own-change timestamp and clock as the note action's eligibility check. */
export function noteCooldownRemaining(record: PresenceRecord | undefined, now: number): number {
  const elapsed = now - ownChangeAt(record?.userNote);
  return elapsed < NOTE_COOLDOWN_MS ? NOTE_COOLDOWN_MS - elapsed : 0;
}

/** Whether the Character may change each thing now. Only its own earlier changes count (including ending or cancelling a situation). */
export function actionAllowance(record: PresenceRecord | undefined, now: number): ActionAllowance {
  return { situation: !(now - ownChangeAt(record?.situationChange) < SITUATION_COOLDOWN_MS),
    signature: !(now - ownChangeAt(record?.signature) < SIGNATURE_COOLDOWN_MS),
    note: noteCooldownRemaining(record, now) === 0 };
}

/** Applies the situation part to Presence. Never writes the past: a start before `now` is moved to `now`. */
export function applySituationActions(document: PresenceDocument, character: Pick<Character, "characterId">,
  actions: CharacterActions, now: number, source: string): PresenceDocument {
  if (!actionAllowance(presenceRecord(document, character.characterId), now).situation) return document;
  const id = character.characterId, mark = { changedAt: now, source };
  let next = document;
  if (actions.cancelUpcoming) next = cancelUpcoming(next, id, now);
  if (actions.endSituation) next = endSituation(next, id, now, actions.endSituation);
  const draft = actions.situation;
  if (draft && (PRESENCE_VALUES as readonly string[]).includes(draft.status)) {
    const startsAt = now + Math.min(Math.max(0, draft.startInMinutes ?? 0) * 60_000, MAX_START_IN_MS);
    const situation = normalizeSituation({ status: draft.status, reason: draft.reason, startsAt,
      ...(draft.durationMinutes !== undefined && draft.durationMinutes > 0 ? { endsAt: startsAt + draft.durationMinutes * 60_000 } : {}) }, now);
    if (situation) next = addSituation(next, id, situation, mark, now);
  }
  // Only a real change starts the cooldown: ending or cancelling nothing costs nothing.
  return next === document ? document : markSituationChange(next, id, mark);
}

export type ActionDeps = {
  presence: { load(): Promise<PresenceDocument>; transact(change: (document: PresenceDocument) => PresenceDocument): Promise<PresenceDocument> };
  foundation: { transact(update: (document: FoundationDocument) => FoundationDocument): Promise<FoundationDocument> };
  /** Tells the chat the Character changed its note on the user (null = removed); a failure never undoes the change. */
  noteChanged?: (characterId: string, note: string | null, at: number) => Promise<void>;
  recallPreviousMessage?: (replyMessageId: string) => Promise<void>;
  sendTransfer?: (replyMessageId: string, amount: number, note: string) => Promise<void>;
  actOnTransfer?: (characterId: string, messageId: string, action: TransferAction, replyMessageId: string) => Promise<void>;
  sendGift?: (replyMessageId: string, icon: string, content: string) => Promise<void>;
  actOnGift?: (characterId: string, messageId: string, action: GiftAction, replyMessageId: string) => Promise<void>;
};
/** The note is Presence data alone, so check and write happen in one transaction; the chat event follows only a real change. */
async function applyUserNote(deps: ActionDeps, characterId: string, note: string | null, now: number, source: string) {
  const text = note ?? "";
  let changed = false;
  await deps.presence.transact((document) => {
    changed = false; // a retried write recomputes from the newer document
    const current = presenceRecord(document, characterId);
    if (!actionAllowance(current, now).note || (current?.userNote?.text ?? "") === text) return document;
    changed = true;
    return setUserNote(document, characterId, text, { changedAt: now, source });
  });
  if (!changed) return;
  try { await deps.noteChanged?.(characterId, note, now); }
  catch { console.warn("[Presence] the note change was saved but its chat event was not"); }
}
/** Applies a committed reply's actions. Presence and Foundation are separate stores, so the signature goes first (the real data) and its mark second. */
export const characterActionApplier = (deps: ActionDeps) =>
  async (characterId: string, actions: CharacterActions, now: number, messageId: string): Promise<void> => {
    const source = `${CHARACTER_SOURCE_PREFIX}${messageId}`;
    await deps.presence.transact((document) => applySituationActions(document, { characterId }, actions, now, source));
    if (actions.userNote !== undefined) await applyUserNote(deps, characterId, actions.userNote, now, source);
    if (actions.recallPrevious) {
      try { await deps.recallPreviousMessage?.(messageId); }
      catch { console.warn("[Presence] the previous message could not be recalled"); }
    }
    if (actions.transfer) {
      try { await deps.sendTransfer?.(messageId, actions.transfer.amount, actions.transfer.note); }
      catch { console.warn("[Presence] the virtual transfer could not be saved"); }
    }
    if (actions.transferAction) {
      try { await deps.actOnTransfer?.(characterId, actions.transferAction.messageId, actions.transferAction.action, messageId); }
      catch { console.warn("[Presence] the virtual transfer action could not be saved"); }
    }
    if (actions.gift) {
      try { await deps.sendGift?.(messageId, actions.gift.icon, actions.gift.content); }
      catch { console.warn("[Presence] the gift could not be saved"); }
    }
    if (actions.giftAction) {
      try { await deps.actOnGift?.(characterId, actions.giftAction.messageId, actions.giftAction.action, messageId); }
      catch { console.warn("[Presence] the gift action could not be saved"); }
    }
    if (actions.signature === undefined) return;
    const allowed = actionAllowance(presenceRecord(await deps.presence.load(), characterId), now).signature;
    if (!allowed) return;
    let changed = false;
    await deps.foundation.transact((document) => {
      const current = document.characters.find((item) => item.characterId === characterId);
      changed = !!current && (current.statusMessage ?? null) !== (actions.signature ?? null);
      return !current || !changed ? document : { ...document, characters: document.characters.map((item) =>
        item.characterId === characterId ? { ...item, statusMessage: actions.signature ?? null } : item) };
    });
    if (changed) await deps.presence.transact((document) => markSignatureChange(document, characterId, { changedAt: now, source }));
  };
export type ActionApplier = ReturnType<typeof characterActionApplier>;
