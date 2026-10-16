import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { memoryMessageEligible } from "../lib/memory/sequence";
import { deferred, progressFixture } from "./memory-progress-fixture";
import { addStickers, createPack, emptyStickerDocument, toMessageSticker } from "../lib/chat/sticker-storage";
import type { ChatMessage } from "../lib/chat/types";

const users = (messages: readonly ChatMessage[]) => messages.filter((m) => m.role === "user");
const markers = (messages: readonly ChatMessage[]) => messages.filter((m) => m.status === "cancelled" || m.status === "error");

/** The engine releases its lock when its attempt winds down; storage-only tests do the same by hand. */
async function giveUp(storage: ChatStorage, id: string, content: string) {
  const attempt = (await storage.readSession(id)).session.generation?.id;
  const sent = await storage.send(id, content, undefined, undefined, undefined, true);
  if (attempt) await storage.releaseGeneration(id, attempt);
  return sent;
}
async function lifeSession(storage: ChatStorage, characterId = "a") {
  const session = await storage.openSession(characterId);
  await storage.updateSessionSettings(session.id, { lifeMode: true });
  return session.id;
}

test("interjecting gives up the unfinished draft, frees the claimed messages and saves the new one in one step", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const id = await lifeSession(storage);
  await storage.send(id, "one"); await storage.send(id, "two");
  const batch = await storage.beginReply(id); assert(batch);
  await storage.updateReply(batch.assistant.id, { content: "half a sen", status: "streaming" });
  const changes: unknown[] = []; const stop = storage.subscribe((change) => changes.push(change));
  const attempt = (await storage.readSession(id)).session.generation!.id;
  const three = await storage.send(id, "three", undefined, undefined, undefined, true);
  stop();
  const { session, messages } = await storage.readSession(id);
  assert.equal(session.generation, undefined);
  assert.equal(messages.some((m) => m.id === batch.assistant.id), false, "the unfinished text is not kept as a bubble");
  assert.deepEqual(markers(messages), [], "no Reply stopped / Retry");
  assert.deepEqual(users(messages).map((m) => [m.content, !!m.requestedBy]), [["one", false], ["two", false], ["three", false]]);
  assert.equal(session.lastMessageId, three.id);
  assert.ok(changes.some((change) => (change as { generationChanged?: boolean }).generationChanged), "the running attempt is told to stop");
  // The given-up attempt can no longer write or finish.
  await assert.rejects(storage.updateReply(batch.assistant.id, { content: "late", status: "streaming" }));
  await assert.rejects(storage.finalizeReply(batch.assistant.id, "late reply"), /no longer active/);
  await storage.releaseGeneration(id, attempt);
  // The next reply answers everything that is waiting.
  const next = await storage.beginReply(id); assert(next);
  assert.deepEqual(next.pending.map((m) => m.content), ["one", "two", "three"]);
});

test("two interjections in a row leave one waiting turn and no stray drafts", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const id = await lifeSession(storage);
  await storage.send(id, "one");
  assert(await storage.beginReply(id));
  await giveUp(storage, id, "two");
  assert(await storage.beginReply(id));
  await giveUp(storage, id, "three");
  const { messages, session } = await storage.readSession(id);
  assert.equal(session.generation, undefined);
  assert.deepEqual(messages.map((m) => m.role), ["user", "user", "user"]);
  assert.equal(messages.every((m) => !m.requestedBy), true);
});

test("a reply that already finished wins: its bubbles stay and the new message is an ordinary send", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const id = await lifeSession(storage);
  await storage.send(id, "one");
  const batch = await storage.beginReply(id); assert(batch);
  const done = await storage.finalizeReply(batch.assistant.id, "first bubble\n\nsecond bubble");
  await storage.send(id, "two", undefined, undefined, undefined, true);
  const { messages } = await storage.readSession(id);
  assert.deepEqual(messages.filter((m) => m.role === "assistant").map((m) => [m.id, m.status]), done.map((m) => [m.id, "complete"]));
  assert.equal(users(messages).find((m) => m.content === "one")?.requestedBy, batch.assistant.id, "the answered message stays answered");
  assert.equal(users(messages).find((m) => m.content === "two")?.requestedBy, undefined);
});

test("interjecting is refused outside Life Mode and without the explicit flag, so ordinary chat keeps its lock", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const plain = await storage.openSession("a");
  await storage.send(plain.id, "one"); assert(await storage.beginReply(plain.id));
  await assert.rejects(storage.send(plain.id, "two", undefined, undefined, undefined, true), /already in progress/);
  const life = await lifeSession(storage, "b");
  await storage.send(life, "one"); assert(await storage.beginReply(life));
  await assert.rejects(storage.send(life, "two"), /already in progress/);
});

test("the engine stops the interrupted request without a marker, and its late text never lands", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const release = deferred(); let calls = 0;
  const engine = createChatEngine(storage, async () => document,
    async function* () { calls++; yield "Hello, I was just"; await release.promise; yield " about to say more"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  const id = await lifeSession(storage);
  await engine.send(id, "one");
  const running = engine.requestReply(id, undefined, "life-reply");
  for (let tries = 0; tries < 200; tries++) {
    const { messages } = await storage.readSession(id);
    if (messages.some((m) => m.role === "assistant" && m.content.startsWith("Hello"))) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await engine.send(id, "wait, one more thing", undefined, { interject: true });
  release.resolve();
  assert.equal(await running, null);
  const { messages, session } = await storage.readSession(id);
  assert.equal(session.generation, undefined);
  assert.equal(engine.isGenerating(id), false);
  assert.deepEqual(messages.filter((m) => m.role === "assistant"), [], "no partial bubble and no Retry");
  assert.deepEqual(users(messages).map((m) => [m.content, !!m.requestedBy]), [["one", false], ["wait, one more thing", false]]);
  assert.equal(calls, 1, "no retry or extra model call");
});

test("a sticker interjects the same way: the unfinished reply goes, the sticker stays and waits for an answer", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  let pack = createPack(emptyStickerDocument(), "猫", "", "p1", 1);
  pack = addStickers(pack, "p1", [{ name: "贴贴", url: "https://img.test/1.png" }], () => "s1").document;
  const sticker = toMessageSticker(pack.packs[0], pack.packs[0].stickers[0]);
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const release = deferred(); let calls = 0;
  const engine = createChatEngine(storage, async () => document,
    async function* () { calls++; yield "Hello, I was just"; await release.promise; yield " about to say more"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  const id = await lifeSession(storage);
  await engine.send(id, "one");
  const running = engine.requestReply(id, undefined, "life-reply");
  for (let tries = 0; tries < 200; tries++) {
    const { messages } = await storage.readSession(id);
    if (messages.some((m) => m.role === "assistant" && m.content.startsWith("Hello"))) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const sent = await engine.sendSticker(id, sticker, undefined, { interject: true });
  release.resolve();
  assert.equal(await running, null);
  const { messages, session } = await storage.readSession(id);
  assert.equal(session.generation, undefined);
  assert.deepEqual(messages.filter((m) => m.role === "assistant"), [], "no partial bubble and no Retry");
  assert.deepEqual(users(messages).map((m) => [m.id, !!m.requestedBy]), [[messages[0].id, false], [sent.id, false]]);
  assert.deepEqual(users(messages).at(-1)?.sticker, sticker);
  assert.equal(calls, 1, "no retry or extra model call");
  // Outside Life Mode, or without the flag, a sticker still waits for the reply as before.
  const plain = await storage.openSession("b");
  await storage.send(plain.id, "one"); assert(await storage.beginReply(plain.id));
  await assert.rejects(storage.sendSticker(plain.id, sticker, undefined, true), /already in progress/);
  await engine.send(id, "two"); assert(await storage.beginReply(id));
  await assert.rejects(storage.sendSticker(id, sticker), /already in progress/);
});

test("the user's own Stop still leaves its retryable marker", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const release = deferred();
  const engine = createChatEngine(storage, async () => document,
    async function* () { yield "Hello"; await release.promise; yield " more"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  const id = await lifeSession(storage);
  await engine.send(id, "one");
  const running = engine.requestReply(id, undefined, "life-reply");
  for (let tries = 0; tries < 200 && !(await storage.readSession(id)).messages.some((m) => m.content === "Hello"); tries++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  engine.stop(id, { persist: true }); release.resolve();
  await running;
  const { messages } = await storage.readSession(id);
  assert.deepEqual(markers(messages).map((m) => m.status), ["cancelled"]);
});

test("Memory: a given-up draft never took a sequence number, so numbering, ownership and confirmation stay intact", async () => {
  const f = await progressFixture();
  await f.chat.updateSessionSettings(f.session.id, { lifeMode: true });
  await f.send("one");
  const given = await f.chat.beginReply(f.session.id); assert(given);
  await f.chat.updateReply(given.assistant.id, { content: "half", status: "streaming" });
  await giveUp(f.chat, f.session.id, "two");
  const reply = await f.chat.beginReply(f.session.id); assert(reply);
  const bubbles = await f.chat.finalizeReply(reply.assistant.id, "answer one\n\nanswer two");
  await f.send("three"); // confirms the reply bubbles, which then take their numbers
  const view = await f.snapshot();
  const numbered = view.messages.filter((m) => m.memorySequence?.seq !== undefined)
    .sort((a, b) => a.memorySequence!.seq! - b.memorySequence!.seq!);
  assert.deepEqual(numbered.map((m) => m.content), ["one", "two", "answer one", "answer two", "three"]);
  assert.deepEqual(numbered.map((m) => m.memorySequence!.seq), [1, 2, 3, 4, 5], "contiguous: nothing was skipped or renumbered");
  assert.equal(view.session?.memorySequence?.nextSeq, 6);
  assert.equal(numbered.every((m) => m.memorySequence!.epoch === view.session!.memorySequence!.epoch && memoryMessageEligible(m)), true);
  assert.equal(view.messages.some((m) => m.id === given.assistant.id), false);
  assert.deepEqual(users(view.messages).filter((m) => m.content !== "three").map((m) => m.requestedBy), [bubbles[0].id, bubbles[0].id],
    "both messages belong to the reply that answered them");
});

test("the chat page lets Send through during a reply only in Life Mode, and passes the interjection on", async () => {
  const { readFileSync } = await import("node:fs");
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(room, /const interject = session\.lifeMode === true && \(generationActive \|\| chatEngine\.isGenerating\(session\.id\)\);/);
  assert.match(room, /if \(!interject && \(generationActive \|\| chatEngine\.isGenerating\(session\.id\)\)\) return;/);
  assert.match(room, /chatEngine\.send\(sessionId, content, quote\?\.id, \{ interject, discardUnrevealed: unrevealed \}\)/);
  assert.match(room, /disabled=\{!session \|\| \(generationActive && session\.lifeMode !== true\) \|\| sending/);
  const sticker = room.slice(room.indexOf("async function sendSticker("), room.indexOf("\n  async function reply"));
  assert.match(sticker, /const interject = session\.lifeMode === true && \(generationActive \|\| chatEngine\.isGenerating\(session\.id\)\);/);
  assert.match(sticker, /if \(!interject && \(generationActive \|\| chatEngine\.isGenerating\(session\.id\)\)\) return;/);
  assert.match(sticker, /chatEngine\.sendSticker\(sessionId, sticker, quote\?\.id, \{ interject, discardUnrevealed: unrevealed \}\)/);
  assert.match(room, /<StickerPanel disabled=\{\(generationActive && session\?\.lifeMode !== true\) \|\| sending \|\| !!loadError\}/);
  assert.match(room, /aria-label="Stop reply"[\s\S]{0,200}chatEngine\.stop\(session\.id, \{ persist: true \}\)/, "Stop is unchanged");
});
