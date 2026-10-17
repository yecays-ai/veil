import type { PromptTurn } from "./types";

/**
 * Keeps pictures only on the newest `limit` turns that carry one; every other turn is sent as its semantic text.
 * Resending older pictures each turn would grow cost and request size with the length of the chat.
 */
export function newestImageTurns(messages: readonly PromptTurn[], limit: number): PromptTurn[] {
  let remaining = Math.max(0, limit);
  const keep = new Set<number>();
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index--)
    if (messages[index].images?.length) { keep.add(index); remaining--; }
  return messages.map((turn, index) => {
    if (!turn.images) return turn;
    const { images: _images, ...rest } = turn;
    void _images;
    return keep.has(index) ? turn : rest;
  });
}

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * Reads the chosen pictures and turns their ids into `imageData`. A picture that is gone or unreadable is left out
 * and its turn keeps its semantic text, so one lost picture never fails the reply.
 */
export async function loadPromptImages(
  messages: readonly PromptTurn[], read: (assetId: string) => Promise<Blob | null>, signal: AbortSignal,
): Promise<PromptTurn[]> {
  const out: PromptTurn[] = [];
  for (const turn of messages) {
    if (!turn.images) { out.push(turn); continue; }
    const { images, ...rest } = turn, imageData: string[] = [];
    for (const id of images) {
      signal.throwIfAborted();
      const blob = await read(id).catch(() => null);
      signal.throwIfAborted();
      if (blob?.type.startsWith("image/")) imageData.push(await dataUrl(blob));
    }
    out.push(imageData.length ? { ...rest, imageData } : rest);
  }
  return out;
}
