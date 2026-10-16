import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { CHAT_IMAGE_LONG_EDGE, CHAT_IMAGE_TARGET_BYTES, encodeWithinTarget, fitWithin, keepsOriginal, type ImageEncoder } from "../lib/chat/image-compress";

const blobOf = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

test("a picture is scaled to a 2048 long edge, keeping its proportions and never enlarged", () => {
  assert.deepEqual(fitWithin(4096, 2048), { width: 2048, height: 1024 });
  assert.deepEqual(fitWithin(1000, 4000), { width: 512, height: 2048 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(5000, 1), { width: 2048, height: 1 });
  assert.equal(CHAT_IMAGE_LONG_EDGE, 2048);
});

test("a small picture keeps its own bytes (so a GIF keeps moving); a big or oversized one is re-encoded", () => {
  assert.equal(keepsOriginal("image/gif", 200_000, 400, 300), true);
  assert.equal(keepsOriginal("image/png", CHAT_IMAGE_TARGET_BYTES, 2048, 100), true);
  assert.equal(keepsOriginal("image/png", CHAT_IMAGE_TARGET_BYTES + 1, 100, 100), false);
  assert.equal(keepsOriginal("image/jpeg", 10_000, 2049, 100), false);
  assert.equal(keepsOriginal("image/svg+xml", 100, 10, 10), false);
  assert.equal(keepsOriginal("image/heic", 100, 10, 10), false);
});

test("encoding takes the largest, best size that fits ~1 MB, WebP first and JPEG where WebP cannot be made", async () => {
  const calls: string[] = [];
  const roomy: ImageEncoder = async (w, h, type, quality) => { calls.push(`${w}x${h} ${type} ${quality}`); return blobOf(type, 900_000); };
  const first = await encodeWithinTarget(4000, 3000, roomy);
  assert.deepEqual([first.width, first.height, first.blob.type], [2048, 1536, "image/webp"]);
  assert.equal(calls.length, 1);

  const noWebp: ImageEncoder = async (_w, _h, type) => type === "image/webp" ? blobOf("image/png", 10) : blobOf(type, 500_000);
  assert.equal((await encodeWithinTarget(1000, 1000, noWebp)).blob.type, "image/jpeg", "a browser that answers with another type is not trusted");

  const sizes = new Map<string, number>();
  const stingy: ImageEncoder = async (w, _h, type, quality) => {
    const bytes = Math.round(w * 700 * quality); sizes.set(`${w} ${quality}`, bytes); return blobOf(type, bytes);
  };
  const shrunk = await encodeWithinTarget(2000, 2000, stingy);
  assert.ok(shrunk.blob.size <= CHAT_IMAGE_TARGET_BYTES);
  assert.ok(shrunk.width < 2000 || shrunk.blob.size < CHAT_IMAGE_TARGET_BYTES);
});

test("a picture that cannot be made small enough is refused rather than stored large", async () => {
  await assert.rejects(encodeWithinTarget(3000, 3000, async (_w, _h, type) => blobOf(type, CHAT_IMAGE_TARGET_BYTES + 1)), /太大/);
  await assert.rejects(encodeWithinTarget(3000, 3000, async () => null), /太大/);
});

function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const prompts: { role: string; content: unknown }[][] = [];
  const engine = createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push([...prompt] as never); yield "nice picture"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  return { storage, engine, prompts };
}

test("the engine saves an image message that interrupts an unrevealed reply; the model sees only its semantic text", async () => {
  const { storage, engine, prompts } = setup();
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  await engine.requestReply(session.id);
  const sentBefore = (await storage.readSession(session.id)).messages;
  const last = sentBefore.at(-1)!;
  const image = await engine.sendImage(session.id, { blob: blobOf("image/png", 1234), width: 30, height: 20 }, undefined, { discardUnrevealed: [last.id] });
  assert.deepEqual(image.attachment && [image.attachment.width, image.attachment.height, image.attachment.bytes], [30, 20, 1234]);
  const { messages } = await storage.readSession(session.id);
  assert.equal(messages.some((m) => m.id === last.id), false, "the unshown reply is dropped like for a sticker");
  assert.equal(messages.at(-1)!.id, image.id);
  assert.equal(messages.at(-1)!.role, "user");
  assert.equal((await storage.readMessageAttachment(session.id, image.id))?.size, 1234);
  await engine.requestReply(session.id);
  const prompt = prompts.at(-1)!;
  assert.ok(prompt.some((turn) => turn.content === "[用户发送了一张图片]"));
  assert.ok(prompt.every((turn) => typeof turn.content === "string"), "nothing but text reaches the provider in M2");
});

test("an image the storage refuses leaves no message behind", async () => {
  const { storage, engine } = setup();
  const session = await storage.openSession("a");
  await assert.rejects(engine.sendImage(session.id, { blob: blobOf("image/svg+xml", 10), width: 5, height: 5 }));
  await assert.rejects(engine.sendImage(session.id, { blob: blobOf("image/png", 10), width: 0, height: 5 }));
  assert.equal((await storage.readSession(session.id)).messages.length, 0);
});

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const plus = readFileSync("components/chat/chat-plus-panel.tsx", "utf8");
const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
const viewer = readFileSync("components/chat/messages/image-message.tsx", "utf8");

test("Photos in the + panel picks several pictures; each is shrunk then sent as its own message through the engine", () => {
  assert.doesNotMatch(plus, /label: "Photos"/, "Photos is no longer a Coming Soon placeholder");
  assert.match(plus, /onClick=\{onPhotos\}/);
  assert.match(room, /type="file" multiple accept=\{ATTACHMENT_IMAGE_MIMES\.join/);
  const start = room.indexOf("async function sendImages(");
  const body = room.slice(start, room.indexOf("\n  async function reply", start));
  assert.match(body, /compressChatImage\(file\)/);
  assert.match(body, /chatEngine\.sendImage\(/);
  assert.doesNotMatch(body, /requestReply|beginReply/, "sending a picture does not ask for a reply");
  assert.match(body, /sendingLock\.current/);
});

test("the message list draws the stored picture, opens it large with Save, and leaves selection mode to select", () => {
  assert.match(timeline, /message\.attachment && <ImageMessage/);
  assert.match(timeline, /message\.sticker \|\| message\.attachment \? null/);
  assert.match(viewer, /readMessageAttachment\(sessionId, messageId\)/);
  assert.match(viewer, /URL\.revokeObjectURL/);
  assert.match(viewer, /download=\{name\}/);
  assert.match(viewer, /if \(multiSelect\) return;/);
});
