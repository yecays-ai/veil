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
  /** Set while the message has no transcript yet (its words are being written out, or that failed); `content` is then only a stand-in. */
  untranscribed?: true;
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
  if (attachment.kind === "audio") return Object.keys(attachment).length === (attachment.untranscribed === undefined ? 5 : 6)
    && (attachment.untranscribed === undefined || attachment.untranscribed === true)
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

/** The semantic text of a picture the Character took, with what it asked for so the Character remembers what the picture shows. */
export const generatedImageContent = (prompt: string) => `[你发送了一张照片:${prompt}]`;

/** Short preview for the Chats list and for quotes. */
export const attachmentPreview = (attachment: Pick<MessageAttachment, "kind">) => PREVIEW[attachment.kind];

/** What a voice message from the user holds as `content` until its words are known. */
export const UNTRANSCRIBED_VOICE_CONTENT = "[用户发送了一条语音消息]";

/**
 * How a message reads to the model. A voice message is marked as one, from the user and from the Character alike, so the
 * model knows it was spoken and not typed; the stored `content` (the transcript) is unchanged. A user voice without
 * words yet says so and invents none.
 */
export function modelFacingContent(
  message: { role: string; voice?: true; attachment?: { kind: string; untranscribed?: true } }, text: string,
): string {
  if (message.role === "assistant" && message.voice) return `[你发送了一条语音消息：${text}]`;
  if (message.role !== "user" || message.attachment?.kind !== "audio") return text;
  return message.attachment.untranscribed ? "[用户发送了一条语音消息，其中的话还没有转成文字]" : `[用户发送了一条语音消息：${text}]`;
}

const VOICE_MARKER = /\[你发送了一条语音消息[：:]([^\]]*)\]/g;

/**
 * The marker above is how history shows a spoken message, not something to type. A Character that copies it into its text
 * would show the marker as a bubble; the words inside are taken out so the reply can speak or show them. Several copies are
 * all removed and their words joined.
 */
export function takeVoiceMarker(text: string): { text: string; spoken: string } | null {
  const found = [...text.matchAll(VOICE_MARKER)];
  if (!found.length) return null;
  return { text: text.replace(VOICE_MARKER, "").trim(), spoken: found.map((match) => match[1].trim()).filter(Boolean).join(" ") };
}

/** A complete marker shown as its words alone, for a draft that is still streaming and may be stopped or fail before the reply is finished. */
export const unwrapVoiceMarkers = (text: string) => text.replace(VOICE_MARKER, (_marker, words: string) => words.trim());
