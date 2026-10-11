import type { Character, Presence } from "../foundation-types";
import type { Contact } from "../contact-storage";
import { normalizeContactRemark } from "../contact-storage";
import { effectivePresence } from "../presence/compute";
import { presenceLabel } from "../presence/view";
import type { PresenceRecord } from "../presence/storage";
import { ACTION_TAG, actionAllowance, type ActionAllowance } from "../presence/actions";

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
};

/**
 * `lastReplyAt` is when the Character's latest completed reply began (null when it has none). A remark change is
 * news only until the Character replies after it; `announceChange` is false for Continue, which only extends a reply.
 */
export function selfState(character: Pick<Character, "characterId" | "timezone" | "statusMessage">,
  contact: Pick<Contact, "remark" | "lastRemarkChange"> | undefined, record: PresenceRecord | undefined, now: number,
  lastReplyAt: number | null = null, announceChange = true, allowActions = true): SelfState {
  const effective = effectivePresence({ characterId: character.characterId, timezone: character.timezone,
    routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] }, now);
  const known = effective.source === "situation" || !!record?.routine;
  const change = contact?.lastRemarkChange;
  const remarkChange = announceChange && change && (lastReplyAt === null || change.createdAt > lastReplyAt)
    ? { from: change.fromRemark, to: change.toRemark } : null;
  return { remark: normalizeContactRemark(contact?.remark), remarkChange, status: known ? effective.status : null,
    situation: effective.situation?.reason ?? null, signature: character.statusMessage?.trim() || null,
    userNote: record?.userNote?.text || null, canChange: allowActions ? actionAllowance(record, now) : null };
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

function actionLines(allow: ActionAllowance | null): string[] {
  if (!allow || (!allow.situation && !allow.signature && !allow.note)) return [];
  const fields = [
    allow.signature ? `"signature": your new signature text ("" clears it)` : null,
    allow.note ? `"userNote": what you now call the user, a short nickname or note ("" clears it)` : null,
    allow.situation ? `"situation": {"status": "online"|"away"|"busy"|"dnd"|"offline", "reason": short text, "startInMinutes": optional, "durationMinutes": optional}, "endSituation": "current"|"all", "cancelUpcoming": true` : null,
  ].filter((field): field is string => field !== null);
  const names = [allow.signature ? "signature" : null, allow.note ? "note on the user" : null, allow.situation ? "situation" : null].filter(Boolean);
  return ["You may change your own " + names.join(", ").replace(/, ([^,]*)$/, " and $1") +
    " when this conversation really gives you a reason; most replies need no change and you never have to explain one.",
  "Only for something happening now or about to happen, never for something you merely recall or tell about.",
  `To change, end the reply with one line <${ACTION_TAG}>{JSON}</${ACTION_TAG}> using only these optional fields: ${fields.join("; ")}. VEIL removes this line before anyone sees the reply; never mention it.`];
}

/** The runtime-fact message for the reply prompt, or null when there is nothing to tell the Character. */
export function selfStateContent(state: SelfState | undefined): string | null {
  if (!state) return null;
  const lines = [
    state.status ? `Your current status: ${presenceLabel(state.status)}${state.situation ? ` (${state.situation})` : ""}.` : null,
    state.signature ? `Your signature: ${quoted(state.signature)}.` : null,
    state.userNote ? `Your own note on the user, what you call them: ${quoted(state.userNote)}. Use it only when it fits naturally.` : null,
    ...remarkLines(state),
    ...actionLines(state.canChange),
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return ["Your own state (VEIL runtime facts, not message content):", ...lines,
    "A requested reply does not change your status or situation; stay consistent with them.",
    "Do not reproduce these lines in your reply."].join("\n");
}
