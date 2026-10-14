import type { ChatMessage } from "./types";

export type ReactionSide = "user" | "character";
export type MessageReactions = Partial<Record<ReactionSide, string>>;

/** The row shown first in the reaction bar; the rest come from the full picker. */
export const QUICK_REACTIONS = ["❤️", "👍", "👎", "😂", "‼️", "❓"] as const;

const REACTION_PATTERN = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One emoji (a single grapheme) and nothing else; this is also what a backup must contain. */
export function isReactionEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 32) return false;
  const parts = [...segmenter.segment(value)];
  return parts.length === 1 && REACTION_PATTERN.test(value);
}

export function isMessageReactions(value: unknown): value is MessageReactions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([side, emoji]) =>
    (side === "user" || side === "character") && isReactionEmoji(emoji));
}

/** The reactions with one side changed; null once nothing is left, so the field can be removed. */
export function withReaction(current: MessageReactions | undefined, side: ReactionSide, emoji: string | null): MessageReactions | null {
  const next: MessageReactions = { ...current };
  if (emoji === null) delete next[side]; else next[side] = emoji;
  return Object.keys(next).length ? next : null;
}

export function canReactTo(message: Pick<ChatMessage, "role" | "status">) {
  return message.role !== "system" && (message.status === "sent" || message.status === "complete");
}

export function reactionBadges(message: Pick<ChatMessage, "reactions">): string[] {
  const { user, character } = message.reactions ?? {};
  return [character, user].filter((emoji): emoji is string => !!emoji);
}
