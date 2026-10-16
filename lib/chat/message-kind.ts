import type { ChatMessage } from "./types";
import { attachmentPreview } from "./attachment";
import { stickerPreview } from "./sticker-message";

/**
 * What a message is made of, asked in one place. A special message carries its own optional field on `ChatMessage`
 * (sticker, attachment, transfer, gift and their events) and keeps its model-facing text in `content`; everything
 * that must treat those differently from plain text asks here instead of repeating the field list.
 */
type Shape = Pick<ChatMessage, "sticker" | "attachment" | "transfer" | "transferEvent" | "gift" | "giftEvent">;

/** A Transfer or Gift card or the event recording what was done to one. */
export const isCardMessage = (message: Pick<ChatMessage, "transfer" | "transferEvent" | "gift" | "giftEvent">) =>
  !!(message.transfer || message.transferEvent || message.gift || message.giftEvent);

/** `content` is VEIL's own semantic text, not wording the sender chose: it is never edited, copied or run through user rules. */
export const hasGeneratedContent = (message: Pick<ChatMessage, "sticker" | "attachment">) =>
  !!(message.sticker || message.attachment);

/** The message's body cannot be edited: a card, a sticker or a media message. */
export const isFixedMessage = (message: Shape) => isCardMessage(message) || hasGeneratedContent(message);

/** The one-line stand-in for a sticker or media message, or null for any other message. */
export function mediaPreview(message: Pick<ChatMessage, "sticker" | "attachment">): string | null {
  if (message.sticker) return stickerPreview(message.sticker);
  if (message.attachment) return attachmentPreview(message.attachment);
  return null;
}

/** The text a Chats-list row shows for this message: its media stand-in, else the start of its text. */
export const listPreview = (message: Pick<ChatMessage, "sticker" | "attachment" | "content">, length = 120) =>
  mediaPreview(message) ?? message.content.slice(0, length);
