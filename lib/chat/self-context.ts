import type { Character, Presence } from "../foundation-types";
import type { Contact } from "../contact-storage";
import { normalizeContactRemark } from "../contact-storage";
import { effectivePresence } from "../presence/compute";
import { presenceLabel } from "../presence/view";
import type { PresenceRecord } from "../presence/storage";
import type { UserReactionNote } from "./reactions";
import type { StickerChoice } from "./sticker-storage";
import { ACTION_TAG, actionAllowance, noteCooldownRemaining, type ActionAllowance } from "../presence/actions";

/** What the Character knows about itself for one reply: read once per request, never stored or sent as history. */
export type SelfState = {
  /** The name the user saved for this Character (Contact.remark). */
  remark: string | null;
  /** The remark change the Character has not yet had a reply to; null once it has replied since. */
  remarkChange: { from: string | null; to: string | null } | null;
  /** Null when the Character has no routine and no active situation, so there is nothing real to say. */
  status: Presence | null;
  situation: string | null;
  signature: string | null;
  /** What the Character itself calls the user (its own note on them); null when none. */
  userNote: string | null;
  /** What the Character may change in this reply (its own cooldowns applied); null when it may change nothing (Continue). */
  canChange: ActionAllowance | null;
  noteCooldownMinutes?: number;
  /** The Character may react to the user's message this reply answers. */
  canReact?: true;
  /** The Character may recall its previous completed message on a normal reply, never on Continue. */
  canRecall?: true;
  canTransfer?: true;
  canGift?: true;
  /** The user's reactions on the Character's latest messages. */
  userReactions?: UserReactionNote[];
  /** The stickers this Character may send in this reply (its bound packs), each with a code valid for this reply only. */
  stickers?: StickerChoice[];
};
export type ReactionState = { canReact: boolean; notes: UserReactionNote[] };

/**
 * `lastReplyAt` is when the Character's latest completed reply began (null when it has none). A remark change is
 * news only until the Character replies after it; `announceChange` is false for Continue, which only extends a reply.
 */
export function selfState(character: Pick<Character, "characterId" | "timezone" | "statusMessage">,
  contact: Pick<Contact, "remark" | "lastRemarkChange"> | undefined, record: PresenceRecord | undefined, now: number,
  lastReplyAt: number | null = null, announceChange = true, allowActions = true, reactions?: ReactionState): SelfState {
  const effective = effectivePresence({ characterId: character.characterId, timezone: character.timezone,
    routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] }, now);
  const known = effective.source === "situation" || !!record?.routine;
  const change = contact?.lastRemarkChange;
  const remarkChange = announceChange && change && (lastReplyAt === null || change.createdAt > lastReplyAt)
    ? { from: change.fromRemark, to: change.toRemark } : null;
  const noteCooldownMinutes = allowActions ? Math.ceil(noteCooldownRemaining(record, now) / 60_000) : 0;
  return { remark: normalizeContactRemark(contact?.remark), remarkChange, status: known ? effective.status : null,
    situation: effective.situation?.reason ?? null, signature: character.statusMessage?.trim() || null,
    userNote: record?.userNote?.text || null, canChange: allowActions ? actionAllowance(record, now) : null,
    ...(noteCooldownMinutes > 0 ? { noteCooldownMinutes } : {}),
    ...(allowActions && reactions?.canReact ? { canReact: true as const } : {}),
    ...(allowActions ? { canRecall: true as const } : {}),
    ...(allowActions ? { canTransfer: true as const } : {}),
    ...(allowActions ? { canGift: true as const } : {}),
    ...(reactions?.notes.length ? { userReactions: reactions.notes } : {}) };
}

const quoted = (value: string) => JSON.stringify(value);
function remarkLines(state: SelfState): string[] {
  const change = state.remarkChange;
  if (change) {
    const sentence = change.to === null ? `The user just removed the remark they had for you${change.from ? ` (it was ${quoted(change.from)})` : ""}.`
      : change.from === null ? `The user just gave you a remark: ${quoted(change.to)}.`
        : `The user just changed the remark they use for you, from ${quoted(change.from)} to ${quoted(change.to)}.`;
    return [sentence, "You may react to it, tease about it, or say nothing at all; do not bring it up unless it fits."];
  }
  return state.remark ? [`Background, needs no response: the remark the user has saved for you is ${quoted(state.remark)}. Mention it only when it fits naturally.`] : [];
}

function actionLines(allow: ActionAllowance | null, canReact = false, stickers: readonly StickerChoice[] = [], canRecall = false, canTransfer = false, canGift = false): string[] {
  const own = !!allow && (allow.situation || allow.signature || allow.note);
  if (!own && !canReact && !stickers.length && !canRecall && !canTransfer && !canGift) return [];
  const fields = [
    allow?.signature ? `"signature": your new signature text ("" clears it)` : null,
    allow?.note ? `"userNote": what you now call the user, a short nickname or note ("" clears it)` : null,
    allow?.situation ? `"situation": {"status": "online"|"away"|"busy"|"dnd"|"offline", "reason": short text, "startInMinutes": optional, "durationMinutes": optional}, "endSituation": "current"|"all", "cancelUpcoming": true` : null,
    canReact ? `"reactToUser": one emoji, a reaction to the user's message you are replying to` : null,
    stickers.length ? `"sticker": exactly one code from your sticker list below` : null,
    canRecall ? `"recallPrevious": true to withdraw your immediately previous message if you need to correct something` : null,
    canTransfer ? `"transfer": {"recipient":"user","amount":number,"note":string} to send a VEIL virtual transfer; "transferAction":{"messageId":string,"action":"receive"|"decline"|"return"} to process a transfer addressed to you` : null,
    canGift ? `"gift":{"icon":string,"content":string} to send a VEIL virtual gift card; "giftAction":{"messageId":string,"action":"accept"|"decline"} to process a gift addressed to you` : null,
  ].filter((field): field is string => field !== null);
  const names = [allow?.signature ? "signature" : null, allow?.note ? "note on the user" : null, allow?.situation ? "situation" : null].filter(Boolean);
  return [
    ...(own ? ["You may change your own " + names.join(", ").replace(/, ([^,]*)$/, " and $1") +
      " when this conversation really gives you a reason; most replies need no change and you never have to explain one.",
    "Only for something happening now or about to happen, never for something you merely recall or tell about."] : []),
    ...(canReact ? ["You may also react to the user's message with one emoji, the way a person reacts to a message, only when it truly moves you; most replies need no reaction."] : []),
    ...(canRecall ? ["You may withdraw your immediately previous completed message only when you have a clear reason; the old message will be replaced by a recalled notice."] : []),
    ...(canTransfer ? ["VEIL transfers are virtual chat gestures with no real money or payment. You may send one when it fits. For a transfer addressed to you, wait, talk first, or decide later; use its exact message ID from the conversation to receive or decline a pending transfer, or return one already received. Never claim a real payment occurred."] : []),
    ...(canGift ? ["You may send a VEIL virtual gift card with an icon and your own short description when it fits the conversation. Its custom text is the gesture's description, even when it mentions money. Gifts never move real money, bank balances, purchases, property, deliveries or inventory. You can joke and respond in character without asking the user to explain that the feature is virtual. For a gift addressed to you, you may talk first or decide later, then accept or decline using the exact gift message ID. Execute acceptance or refusal with giftAction, never by narrating clicks or actions in plain text."] : []),
    ...(stickers.length ? ["You may send one of your own stickers, the way a person sends a sticker in a chat: after your text, or instead of text (then write no text before the line). Only when it truly fits the moment; most replies need no sticker. Each entry is pack name｜sticker name, so you know whose picture it is. Use only these codes, never invent one:",
      ...stickers.map((choice) => `${choice.code} = ${choice.label}`)] : []),
    `To change, end the reply with one line <${ACTION_TAG}>{JSON}</${ACTION_TAG}> using only these optional fields: ${fields.join("; ")}. VEIL removes this line before anyone sees the reply; never mention it.`];
}

/** The runtime-fact message for the reply prompt, or null when there is nothing to tell the Character. */
export function selfStateContent(state: SelfState | undefined): string | null {
  if (!state) return null;
  const lines = [
    state.status ? `Your current status: ${presenceLabel(state.status)}${state.situation ? ` (${state.situation})` : ""}.` : null,
    state.signature ? `Your signature: ${quoted(state.signature)}.` : null,
    state.userNote ? `Your own note on the user, what you call them: ${quoted(state.userNote)}. Use it only when it fits naturally.` : null,
    state.noteCooldownMinutes ? `你已经使用过本次修改备注的机会，请在 ${state.noteCooldownMinutes % 60 === 0 ? `${state.noteCooldownMinutes / 60} 小时` : `${state.noteCooldownMinutes} 分钟`}后再试。` : null,
    ...remarkLines(state),
    ...(state.userReactions ?? []).map((note) => `Background, needs no response: the user reacted ${note.emoji} to your message ${quoted(note.preview)}.`),
    ...actionLines(state.canChange, !!state.canReact, state.stickers, !!state.canRecall, !!state.canTransfer, !!state.canGift),
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return ["Your own state (VEIL runtime facts, not message content):", ...lines,
    "A requested reply does not change your status or situation; stay consistent with them.",
    "Do not reproduce these lines in your reply."].join("\n");
}
