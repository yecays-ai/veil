import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage, CHAT_DATABASE_NAME } from "../lib/chat/storage";
import type { ChatMessage } from "../lib/chat/types";
import { canRecallMessage, MESSAGE_RECALL_WINDOW_MS } from "../lib/chat/recall";
import { resolvePresetMarker, type PromptRuntimeContext } from "../lib/chat/prompt";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { selfState } from "../lib/chat/self-context";
import type { TextProvider } from "../lib/chat/provider";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";

const tag = (json: string) => `<veil-action>${json}</veil-action>`;

test("recall eligibility is sender-specific and includes exactly the 120-second boundary", () => {
  const message: ChatMessage = { id: "message-0001", sessionId: "session-0001", role: "user", content: "secret",
    status: "sent", createdAt: 10_000, sentAt: 10_000, order: 1 };
  assert.equal(MESSAGE_RECALL_WINDOW_MS, 120_000);
  assert.equal(canRecallMessage(message, "user", 130_000), true);
  assert.equal(canRecallMessage(message, "user", 130_001), false);
  assert.equal(canRecallMessage(message, "assistant", 130_000), false);
  assert.equal(canRecallMessage({ ...message, sentAt: 130_001 }, "user", 130_000), false);
  const legacy = { ...message }; delete legacy.sentAt;
  assert.equal(canRecallMessage(legacy, "user", 130_000), false, "legacy rows have no trustworthy send time");
  assert.equal(canRecallMessage({ ...message, status: "streaming" }, "user", 130_000), false);
  assert.equal(canRecallMessage({ ...message, recalled: { at: 20_000, by: "user" } }, "user", 130_000), false);
});

async function setSentAt(factory: IDBFactory, id: string, sentAt: number) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(CHAT_DATABASE_NAME);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite"), table = tx.objectStore("messages");
    const read = table.get(id);
    read.onsuccess = () => { if (read.result) table.put({ ...read.result, sentAt }); };
    read.onerror = () => reject(read.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

test("storage rejects a stale Recall and clears the body for a fresh sent message", async () => {
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory);
  const session = await storage.openSession("peter");
  const stale = await storage.send(session.id, "too old");
  await setSentAt(factory, stale.id, Date.now() - MESSAGE_RECALL_WINDOW_MS - 1);
  await assert.rejects(storage.recallMessage(stale.id, "user"), /2 minutes/);
  assert.equal((await storage.readSession(session.id)).messages.find((message) => message.id === stale.id)?.content, "too old");

  const fresh = await storage.send(session.id, "withdraw this");
  await storage.setFavorite(fresh.id, true);
  const recalled = await storage.recallMessage(fresh.id, "user", undefined, session.id);
  assert.equal(recalled.content, "");
  assert.equal(recalled.recalled?.by, "user");
  assert.equal(recalled.favorite, undefined, "recalled messages do not retain a Favorite marker");
  assert.equal(recalled.sentAt, fresh.sentAt);
});

test("Character Action can target an older own bubble by ID, not only the immediately previous reply", async () => {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("peter");
  await storage.send(session.id, "first request");
  const firstBatch = await storage.beginReply(session.id);
  assert(firstBatch);
  const [older] = await storage.finalizeReply(firstBatch.assistant.id, "older Character message");
  await storage.send(session.id, "second request");
  const secondBatch = await storage.beginReply(session.id);
  assert(secondBatch);
  const [latest] = await storage.finalizeReply(secondBatch.assistant.id, "latest Character message");

  assert.equal(await storage.recallAssistantMessageForReply(latest.id, older.id), true);
  const messages = (await storage.readSession(session.id)).messages;
  assert.equal(messages.find((message) => message.id === older.id)?.content, "");
  assert.equal(messages.find((message) => message.id === latest.id)?.content, "latest Character message");
});

test("the model receives recall events without the recalled body", () => {
  const context = { currentMessages: [
    { id: "user-event", sessionId: "s", role: "user", content: "must not leak", status: "sent", createdAt: 1, order: 1, recalled: { at: 2, by: "user" } },
    { id: "assistant-event", sessionId: "s", role: "assistant", content: "also private", status: "complete", createdAt: 3, order: 2, recalled: { at: 4, by: "assistant" } },
  ], pending: [], summary: undefined } as unknown as PromptRuntimeContext;
  const turns = resolvePresetMarker("history", context) as { role: string; content: string }[];
  assert.deepEqual(turns.map((turn) => turn.content), ["[User recalled a message]", "[Character recalled a message]"]);
  assert.deepEqual(turns.map((turn) => turn.role), ["user", "assistant"]);
  assert.doesNotMatch(turns.map((turn) => turn.content).join("\n"), /must not leak|also private/);
});

test("a Character's just-recalled text survives one next request in memory, then disappears from runtime state", async () => {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("peter");
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  const character = { characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) };
  foundation.characters = [character];
  const prompts: string[] = [];
  let call = 0, targetId = "";
  const provider: TextProvider = async function* (_config, messages) {
    call++;
    prompts.push(messages.map((message) => message.content).join("\n"));
    if (call === 2) yield `Let me take that back.\n${tag(JSON.stringify({ recallMessageId: targetId }))}`;
    else yield call === 1 ? "A line I may withdraw." : "All right.";
  };
  const self: Parameters<typeof createChatEngine>[11] = async (current, now, reply) => selfState(current, undefined, undefined, now, reply.lastReplyAt,
    reply.announceChange, reply.allowActions, reply.reactions);
  const apply: Parameters<typeof createChatEngine>[12] = async (_characterId, actions, _now, replyId) => {
    if (!actions.recallMessageId) return;
    targetId = actions.recallMessageId;
    await storage.recallAssistantMessageForReply(replyId, targetId);
    return { recalledMessageId: targetId };
  };
  const engine = createChatEngine(storage, async () => foundation, provider, undefined, () => new Date(), undefined,
    undefined, undefined, undefined, undefined, async () => {}, self, apply);

  await storage.send(session.id, "first");
  await engine.requestReply(session.id);
  const original = (await storage.readSession(session.id)).messages.find((message) => message.role === "assistant")!;
  targetId = original.id;
  await storage.send(session.id, "second");
  await engine.requestReply(session.id);
  assert.match(prompts[1], new RegExp(original.id));
  assert.match(prompts[1], /A line I may withdraw\./);
  assert.equal((await storage.readSession(session.id)).messages.find((message) => message.id === original.id)?.content, "");

  await storage.send(session.id, "third");
  await engine.requestReply(session.id);
  assert.match(prompts[2], /\[Character recalled a message\]/);
  assert.match(prompts[2], /You withdrew this message yourself[\s\S]*It is no longer visible to the user/);
  assert.match(prompts[2], /A line I may withdraw\./);

  await storage.send(session.id, "fourth");
  await engine.requestReply(session.id);
  assert.match(prompts[3], /\[Character recalled a message\]/);
  assert.doesNotMatch(prompts[3], /You withdrew this message yourself|A line I may withdraw\./);
});

test("backup validation preserves an optional sentAt timestamp without requiring it on legacy rows", async () => {
  const data = backupData();
  data.chat.messages[0].sentAt = data.chat.messages[0].createdAt;
  const fixture = await packageFixture(data);
  const restored = await validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  assert.equal(restored.data.chat.messages[0].sentAt, data.chat.messages[0].sentAt);
  const legacy = backupData();
  const oldFixture = await packageFixture(legacy);
  assert.equal((await validateBackupPackage(JSON.stringify(oldFixture.manifest), oldFixture.files)).data.chat.messages[0].sentAt, undefined);
});
