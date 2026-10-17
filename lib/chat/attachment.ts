/**
 * The media a message carries. The bytes live in the chat `assets` store under `assetId`; the message holds only
 * this reference and what is needed to lay the bubble out before the bytes load. One message owns at most one
 * attachment and one attachment belongs to exactly one message, so deleting the message deletes its asset.
 * The asset row itself is unchanged (`{ id, blob, createdAt }`); its MIME type is `blob.type`.
 */
export type ImageAttachment = {
  kind: "image";
  assetId: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
};
/** A voice message the user recorded: `durationMs` is measured from the recording, and the message's `content` is its transcript. */
export type AudioAttachment = {
  kind: "audio";
  assetId: string;
  mime: string;
  durationMs: number;
  bytes: number;
};
export type MessageAttachment = ImageAttachment | AudioAttachment;

/** Raster formats only: no SVG, so a stored image can never carry script. */
export const ATTACHMENT_IMAGE_MIMES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_ATTACHMENT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_IMAGE_EDGE = 16_384;
/** What MediaRecorder produces: webm/ogg on most browsers, mp4 on Safari. The codec parameter is dropped. */
export const ATTACHMENT_AUDIO_MIMES: readonly string[] = ["audio/webm", "audio/mp4", "audio/ogg"];
export const MAX_ATTACHMENT_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_RECORDING_MS = 120_000;

const ASSET_ID = /^[A-Za-z0-9-]{1,100}$/;
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

/** Exactly the fields of its kind with valid values. This is also what a backup must contain. */
export function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  if (typeof attachment.assetId !== "string" || !ASSET_ID.test(attachment.assetId)
    || typeof attachment.mime !== "string" || !isPositiveInteger(attachment.bytes)) return false;
  if (attachment.kind === "audio") return Object.keys(attachment).length === 5
    && ATTACHMENT_AUDIO_MIMES.includes(attachment.mime) && attachment.bytes <= MAX_ATTACHMENT_AUDIO_BYTES
    && isPositiveInteger(attachment.durationMs) && attachment.durationMs <= MAX_VOICE_RECORDING_MS;
  return Object.keys(attachment).length === 6 && attachment.kind === "image"
    && ATTACHMENT_IMAGE_MIMES.includes(attachment.mime)
    && isPositiveInteger(attachment.width) && attachment.width <= MAX_ATTACHMENT_IMAGE_EDGE
    && isPositiveInteger(attachment.height) && attachment.height <= MAX_ATTACHMENT_IMAGE_EDGE
    && attachment.bytes <= MAX_ATTACHMENT_IMAGE_BYTES;
}

const CONTENT: Record<"image", Record<"user" | "assistant", string>> = {
  image: { user: "[用户发送了一张图片]", assistant: "[你发送了一张图片]" },
};
const PREVIEW: Record<MessageAttachment["kind"], string> = { image: "[图片]", audio: "[语音]" };

/**
 * The text stored as the message's `content`: it feeds search, summaries, Memory and the prompt, and is never shown
 * as bubble text. No image data and no link.
 */
export const attachmentContent = (sender: "user" | "assistant", attachment: { kind: "image" }) =>
  CONTENT[attachment.kind][sender];

/** Short preview for the Chats list and for quotes. */
export const attachmentPreview = (attachment: Pick<MessageAttachment, "kind">) => PREVIEW[attachment.kind];
