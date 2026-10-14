import { normalizeStickerUrl, STICKER_NAME_MAX } from "./sticker-import";

/**
 * The sticker a message carries: stable ids for the pack and the sticker, plus the names and link as they were when
 * it was sent, so the history keeps reading the same after the library is renamed or edited.
 */
export type MessageSticker = { packId: string; packName: string; stickerId: string; name: string; url: string };

const PACK_NAME_MAX = 40;
const ID_MAX = 100;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max;

/** Exactly the five fields, valid text, and an http(s) link. This is also what a backup must contain. */
export function isMessageSticker(value: unknown): value is MessageSticker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sticker = value as Record<string, unknown>;
  return Object.keys(sticker).length === 5 && isText(sticker.packId, ID_MAX) && isText(sticker.stickerId, ID_MAX)
    && isText(sticker.packName, PACK_NAME_MAX * 2) && isText(sticker.name, STICKER_NAME_MAX * 2)
    && typeof sticker.url === "string" && normalizeStickerUrl(sticker.url) === sticker.url;
}

/** What the model and the Character see for a sticker: the pack name keeps same-named stickers apart and says who is pictured. */
export const stickerLabel = (sticker: Pick<MessageSticker, "packName" | "name">) => `${sticker.packName}｜${sticker.name}`;

/**
 * The text stored as the message's `content`: it feeds search, summaries, Memory and the prompt, and is never shown
 * as bubble text. No image data and no link.
 */
export function stickerContent(sender: "user" | "assistant", sticker: Pick<MessageSticker, "packName" | "name">): string {
  return sender === "user" ? `[用户发送了一个表情包：${stickerLabel(sticker)}]` : `[你发送了一个表情包：${stickerLabel(sticker)}]`;
}

/** Short preview for the Chats list and for quotes. */
export const stickerPreview = (sticker: Pick<MessageSticker, "name">) => `[表情包] ${sticker.name}`;
