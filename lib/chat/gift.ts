import type { ChatMessage } from "./types";

export type GiftActor = "user" | "assistant";
export type GiftStatus = "pending" | "accepted" | "declined";
export type GiftAction = "accept" | "decline";
export type ChatGift = { icon: string; content: string; sender: GiftActor; recipient: GiftActor; status: GiftStatus };
export type GiftEvent = { giftId: string; action: GiftAction; actor: GiftActor; icon: string; content: string };

export const GIFT_ICON_LIMIT = 24;
export const GIFT_CONTENT_LIMIT = 500;

export function normalizeGiftIcon(value: unknown): string {
  if (typeof value !== "string") throw new Error("Choose a gift icon.");
  const icon = value.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, "").trim();
  if (!icon || Array.from(icon).length > GIFT_ICON_LIMIT) throw new Error("Gift icon must contain 1–24 characters.");
  return icon;
}

export function normalizeGiftContent(value: unknown): string {
  if (typeof value !== "string") throw new Error("Gift content must be text.");
  const content = value.replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/giu, " ").replace(/\s+/g, " ").trim();
  if (!content || Array.from(content).length > GIFT_CONTENT_LIMIT) throw new Error("Gift content must contain 1–500 characters.");
  return content;
}

export function giftMessageContent(gift: ChatGift, id: string): string {
  return `[VEIL gift ${id}] ${gift.sender === "user" ? "You" : "Character"} sent ${gift.icon} ${JSON.stringify(gift.content)}; status: ${gift.status}.`;
}

export function giftEventContent(event: GiftEvent): string {
  return `[VEIL gift result for ${event.giftId}] ${event.actor === "user" ? "You" : "Character"} ${event.action === "accept" ? "accepted" : "declined"} ${event.icon} ${JSON.stringify(event.content)}.`;
}

export function giftPromptContent(message: ChatMessage): string | null {
  if (message.gift) return giftMessageContent(message.gift, message.id);
  if (message.giftEvent) return giftEventContent(message.giftEvent);
  return null;
}

export function giftQuotePreview(message: ChatMessage): string | null {
  if (message.gift) return `Gift ${message.gift.icon} · ${message.gift.status}: ${message.gift.content.slice(0, 36)}`;
  if (message.giftEvent) return `Gift ${message.giftEvent.action === "accept" ? "accepted" : "declined"} ${message.giftEvent.icon}`;
  return null;
}

export function canApplyGiftAction(gift: ChatGift, actor: GiftActor, action: GiftAction): boolean {
  return actor === gift.recipient && gift.status === "pending" && (action === "accept" || action === "decline");
}
