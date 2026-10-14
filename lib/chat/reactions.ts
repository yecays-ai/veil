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

export function canReactTo(message: Pick<ChatMessage, "role" | "status" | "recalled">) {
  return !message.recalled && message.role !== "system" && (message.status === "sent" || message.status === "complete");
}

export function reactionBadges(message: Pick<ChatMessage, "reactions">): string[] {
  const { user, character } = message.reactions ?? {};
  return [character, user].filter((emoji): emoji is string => !!emoji);
}

/** The user message a reply answers: the latest one before the reply's own place in the conversation. */
export function reactionTarget(messages: readonly ChatMessage[], assistantOrder: number): ChatMessage | null {
  let target: ChatMessage | null = null;
  for (const message of messages)
    if (message.role === "user" && message.order < assistantOrder && canReactTo(message) && (!target || message.order > target.order)) target = message;
  return target;
}

/** A Character does not react to two user messages in a row, so a reaction stays a rare, deliberate thing. */
export function characterMayReact(messages: readonly ChatMessage[], target: Pick<ChatMessage, "id" | "order">): boolean {
  let previous: ChatMessage | null = null;
  for (const message of messages)
    if (message.role === "user" && message.order < target.order && (!previous || message.order > previous.order)) previous = message;
  return !previous?.reactions?.character;
}

export type UserReactionNote = { emoji: string; preview: string };
const NOTE_WINDOW = 8, NOTE_LIMIT = 3, PREVIEW_CHARACTERS = 40;
/** The user's reactions on the Character's latest few messages, newest first; a reaction is never new information for long. */
export function userReactionNotes(messages: readonly ChatMessage[]): UserReactionNote[] {
  const notes: UserReactionNote[] = [];
  for (const message of messages.slice(-NOTE_WINDOW).reverse()) {
    const emoji = message.reactions?.user;
    if (message.role !== "assistant" || !emoji || !message.content.trim()) continue;
    notes.push({ emoji, preview: Array.from(message.content.replace(/\s+/g, " ").trim()).slice(0, PREVIEW_CHARACTERS).join("") });
    if (notes.length === NOTE_LIMIT) break;
  }
  return notes;
}
