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
  /** Null when the Character has no routine and no active situation, so there is nothing real to say. */
  status: Presence | null;
  situation: string | null;
  signature: string | null;
};

export function selfState(character: Pick<Character, "characterId" | "timezone" | "statusMessage">,
  contact: Pick<Contact, "remark"> | undefined, record: PresenceRecord | undefined, now: number): SelfState {
  const effective = effectivePresence({ characterId: character.characterId, timezone: character.timezone,
    routine: record?.routine?.routine ?? null, situations: record?.situations ?? [] }, now);
  const known = effective.source === "situation" || !!record?.routine;
  return { remark: normalizeContactRemark(contact?.remark), status: known ? effective.status : null,
    situation: effective.situation?.reason ?? null, signature: character.statusMessage?.trim() || null };
}

/** The runtime-fact message for the reply prompt, or null when there is nothing to tell the Character. */
export function selfStateContent(state: SelfState | undefined): string | null {
  if (!state) return null;
  const lines = [
    state.status ? `Your current status: ${presenceLabel(state.status)}${state.situation ? ` (${state.situation})` : ""}.` : null,
    state.signature ? `Your signature: ${JSON.stringify(state.signature)}.` : null,
    state.remark ? `The user saved the remark ${JSON.stringify(state.remark)} for you.` : null,
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return ["Your own state (VEIL runtime facts, not message content):", ...lines,
    "A requested reply does not change your status or situation; stay consistent with them.",
    "Do not reproduce these lines in your reply."].join("\n");
}
