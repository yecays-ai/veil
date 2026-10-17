import { ATTACHMENT_IMAGE_MIMES } from "./attachment";

/** What an image sent in a chat is reduced to before it is stored: long edge 2048, about 1 MB. */
export const CHAT_IMAGE_LONG_EDGE = 2048;
export const CHAT_IMAGE_TARGET_BYTES = 1_000_000;
/** A larger source is refused before it is decoded, so one pick cannot exhaust the page's memory. */
export const CHAT_IMAGE_MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export type ChatImage = { blob: Blob; width: number; height: number };
/** Draws the decoded picture at the given size and encodes it; null when the browser cannot encode that type. */
export type ImageEncoder = (width: number, height: number, type: string, quality: number) => Promise<Blob | null>;

/** The size with its long edge at most `edge`, keeping the proportions. Never enlarges. */
export function fitWithin(width: number, height: number, edge = CHAT_IMAGE_LONG_EDGE) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A picture already small enough keeps its bytes (a GIF keeps its animation); anything else is re-encoded. */
export function keepsOriginal(type: string, bytes: number, width: number, height: number) {
  return ATTACHMENT_IMAGE_MIMES.includes(type) && bytes <= CHAT_IMAGE_TARGET_BYTES
    && Math.max(width, height) <= CHAT_IMAGE_LONG_EDGE;
}

const SCALES = [1, 0.85, 0.7, 0.55, 0.4];
const QUALITIES = [0.85, 0.7, 0.55, 0.4];
// WebP first (it keeps transparency and is smaller); Safari cannot encode it, so JPEG follows.
const TYPES = ["image/webp", "image/jpeg"];

/** The first size and quality that fits the target, largest picture first. */
export async function encodeWithinTarget(width: number, height: number, encode: ImageEncoder,
  target = CHAT_IMAGE_TARGET_BYTES): Promise<ChatImage> {
  const base = fitWithin(width, height);
  for (const scale of SCALES) {
    const w = Math.max(1, Math.round(base.width * scale)), h = Math.max(1, Math.round(base.height * scale));
    for (const type of TYPES) for (const quality of QUALITIES) {
      const blob = await encode(w, h, type, quality);
      if (blob && blob.type === type && blob.size > 0 && blob.size <= target) return { blob, width: w, height: h };
    }
  }
  throw new Error("这张图片压缩后仍然太大，没有发送。");
}

/** Reads, shrinks and re-encodes one picked file. Browser only. */
export async function compressChatImage(file: Blob): Promise<ChatImage> {
  if (!ATTACHMENT_IMAGE_MIMES.includes(file.type)) throw new Error("只能发送 JPEG、PNG、WebP 或 GIF 图片。");
  if (file.size > CHAT_IMAGE_MAX_SOURCE_BYTES) throw new Error("这张图片太大，没有发送。");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("这张图片无法读取。"); }
  try {
    const { width, height } = bitmap;
    if (keepsOriginal(file.type, file.size, width, height)) return { blob: file, width, height };
    return await encodeWithinTarget(width, height, (w, h, type, quality) => new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const context = canvas.getContext("2d");
      if (!context) { resolve(null); return; }
      // JPEG has no transparency: a transparent area would turn black.
      if (type === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, w, h); }
      context.drawImage(bitmap, 0, 0, w, h);
      canvas.toBlob(resolve, type, quality);
    }));
  } finally { bitmap.close(); }
}
