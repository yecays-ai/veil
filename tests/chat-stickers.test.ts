import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { selfState } from "../lib/chat/self-context";
import { addStickers, createPack, emptyStickerDocument, resolveStickerChoice, setPackCharacter, stickerMenu, toMessageSticker } from "../lib/chat/sticker-storage";
import { validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError } from "../lib/backup/format";
import { createChatEngine } from "./chat-engine-fixture";
import { backupData, packageFixture } from "./backup-fixture";
import type { StickerSource } from "../lib/chat/engine";
import type { TextProvider } from "../lib/chat/provider";
import type { ChatMessage } from "../lib/chat/types";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const NOW = 1_700_000_000_000;
const tag = (json: string) => `<veil-action>${json}</veil-action>`;

let doc = createPack(emptyStickerDocument(), "丑猫", "", "p1", 1);
doc = createPack(doc, "蜘蛛侠", "", "p2", 2);
let n = 0;
doc = addStickers(doc, "p1", [{ name: "贴贴", url: "https://img.test/1.png" }], () => `s${++n}`).document;
doc = addStickers(doc, "p2", [{ name: "贴贴", url: "https://img.test/2.png" }], () => `s${++n}`).document;
doc = setPackCharacter(setPackCharacter(doc, "p1", "simulated-character", true), "p2", "simulated-character", true);
const userSticker = toMessageSticker(doc.packs[0], doc.packs[0].stickers[0]);

async function setup(library = () => doc, checked = library) {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("simulated-character");
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  foundation.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated" }) }];
  const prompts: string[] = [];
  let reply = "Plain reply.";
  const provider: TextProvider = async function* (_config, messages) { prompts.push(messages.map((message) => message.content).join("\n")); yield reply; };
  const source: StickerSource = {
    menu: async (id) => stickerMenu(library(), id),
    resolve: async (id, choices, code) => resolveStickerChoice(checked(), id, choices, code),
  };
  const engine = createChatEngine(storage, async () => foundation, provider, undefined, () => new Date(NOW),
    undefined, undefined, undefined, undefined, undefined, async () => {},
    async (character, now, state) => selfState(character, undefined, undefined, now, state.lastReplyAt, state.announceChange, state.allowActions, state.reactions),
    async () => {}, undefined, undefined, source);
  const ask = async (text: string, answer: string) => {
    reply = answer;
    await storage.send(session.id, text);
    await engine.requestReply(session.id);
    await flush();
    return (await storage.readSession(session.id)).messages;
  };
  return { storage, session, engine, prompts, ask, setReply: (value: string) => { reply = value; } };
}
const assistants = (messages: ChatMessage[]) => messages.filter((message) => message.role === "assistant");

test("the user's sticker is a saved sent message with a semantic text, a short preview, and no edit", async () => {
  const { storage, session } = await setup();
  const sent = await storage.sendSticker(session.id, userSticker);
  assert.equal(sent.content, "[用户发送了一个表情包：丑猫｜贴贴]");
  assert.deepEqual(sent.sticker, userSticker);
  assert.equal(sent.status, "sent");
  const read = await storage.readSession(session.id);
  assert.equal(read.session.lastMessagePreview, "[表情包] 贴贴");
  await assert.rejects(storage.editMessage(sent.id, "changed"));
  await assert.rejects(storage.sendSticker(session.id, { ...userSticker, url: "javascript:1" }));
  const text = await storage.send(session.id, "plain", sent.id);
  assert.equal(text.quote?.preview, "[表情包] 贴贴");
  assert.equal(Object.hasOwn(text, "sticker"), false, "text messages carry no sticker field");
});

test("the model sees the user's sticker as the semantic text, never the link, even with user regex in play", async () => {
  const app = await setup();
  await app.storage.sendSticker(app.session.id, userSticker);
  await app.engine.requestReply(app.session.id);
  assert.match(app.prompts[0], /\[用户发送了一个表情包：丑猫｜贴贴\]/);
  assert.doesNotMatch(app.prompts[0], /img\.test/);
});

test("the Character is offered only its stickers by short code, and its reply gets text plus its own sticker bubble", async () => {
  const app = await setup();
  const messages = await app.ask("hi", `Hello there.\n\n${tag('{"sticker":"S02"}')}`);
  assert.match(app.prompts[0], /S01 = 丑猫｜贴贴/);
  assert.match(app.prompts[0], /S02 = 蜘蛛侠｜贴贴/);
  assert.equal(app.prompts.length, 1, "no extra model request");
  const replies = assistants(messages);
  assert.deepEqual(replies.map((message) => message.content), ["Hello there.", "[你发送了一个表情包：蜘蛛侠｜贴贴]"]);
  assert.equal(replies[0].sticker, undefined);
  assert.deepEqual(replies[1].sticker, { packId: "p2", packName: "蜘蛛侠", stickerId: "s2", name: "贴贴", url: "https://img.test/2.png" });
  assert.equal(replies[1].status, "complete");
  assert.equal((await app.storage.readSession(app.session.id)).session.lastMessagePreview, "[表情包] 贴贴");
});

test("a sticker-only reply is allowed", async () => {
  const app = await setup();
  const messages = await app.ask("hi", tag('{"sticker":"S01"}'));
  const replies = assistants(messages);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].sticker?.packId, "p1");
});

test("an invented, unauthorized or lowercase-name choice is dropped and the text stays", async () => {
  const app = await setup();
  let messages = await app.ask("one", `Text.\n${tag('{"sticker":"S77"}')}`);
  assert.deepEqual(assistants(messages).map((message) => message.sticker), [undefined]);
  messages = await app.ask("two", `Text 2.\n${tag('{"sticker":"贴贴"}')}`);
  assert.equal(assistants(messages).length, 2);
  assert.ok(assistants(messages).every((message) => !message.sticker));
  const none = await setup(() => emptyStickerDocument());
  await none.ask("x", `Text.\n${tag('{"sticker":"S01"}')}`);
  assert.doesNotMatch(none.prompts[0], /sticker list|S01 =/);
  assert.ok(assistants((await none.storage.readSession(none.session.id)).messages).every((message) => !message.sticker));
});

test("a sticker unbound or removed after it was offered is dropped at save time", async () => {
  let current = doc;
  const app = await setup(() => doc, () => current);
  current = setPackCharacter(doc, "p1", "simulated-character", false); // changes between the offer and the check
  const messages = await app.ask("hi", `Text.\n${tag('{"sticker":"S01"}')}`);
  assert.match(app.prompts[0], /S01 = 丑猫｜贴贴/, "it was offered");
  assert.deepEqual(assistants(messages).map((message) => message.content), ["Text."]);
  assert.ok(assistants(messages).every((message) => !message.sticker));
});

test("stickers are not offered twice in a row, and the tag never reaches the visible reply", async () => {
  const app = await setup();
  await app.ask("one", tag('{"sticker":"S01"}'));
  const messages = await app.ask("two", `Second.\n${tag('{"sticker":"S01"}')}`);
  assert.doesNotMatch(app.prompts[1], /S01 = /);
  const replies = assistants(messages);
  assert.equal(replies.filter((message) => message.sticker).length, 1, "the second request carried no menu, so its code is dropped");
  assert.ok(replies.every((message) => !message.content.includes("veil-action")));
});

test("regenerating a turn that ended in a sticker replaces it instead of keeping the old picture on text", async () => {
  const app = await setup();
  const first = await app.ask("hi", `Hello.\n${tag('{"sticker":"S01"}')}`);
  const firstReply = assistants(first)[0];
  app.setReply("Different text only.");
  await app.engine.regenerateMessage(firstReply.id);
  await flush();
  const replies = assistants((await app.storage.readSession(app.session.id)).messages);
  assert.deepEqual(replies.map((message) => message.content), ["Different text only."]);
  assert.ok(replies.every((message) => !message.sticker));
});

test("backup accepts a sticker on user and assistant messages, and rejects malformed ones", async () => {
  const good = backupData();
  (good.chat.messages[0] as Record<string, unknown>).sticker = userSticker;
  const ok = await packageFixture(good);
  const result = await validateBackupPackage(JSON.stringify(ok.manifest), ok.files);
  assert.deepEqual((result.data.chat.messages[0] as { sticker?: unknown }).sticker, userSticker);
  const plain = await packageFixture(backupData());
  const plainResult = await validateBackupPackage(JSON.stringify(plain.manifest), plain.files);
  assert.equal(Object.hasOwn(plainResult.data.chat.messages[0], "sticker"), false);
  for (const bad of [{}, null, "x", { ...userSticker, url: "javascript:1" }, { ...userSticker, extra: 1 }, { ...userSticker, packId: "" }]) {
    const data = backupData();
    (data.chat.messages[0] as Record<string, unknown>).sticker = bad;
    const fixture = await packageFixture(data);
    await assert.rejects(validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files),
      (error: unknown) => error instanceof BackupValidationError && error.path === "chat.messages[0]", JSON.stringify(bad));
  }
});

import { readFileSync } from "node:fs";
const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
const actions = readFileSync("components/chat/message-actions/message-actions-overlay.tsx", "utf8");
const plus = readFileSync("components/chat/chat-plus-panel.tsx", "utf8");
const image = readFileSync("components/chat/sticker-image.tsx", "utf8");

test("the + button opens the panel: stickers, transfers, and gifts work while remaining placeholders stay disabled", () => {
  assert.match(room, /setPanel\(\(current\) => current === null \? "plus" : null\)/);
  assert.match(room, /<ChatPlusPanel onStickers=/);
  for (const label of ["Photos", "Listen together", "File"]) assert.match(plus, new RegExp(`label: "${label}"`));
  assert.match(plus, /onGift/);
  assert.match(plus, /soon\.map[\s\S]*?disabled>/, "placeholders are disabled and send nothing");
  assert.doesNotMatch(plus, /chatEngine|chatStorage/);
});

test("a sticker message draws only the picture, is saved without a reply request, and cannot be edited or copied as text", () => {
  assert.match(timeline, /message\.sticker && <StickerImage/);
  assert.match(timeline, /message\.sticker \? null : message\.status === "error"/);
  const sendStickerStart = room.indexOf("async function sendSticker(");
  const sendSticker = room.slice(sendStickerStart, room.indexOf("\n  async function reply", sendStickerStart));
  assert.match(sendSticker, /chatEngine\.sendSticker\(/);
  assert.doesNotMatch(sendSticker, /requestReply|beginReply/);
  assert.doesNotMatch(sendSticker, /setPanel\(null\)/, "sending a sticker keeps its picker mounted");
  assert.match(room, /onFocus=\{\(\) => setPanel\(null\)\}/, "focusing the composer switches to the system keyboard");
  assert.match(actions, /label="Edit" icon=\{Pencil\} disabled=\{activeMessage\.role === "system" \|\| isFixedMessage\(activeMessage\)/);
  assert.match(image, /referrerPolicy="no-referrer"/);
});

const css = readFileSync("app/messages/chat.css", "utf8");

test("the panels are the composer's own expansion below the input row, four to a row", () => {
  const form = room.match(/<form\s+key="composer"\s+className="chat-composer chat-input-bar"\s+ref=\{composerBar\}\s+onSubmit[\s\S]*?<\/form>/)![0];
  assert.match(form, /<ChatPlusPanel/);
  assert.match(form, /<StickerPanel/);
  assert.ok(form.indexOf("chat-input-shell") < form.indexOf("<ChatPlusPanel"), "input row first, panel after it");
  assert.doesNotMatch(room.replace(form, ""), /<ChatPlusPanel|<StickerPanel/);
  const tray = css.match(/\.chat-tray \{[^}]*\}/)![0];
  assert.doesNotMatch(tray, /position:\s*absolute/);
  assert.match(css, /\.chat-plus-panel \{[^}]*repeat\(4, 1fr\)/);
});

test("a reaction is only its emoji: no circle, fill, border or shadow", () => {
  const badge = css.match(/\.chat-reaction-badge \{[^}]*\}/)![0];
  assert.doesNotMatch(badge, /(?<![-\w])(?:background|border|box-shadow|width|height)/);
  assert.match(css.match(/\.chat-reaction-stack \{[^}]*\}/)![0], /position:\s*absolute/);
});

test("opening a panel recomputes the chat area: the history follows the composer's new height when it was at the latest message", () => {
  const observer = room.match(/let previous = bar\.offsetHeight;[\s\S]*?observer\.observe\(bar\)/)![0];
  assert.match(observer, /panelOpen\.current && atBottom && height !== previous/);
  assert.match(observer, /list\.scrollTo\(\{ top: list\.scrollHeight \}\)/);
  assert.match(observer, /--chat-composer-height/);
  assert.match(css, /\.chat-composer:has\(\.chat-tray\) \{[^}]*backdrop-filter: blur\(26px\)/);
  assert.match(css.match(/\.chat-bubble-shell-has-reactions \{[^}]*\}/)![0], /padding-top:\s*10px/);
});

test("stickers cannot be tapped while a reply is generating (outside Life Mode) or a message is being saved", () => {
  assert.match(room, /<StickerPanel disabled=\{\(generationActive && session\?\.lifeMode !== true\) \|\| sending \|\| !!loadError\}/);
  assert.match(readFileSync("components/chat/sticker-panel.tsx", "utf8"), /disabled=\{disabled\} onClick/);
});
