import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { parseQuotedReply, quoteMessage } from "../lib/chat/quote";
import { assembleChatPrompt, emptyMemorySlot } from "../lib/chat/prompt";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

test("quote targets one split bubble and survives reload, editing and target deletion", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const session = await storage.openSession("a");
  const first = await storage.send(session.id, "start");
  const batch = await storage.beginReply(session.id);
  const parts = await storage.finalizeReply(batch!.assistant.id, "A\n\nB\n\nC");
  const reply = await storage.send(session.id, "reply to B", parts[1].id);
  assert.deepEqual(reply.quote, { messageId: parts[1].id, preview: "B", role: "assistant" });
  await storage.editMessage(reply.id, "edited reply");
  await storage.deleteMessages(session.id, [parts[1].id]);
  const saved = await new ChatStorage(() => factory).readSession(session.id);
  assert.deepEqual(saved.messages.at(-1)?.quote, reply.quote);
  const other = await storage.openSession("b");
  await assert.rejects(storage.send(other.id, "wrong session", first.id), /not found/);
  const plain = await storage.send(session.id, "no quote");
  assert.equal(plain.quote, undefined);
});

test("pending and Recent History both carry quote context once", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  const target = await storage.send(session.id, "specific line");
  const reply = await storage.send(session.id, "answer", target.id);
  const foundation = defaultFoundation();
  foundation.runtime.timeAware = false;
  const character = { characterId: "a", ...normalizeCharacterInput({ name: "A" }) };
  foundation.characters = [character];
  const messages = (await storage.readSession(session.id)).messages;
  for (const pending of [[], [reply]]) {
    const prompt = assembleChatPrompt(foundation, character, messages, pending, emptyMemorySlot());
    const quoted = prompt.messages.filter((turn) => turn.content.includes("[Reply to user message"));
    assert.equal(quoted.length, 1);
    assert.match(quoted[0].content, /specific line/);
    assert.match(quoted[0].content, /\nanswer$/);
  }
});

test("legacy assistant quote protocol parses text without rich media or rewriting ordinary text", () => {
  assert.deepEqual(parseQuotedReply("[引用:preview]正文"), { preview: "preview", content: "正文" });
  assert.deepEqual(parseQuotedReply("[引用： preview ]\nreply"), { preview: "preview", content: "reply" });
  assert.deepEqual(parseQuotedReply("ordinary text"), { preview: null, content: "ordinary text" });
  assert.equal(quoteMessage({ id: "b", sessionId: "s", role: "assistant", content: "[引用:A]B",
    createdAt: 1, order: 1, status: "complete" }).preview, "B");
});

test("core Quote opens cancellable Composer preview and bubble renders quote above body", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
  const bubble = readFileSync("components/chat/quote-bubble.tsx", "utf8");
  assert.match(room, /setQuotingMessage\(activeMessage\); closeActions\(\)/);
  assert.match(room, /quotingMessage && <div className="chat-quote-bar"/);
  assert.match(room, /aria-label="Cancel Quote" onClick=\{\(\) => setQuotingMessage\(null\)\}/);
  assert.match(room, /chatEngine\.send\(sessionId, content, quote\?\.id, \{ interject, discardUnrevealed: unrevealed \}\)/);
  assert.match(timeline, /applyRegex\(parsed\.content, regexGroups[\s\S]*<QuoteBubble preview=\{quotePreview\}[\s\S]*: bodyText/);
  assert.match(bubble, /className="chat-quote-preview"/);
  assert.match(bubble, /<span>\{preview\}<\/span>/);
});
