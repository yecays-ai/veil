import type { Character, Presence } from "../foundation-types";
import type { Contact } from "../contact-storage";
import { normalizeContactRemark } from "../contact-storage";
import { effectivePresence } from "../presence/compute";
import { presenceLabel } from "../presence/view";
import type { PresenceRecord } from "../presence/storage";

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
};

/**
 * `lastReplyAt` is when the Character's latest completed reply began (null when it has none). A remark change is
 * news only until the Character replies after it; `announceChange` is false for Continue, which only extends a reply.
 */
export function selfState(character: Pick<Character, "characterId" | "timezone" | "statusMessage">,
  contact: Pick<Contact, "remark" | "lastRemarkChange"> | undefined, record: PresenceRecord | undefined, now: number,
  lastReplyAt: number | null = null, announceChange = true): SelfState {
  const effective = effectivePresence({ characterId: character.characterId, timezone: character.timezone,
    routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] }, now);
  const known = effective.source === "situation" || !!record?.routine;
  const change = contact?.lastRemarkChange;
  const remarkChange = announceChange && change && (lastReplyAt === null || change.createdAt > lastReplyAt)
    ? { from: change.fromRemark, to: change.toRemark } : null;
  return { remark: normalizeContactRemark(contact?.remark), remarkChange, status: known ? effective.status : null,
    situation: effective.situation?.reason ?? null, signature: character.statusMessage?.trim() || null };
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

/** The runtime-fact message for the reply prompt, or null when there is nothing to tell the Character. */
export function selfStateContent(state: SelfState | undefined): string | null {
  if (!state) return null;
  const lines = [
    state.status ? `Your current status: ${presenceLabel(state.status)}${state.situation ? ` (${state.situation})` : ""}.` : null,
    state.signature ? `Your signature: ${quoted(state.signature)}.` : null,
    ...remarkLines(state),
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return ["Your own state (VEIL runtime facts, not message content):", ...lines,
    "A requested reply does not change your status or situation; stay consistent with them.",
    "Do not reproduce these lines in your reply."].join("\n");
}
