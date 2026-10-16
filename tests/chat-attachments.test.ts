import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, CHAT_IMAGE_ORPHAN_GRACE_MS, ChatStorage } from "../lib/chat/storage";
import { isMessageAttachment, MAX_ATTACHMENT_IMAGE_BYTES, type MessageAttachment } from "../lib/chat/attachment";
import { hasGeneratedContent, isCardMessage, isFixedMessage, listPreview, mediaPreview } from "../lib/chat/message-kind";
import { quoteMessage } from "../lib/chat/quote";
import { canRecallMessage } from "../lib/chat/recall";
import type { ChatMessage } from "../lib/chat/types";

const png = (label: string) => new Blob([label], { type: "image/png" });
const setup = () => {
  const factory = new IDBFactory();
  return { factory, storage: new ChatStorage(() => factory) };
};
async function rows<T>(factory: IDBFactory, store: string): Promise<T[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(CHAT_DATABASE_NAME);
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
const assetIds = async (factory: IDBFactory) => (await rows<{ id: string }>(factory, "assets")).map((row) => row.id).sort();
async function putRow(factory: IDBFactory, store: string, row: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(CHAT_DATABASE_NAME);
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(row);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function withClock<T>(run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try { return await run((ms) => { offset += ms; }); }
  finally { Date.now = realNow; }
}

test("an image message is one transaction: the owned asset, a semantic text, a short preview", async () => {
  const { factory, storage } = setup();
  const session = await storage.openSession("peter");
  const sent = await storage.sendImage(session.id, png("pixels"), 640, 480);
  assert.equal(sent.content, "[用户发送了一张图片]");
  assert.equal(sent.status, "sent");
  assert.deepEqual({ ...sent.attachment, assetId: "x" }, { kind: "image", assetId: "x", mime: "image/png", width: 640, height: 480, bytes: 6 });
  assert(isMessageAttachment(sent.attachment));
  assert.deepEqual(await assetIds(factory), [sent.attachment!.assetId]);
  const read = await storage.readSession(session.id);
  assert.equal(read.session.lastMessagePreview, "[图片]");
  assert.equal(read.messages[0].attachment?.assetId, sent.attachment!.assetId);
  assert.equal(await (await storage.readMessageAttachment(session.id, sent.id))!.text(), "pixels");
});

test("a refused image writes nothing: not an asset, not a message, not a preview", async () => {
  const { factory, storage } = setup();
  const session = await storage.openSession("peter");
  const refused: [Blob, number, number][] = [
    [new Blob(["<svg/>"], { type: "image/svg+xml" }), 10, 10], [new Blob(["x"], { type: "text/plain" }), 10, 10],
    [new Blob([], { type: "image/png" }), 10, 10], [png("x"), 0, 10], [png("x"), 10, 1.5], [png("x"), 10, 20_000],
  ];
  for (const [blob, width, height] of refused) await assert.rejects(storage.sendImage(session.id, blob, width, height));
  const tooLarge = { type: "image/png", size: MAX_ATTACHMENT_IMAGE_BYTES + 1 } as Blob;
  await assert.rejects(storage.sendImage(session.id, tooLarge, 10, 10), /25 MiB/);
  assert.deepEqual(await assetIds(factory), []);
  assert.equal((await storage.readSession(session.id)).messages.length, 0);
});

test("a message image is never reclaimed as an orphan, even after its wallpaper neighbours change", async () => {
  await withClock(async (advance) => {
    const { factory, storage } = setup();
    const session = await storage.openSession("peter");
    const sent = await storage.sendImage(session.id, png("kept"), 8, 8);
    const first = await storage.saveChatImage(png("wallpaper one"));
    await storage.updateSessionSettings(session.id, { backgroundImage: first });
    advance(CHAT_IMAGE_ORPHAN_GRACE_MS * 5);
    const second = await storage.saveChatImage(png("wallpaper two")); // runs the orphan reclaim
    await storage.updateSessionSettings(session.id, { backgroundImage: second }); // releases the first wallpaper
    advance(CHAT_IMAGE_ORPHAN_GRACE_MS * 5);
    await storage.saveChatImage(png("trigger"));
    const left = await assetIds(factory);
    assert(left.includes(sent.attachment!.assetId), "the message image survives every reclaim");
    assert(!left.includes(first), "the replaced wallpaper is gone");
    assert.notEqual(await storage.readMessageAttachment(session.id, sent.id), null);
  });
});

test("an unreferenced asset beside a message image is still reclaimed", async () => {
  await withClock(async (advance) => {
    const { factory, storage } = setup();
    const session = await storage.openSession("peter");
    const sent = await storage.sendImage(session.id, png("kept"), 8, 8);
    const orphan = await storage.saveChatImage(png("orphan"));
    advance(CHAT_IMAGE_ORPHAN_GRACE_MS + 1000);
    await storage.saveChatImage(png("next"));
    const left = await assetIds(factory);
    assert(left.includes(sent.attachment!.assetId));
    assert(!left.includes(orphan));
  });
});

test("deleting messages deletes exactly their assets in the same transaction", async () => {
  const { factory, storage } = setup();
  const session = await storage.openSession("peter");
  const one = await storage.sendImage(session.id, png("one"), 8, 8);
  const two = await storage.sendImage(session.id, png("two"), 8, 8);
  await storage.send(session.id, "plain text");
  assert.equal(await storage.deleteMessages(session.id, [one.id]), 1);
  assert.deepEqual(await assetIds(factory), [two.attachment!.assetId]);
  assert.equal(await storage.readMessageAttachment(session.id, one.id), null);
  assert.notEqual(await storage.readMessageAttachment(session.id, two.id), null);
  assert.equal(await storage.deleteMessages(session.id, ["no-such-message"]), 0);
  assert.deepEqual(await assetIds(factory), [two.attachment!.assetId]);
});

test("clearing and deleting a conversation delete its message images but not another conversation's", async () => {
  const { factory, storage } = setup();
  const peter = await storage.openSession("peter"), pep = await storage.openSession("pep");
  const wallpaper = await storage.saveChatImage(png("wallpaper"));
  await storage.updateSessionSettings(peter.id, { backgroundImage: wallpaper });
  await storage.sendImage(peter.id, png("peter one"), 8, 8);
  await storage.sendImage(peter.id, png("peter two"), 8, 8);
  const kept = await storage.sendImage(pep.id, png("pep"), 8, 8);
  await storage.clearSession(peter.id);
  assert.deepEqual(await assetIds(factory), [kept.attachment!.assetId, wallpaper].sort());
  await storage.sendImage(peter.id, png("peter again"), 8, 8);
  await storage.deleteSession(peter.id);
  assert.deepEqual(await assetIds(factory), [kept.attachment!.assetId]);
});

test("a message image is only readable through the conversation that owns it", async () => {
  const { storage } = setup();
  const peter = await storage.openSession("peter"), pep = await storage.openSession("pep");
  const sent = await storage.sendImage(peter.id, png("private"), 8, 8);
  assert.equal(await storage.readMessageAttachment(pep.id, sent.id), null);
  assert.equal(await storage.readMessageAttachment(peter.id, "no-such-message"), null);
  const text = await storage.send(peter.id, "words");
  assert.equal(await storage.readMessageAttachment(peter.id, text.id), null);
  assert.notEqual(await storage.readMessageAttachment(peter.id, sent.id), null);
});

test("recalling an image message withdraws the image with it", async () => {
  const { factory, storage } = setup();
  const session = await storage.openSession("peter");
  const sent = await storage.sendImage(session.id, png("oops"), 8, 8);
  const other = await storage.sendImage(session.id, png("stays"), 8, 8);
  assert(canRecallMessage(sent, "user", sent.sentAt!), "a media message can be recalled like any other");
  const recalled = await storage.recallMessage(sent.id, "user");
  assert.equal(recalled.content, "");
  assert.equal(recalled.attachment, undefined);
  assert.deepEqual(await assetIds(factory), [other.attachment!.assetId]);
  const stored = (await storage.readSession(session.id)).messages.find((message) => message.id === sent.id)!;
  assert.equal(stored.attachment, undefined);
  assert(stored.recalled);
});

test("a media message can be quoted, reacted to and deleted but not edited", async () => {
  const { storage } = setup();
  const session = await storage.openSession("peter");
  const sent = await storage.sendImage(session.id, png("quoted"), 8, 8);
  await assert.rejects(storage.editMessage(sent.id, "new words"), /cannot be edited/);
  assert.equal(quoteMessage(sent).preview, "[图片]");
  const reply = await storage.send(session.id, "nice", sent.id);
  assert.deepEqual(reply.quote, { messageId: sent.id, role: "user", preview: "[图片]" });
  await storage.setReaction(sent.id, "user", "👍");
  assert.equal((await storage.readSession(session.id)).messages[0].reactions?.user, "👍");
  assert.equal((await storage.readSession(session.id)).messages[0].content, "[用户发送了一张图片]");
});

test("regenerating a reply deletes the assets of the turn it replaces and never inherits them", async () => {
  const { factory, storage } = setup();
  const session = await storage.openSession("peter");
  await storage.send(session.id, "draw something");
  const first = await storage.beginReply(session.id);
  await storage.finalizeReply(first!.assistant.id, "here");
  // Stand in for a later assistant image message: the reply row owns an asset.
  const assetId = "assistant-owned-asset";
  const attachment: MessageAttachment = { kind: "image", assetId, mime: "image/png", width: 8, height: 8, bytes: 5 };
  await putRow(factory, "assets", { id: assetId, blob: png("ai pic"), createdAt: Date.now() });
  const reply = (await storage.readSession(session.id)).messages.find((message) => message.role === "assistant")!;
  await putRow(factory, "messages", { ...reply, attachment });
  assert.deepEqual(await assetIds(factory), [assetId]);
  const second = await storage.beginReply(session.id, reply.id);
  assert(second);
  await storage.finalizeReply(second.assistant.id, "another try");
  assert.deepEqual(await assetIds(factory), []);
  const after = (await storage.readSession(session.id)).messages.filter((message) => message.role === "assistant");
  assert.equal(after.length, 1);
  assert.equal(after[0].content, "another try");
  assert.equal(after[0].attachment, undefined);
});

test("one place answers what a message is made of", () => {
  const base = { id: "m", sessionId: "s", role: "user", content: "words", status: "sent", createdAt: 1, order: 1 } as ChatMessage;
  const image: MessageAttachment = { kind: "image", assetId: "a", mime: "image/png", width: 1, height: 1, bytes: 1 };
  const sticker = { packId: "p", packName: "Pack", stickerId: "s", name: "Hi", url: "https://img.test/1.png" };
  assert.equal(mediaPreview(base), null);
  assert.equal(listPreview({ ...base, content: "x".repeat(200) }), "x".repeat(120));
  assert.equal(listPreview({ ...base, attachment: image }), "[图片]");
  assert.equal(listPreview({ ...base, sticker }), "[表情包] Hi");
  assert(hasGeneratedContent({ ...base, attachment: image }) && hasGeneratedContent({ ...base, sticker }) && !hasGeneratedContent(base));
  assert(isFixedMessage({ ...base, attachment: image }) && isFixedMessage({ ...base, sticker }) && !isFixedMessage(base));
  assert(isCardMessage({ ...base, transferEvent: { transferId: "t", action: "receive", actor: "user", amount: 1, note: "" } }));
  assert(!isCardMessage({ ...base, attachment: image } as ChatMessage));
});

test("the attachment shape is exact", () => {
  const good = { kind: "image", assetId: "abc-123", mime: "image/webp", width: 2048, height: 1024, bytes: 1_000_000 };
  assert(isMessageAttachment(good));
  for (const change of [{ kind: "audio" }, { assetId: "" }, { assetId: "a/b" }, { mime: "image/svg+xml" }, { mime: "text/html" },
    { width: 0 }, { height: 1.5 }, { width: 16_385 }, { bytes: 0 }, { bytes: MAX_ATTACHMENT_IMAGE_BYTES + 1 }, { extra: true }])
    assert(!isMessageAttachment({ ...good, ...change }), JSON.stringify(change));
  assert(!isMessageAttachment(null) && !isMessageAttachment([]) && !isMessageAttachment("image"));
});
