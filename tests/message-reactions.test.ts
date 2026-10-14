import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage, type ChatStorageChange } from "../lib/chat/storage";
import { canReactTo, isMessageReactions, isReactionEmoji, reactionBadges, withReaction } from "../lib/chat/reactions";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";

test("a reaction is exactly one emoji", () => {
  for (const ok of ["❤️", "👍", "‼️", "❓", "😂", "👍🏽", "👨‍👩‍👧", "🇨🇳", "1️⃣"]) assert.ok(isReactionEmoji(ok), ok);
  for (const bad of ["", "a", "ab", "❤️❤️", "👍 ", " 👍", "1", "<b>", "👍x", 5, null, undefined, "👍".repeat(40)])
    assert.equal(isReactionEmoji(bad), false, String(bad));
});

test("reactions keep one emoji per side and disappear when the last is cleared", () => {
  const first = withReaction(undefined, "user", "❤️");
  assert.deepEqual(first, { user: "❤️" });
  assert.deepEqual(withReaction(first!, "user", "👍"), { user: "👍" });
  assert.deepEqual(withReaction(first!, "character", "😂"), { user: "❤️", character: "😂" });
  assert.equal(withReaction(first!, "user", null), null);
  assert.equal(withReaction(undefined, "user", null), null);
  assert.deepEqual(reactionBadges({ reactions: { user: "❤️", character: "😂" } }), ["😂", "❤️"]);
  assert.deepEqual(reactionBadges({}), []);
  assert.equal(isMessageReactions({}), false);
  assert.equal(isMessageReactions({ other: "❤️" }), false);
});

test("only sent or completed, non-system messages can be reacted to", () => {
  assert.ok(canReactTo({ role: "user", status: "sent" }) && canReactTo({ role: "assistant", status: "complete" }));
  for (const status of ["streaming", "error", "cancelled"] as const) assert.equal(canReactTo({ role: "assistant", status }), false);
  assert.equal(canReactTo({ role: "system", status: "complete" }), false);
});

async function conversation() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const sent = await storage.send(session.id, "hello");
  const batch = await storage.beginReply(session.id);
  assert(batch);
  await storage.finalizeReply(batch.assistant.id, "hi there");
  const messages = (await storage.readSession(session.id)).messages;
  return { storage, session, sent, reply: messages.find((m) => m.role === "assistant")! };
}

test("a reaction is saved on the message only, can be changed and cleared, and leaves no empty field", async () => {
  const { storage, session, reply } = await conversation();
  const before = await storage.readSession(session.id);
  const events: ChatStorageChange[] = [];
  storage.subscribe((change) => events.push(change));
  await storage.setReaction(reply.id, "user", "❤️");
  let read = await storage.readSession(session.id);
  assert.deepEqual(read.messages.find((m) => m.id === reply.id)!.reactions, { user: "❤️" });
  assert.deepEqual(read.session, before.session, "session summary, preview and ordering are untouched");
  assert.equal(read.messages.find((m) => m.id === reply.id)!.content, reply.content);
  assert.deepEqual(events, [{ domain: "messages", sessionId: session.id }]);
  await storage.setReaction(reply.id, "user", "👍");
  read = await storage.readSession(session.id);
  assert.deepEqual(read.messages.find((m) => m.id === reply.id)!.reactions, { user: "👍" });
  await storage.setReaction(reply.id, "user", null);
  read = await storage.readSession(session.id);
  assert.equal(Object.hasOwn(read.messages.find((m) => m.id === reply.id)!, "reactions"), false);
});

test("a reaction survives editing and goes away with the message", async () => {
  const { storage, session, sent } = await conversation();
  await storage.setReaction(sent.id, "user", "😂");
  await storage.editMessage(sent.id, "hello again");
  const edited = (await storage.readSession(session.id)).messages.find((m) => m.id === sent.id)!;
  assert.equal(edited.content, "hello again");
  assert.deepEqual(edited.reactions, { user: "😂" });
  await storage.deleteMessages(session.id, [sent.id]);
  assert.equal((await storage.readSession(session.id)).messages.some((m) => m.id === sent.id), false);
  await assert.rejects(storage.setReaction(sent.id, "user", "❤️"), /not found/i);
});

test("invalid emoji and unreactable messages are refused without writing", async () => {
  const { storage, session, reply } = await conversation();
  await assert.rejects(storage.setReaction(reply.id, "user", "not an emoji"), /single emoji/);
  await assert.rejects(storage.setReaction(reply.id, "user", ""), /single emoji/);
  assert.equal((await storage.readSession(session.id)).messages.find((m) => m.id === reply.id)!.reactions, undefined);
});

test("backup accepts reactions, rejects malformed ones, and treats absence as the normal form", async () => {
  const withReaction = backupData();
  (withReaction.chat.messages[1] as Record<string, unknown>).reactions = { user: "❤️", character: "😂" };
  const ok = await packageFixture(withReaction);
  const result = await validateBackupPackage(JSON.stringify(ok.manifest), ok.files);
  assert.deepEqual((result.data.chat.messages[1] as { reactions?: unknown }).reactions, { user: "❤️", character: "😂" });
  const plain = await packageFixture(backupData());
  const plainResult = await validateBackupPackage(JSON.stringify(plain.manifest), plain.files);
  assert.equal(Object.hasOwn(plainResult.data.chat.messages[1], "reactions"), false);
  for (const bad of [{}, { user: "x" }, { user: "❤️❤️" }, { other: "❤️" }, { user: "❤️", extra: "👍" }, "❤️", ["❤️"], null]) {
    const data = backupData();
    (data.chat.messages[1] as Record<string, unknown>).reactions = bad;
    const fixture = await packageFixture(data);
    await assert.rejects(validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files), (error: unknown) => { void error; return true; }, `accepted ${JSON.stringify(bad)}`);
  }
});

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const bar = readFileSync("components/chat/reaction-bar.tsx", "utf8");
const picker = readFileSync("components/chat/reaction-picker.tsx", "utf8");

test("the reaction bar rides the tap-opened message layer and does not create messages or requests", () => {
  assert.match(room, /<ReactionBar barRef=\{reactionBar\}/);
  assert.match(room, /canReactTo\(activeMessage\)/);
  assert.match(room, /chatStorage\.setReaction\(message\.id, "user", emoji\)/);
  assert.doesNotMatch(room.match(/async function react\([\s\S]*?\n  }\n/)![0], /send\(|beginReply|engine\./);
  assert.match(room, /messageStackShift\(/);
});

test("the full picker is loaded on demand and uses native emoji so no glyph is fetched from a CDN", () => {
  assert.match(bar, /lazy\(\(\) => import\("\.\/reaction-picker"\)\)/);
  assert.match(picker, /emojiStyle=\{EmojiStyle\.NATIVE\}/);
  assert.doesNotMatch(picker, /EmojiStyle\.(?!NATIVE)|customEmoji|getEmojiUrl/);
});
