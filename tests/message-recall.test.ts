import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { searchConversationMessages } from "../lib/chat/search";
import { historyEligible } from "../lib/chat/summary";
import { assembleChatPrompt, emptyMemorySlot } from "../lib/chat/prompt";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { splitActions } from "../lib/presence/actions";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";

test("recall clears message text, replaces quoted previews and excludes it from search, summary and prompt", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("recall");
  const target = await storage.send(session.id, "private sentence");
  const reply = await storage.send(session.id, "response", target.id);
  const recalled = await storage.recallMessage(target.id, "user");
  assert.deepEqual(recalled.recalled?.by, "user");
  assert.equal(recalled.content, "");
  const { messages } = await storage.readSession(session.id);
  assert.equal(messages.find((message) => message.id === reply.id)?.quote?.preview, "This message has been recalled.");
  assert.deepEqual(await searchConversationMessages(messages, session.id, "private sentence"), []);
  assert.equal(historyEligible(messages).some((message) => message.id === target.id), false);
  const foundation = defaultFoundation();
  foundation.runtime.timeAware = false;
  const character = { characterId: "recall", ...normalizeCharacterInput({ name: "Recall" }) };
  foundation.characters = [character];
  const prompt = assembleChatPrompt(foundation, character, messages, [], emptyMemorySlot());
  assert.doesNotMatch(prompt.messages.map((message) => message.content).join("\n"), /private sentence/);
  assert.match(prompt.messages.map((message) => message.content).join("\n"), /\[User recalled a message\]/);
  assert.match(prompt.messages.map((message) => message.content).join("\n"), /This message has been recalled\./);
});

test("recall is sender-only and Character Action can target any eligible own message by ID", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("recall");
  const user = await storage.send(session.id, "user line");
  const firstReply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "first reply"))[0];
  await storage.send(session.id, "second user line");
  const secondReply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "second reply"))[0];
  await assert.rejects(storage.recallMessage(user.id, "assistant"), /own message sent/);
  await assert.rejects(storage.recallMessage(firstReply.id, "user"), /own message sent/);
  assert.equal(await storage.recallAssistantMessageForReply(secondReply.id, firstReply.id), true);
  const recalled = (await storage.readSession(session.id)).messages.find((message) => message.id === firstReply.id);
  assert.equal(recalled?.recalled?.by, "assistant");
  assert.equal((await storage.readSession(session.id)).messages.find((message) => message.id === user.id)?.content, "user line");
  assert.deepEqual(splitActions('<veil-action>{"recallMessageId":"message-12345678"}</veil-action>').actions, { recallMessageId: "message-12345678" });
});

test("Character recall rejects failed or incomplete targets but accepts any completed own target", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("recall-status");
  await storage.send(session.id, "Question");
  const first = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "Completed reply"))[0];
  await storage.send(session.id, "Follow-up");
  const failedId = (await storage.beginReply(session.id))!.assistant.id;
  await storage.updateReply(failedId, { content: "Failed reply", status: "error", error: "provider failed" });
  await storage.send(session.id, "Another follow-up");
  const current = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "Current reply"))[0];
  await assert.rejects(storage.recallAssistantMessageForReply(current.id, failedId), /own message sent/);
  await storage.recallAssistantMessageForReply(current.id, first.id);
  const recalled = (await storage.readSession(session.id)).messages.find((message) => message.id === first.id);
  assert.equal(recalled?.recalled?.by, "assistant");
  assert.equal((await storage.readSession(session.id)).messages.find((message) => message.id === failedId)?.content, "Failed reply");
});

test("ChatRoom exposes recall only through the extracted message action overlay", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const actions = readFileSync("components/chat/message-actions/use-message-actions.ts", "utf8");
  const overlay = readFileSync("components/chat/message-actions/message-actions-overlay.tsx", "utf8");
  assert.match(room, /useMessageActions/);
  assert.match(actions, /chatStorage\.recallMessage\(message\.id, "user", undefined, session\?\.id\)/);
  assert.match(actions, /chatStorage\.setReaction\(/);
  assert.match(actions, /chatStorage\.deleteMessages\(/);
  assert.match(actions, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(room, /chatStorage\.(?:recallMessage|setReaction|deleteMessages)\(/);
  assert.doesNotMatch(room, /navigator\.clipboard\.writeText/);
  assert.match(overlay, /canRecallMessage\(activeMessage, "user", recallNow\)/);
});

test("backup preserves a recalled message after its body has been cleared", async () => {
  const data = backupData();
  data.chat.messages[0] = { ...data.chat.messages[0], content: "", recalled: { at: 10, by: "user" } };
  const fixture = await packageFixture(data);
  const result = await validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  assert.equal(result.data.chat.messages[0].recalled?.by, "user");
});
