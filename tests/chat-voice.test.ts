import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { selfState } from "../lib/chat/self-context";
import { splitActions, VOICE_TEXT_MAX } from "../lib/presence/actions";
import { listPreview } from "../lib/chat/message-kind";
import { validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError } from "../lib/backup/format";
import { createChatEngine } from "./chat-engine-fixture";
import { backupData, packageFixture } from "./backup-fixture";
import type { TextProvider } from "../lib/chat/provider";
import type { ChatMessage } from "../lib/chat/types";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const NOW = 1_700_000_000_000;
const tag = (json: string) => `<veil-action>${json}</veil-action>`;

async function setup(available = true) {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("simulated-character");
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  foundation.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated" }) }];
  const prompts: string[] = [];
  let reply = "Plain reply.";
  const provider: TextProvider = async function* (_config, messages) { prompts.push(messages.map((message) => message.content).join("\n")); yield reply; };
  const engine = createChatEngine(storage, async () => foundation, provider, undefined, () => new Date(NOW),
    undefined, undefined, undefined, undefined, undefined, async () => {},
    async (character, now, state) => selfState(character, undefined, undefined, now, state.lastReplyAt, state.announceChange, state.allowActions, state.reactions),
    async () => {}, undefined, undefined, undefined, async () => available);
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

test("the voice field is read from the action line, trimmed, and dropped when empty or too long", () => {
  assert.equal(splitActions(`Hi.\n${tag('{"voice":"  早安  "}')}`).actions?.voice, "早安");
  assert.equal(splitActions(tag('{"voice":"   "}')).actions?.voice, undefined);
  assert.equal(splitActions(tag(JSON.stringify({ voice: "a".repeat(VOICE_TEXT_MAX + 1) }))).actions?.voice, undefined);
  assert.equal(splitActions(tag(JSON.stringify({ voice: "a".repeat(VOICE_TEXT_MAX) }))).actions?.voice?.length, VOICE_TEXT_MAX);
  assert.equal(splitActions(tag('{"voice":3}')).actions?.voice, undefined);
});

test("the Character is told it may speak only when speech is set up", async () => {
  const on = await setup(true), off = await setup(false);
  await on.ask("hi", "Hello.");
  await off.ask("hi", "Hello.");
  assert.match(on.prompts[0], /voice message/);
  assert.match(on.prompts[0], /"voice": exactly what you say aloud/);
  assert.doesNotMatch(off.prompts[0], /voice message|"voice"/);
});

test("a reply with text and a voice gets a text bubble and then a voice bubble whose content is the words", async () => {
  const app = await setup();
  const messages = await app.ask("hi", `Hello there.\n${tag('{"voice":"早安，今天也要加油。"}')}`);
  const replies = assistants(messages);
  assert.deepEqual(replies.map((message) => [message.content, message.voice]), [["Hello there.", undefined], ["早安，今天也要加油。", true]]);
  assert.equal(replies[1].status, "complete");
  assert.equal(listPreview(replies[1]), "[语音] 早安，今天也要加油。");
  assert.equal((await app.storage.readSession(app.session.id)).session.lastMessagePreview, "[语音] 早安，今天也要加油。");
  assert.ok(replies.every((message) => !message.content.includes("veil-action")));
});

test("a voice-only reply is allowed", async () => {
  const app = await setup();
  const replies = assistants(await app.ask("hi", tag('{"voice":"嗯，我在。"}')));
  assert.deepEqual(replies.map((message) => [message.content, message.voice]), [["嗯，我在。", true]]);
});

test("a voice is dropped when speech is not set up or the words are too long, and the text stays", async () => {
  const off = await setup(false);
  assert.deepEqual(assistants(await off.ask("hi", `Text.\n${tag('{"voice":"x"}')}`)).map((message) => message.voice), [undefined]);
  const app = await setup();
  const replies = assistants(await app.ask("hi", `Text.\n${tag(JSON.stringify({ voice: "x".repeat(VOICE_TEXT_MAX + 1) }))}`));
  assert.deepEqual(replies.map((message) => [message.content, message.voice]), [["Text.", undefined]]);
});

test("a voice is not offered twice in a row", async () => {
  const app = await setup();
  await app.ask("one", `A.\n${tag('{"voice":"first"}')}`);
  const messages = await app.ask("two", `B.\n${tag('{"voice":"second"}')}`);
  assert.doesNotMatch(app.prompts[1], /"voice": exactly/);
  assert.equal(assistants(messages).filter((message) => message.voice).length, 1);
});

test("the words of a voice bubble can be edited; recalling it keeps nothing of the voice", async () => {
  const app = await setup();
  const voice = assistants(await app.ask("hi", tag('{"voice":"old words"}')))[0];
  const edited = await app.storage.editMessage(voice.id, "new words");
  assert.deepEqual([edited.content, edited.voice], ["new words", true]);
  const recalled = await app.storage.recallMessage(voice.id, "assistant");
  assert.deepEqual([recalled.content, recalled.voice], ["", undefined]);
});

test("regenerating a turn that ended in a voice replaces it instead of keeping the voice on new text", async () => {
  const app = await setup();
  const first = assistants(await app.ask("hi", `Hello.\n${tag('{"voice":"spoken"}')}`));
  app.setReply("Different text only.");
  await app.engine.regenerateMessage(first[0].id);
  await flush();
  const replies = assistants((await app.storage.readSession(app.session.id)).messages);
  assert.deepEqual(replies.map((message) => message.content), ["Different text only."]);
  assert.ok(replies.every((message) => !message.voice));
});

test("backup accepts a voice flag only on a plain assistant message", async () => {
  const withFlag = async (change: (message: Record<string, unknown>) => void) => {
    const data = backupData();
    const target = data.chat.messages.find((message) => message.role === "assistant") as unknown as Record<string, unknown>;
    target.voice = true; change(target);
    const fixture = await packageFixture(data);
    return validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  };
  const result = await withFlag(() => {});
  assert.equal(result.data.chat.messages.find((message) => message.voice)?.role, "assistant");
  const refuses = (change: (message: Record<string, unknown>) => void) => assert.rejects(withFlag(change), (error) => error instanceof BackupValidationError);
  await refuses((message) => { message.role = "user"; });
  await assert.rejects(withFlag((message) => { message.content = ""; message.recalled = { at: 1, by: "assistant" }; }),
    (error) => error instanceof BackupValidationError && error.detail === "voice-invalid", "a recalled message keeps no voice");
  await assert.rejects(withFlag((message) => { message.voice = "yes"; }));
});
