import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { sortChatSessions } from "../lib/chat/session-order";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createTransientFeedback, hasPendingUserContent, KeyboardCloseDetector, sendThenRequestReply,
  shouldRequestAutoReply, visibleReplyText } from "../lib/chat/usability";

test("toast dismisses after 1.8s, repeats restart and cleanup prevents stale updates", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let value = "";
  const feedback = createTransientFeedback((text) => { value = text; });
  feedback.show("Conversation cleared");
  context.mock.timers.tick(1700);
  assert.equal(value, "Conversation cleared");
  feedback.show("Conversation cleared");
  context.mock.timers.tick(100);
  assert.equal(value, "Conversation cleared");
  context.mock.timers.tick(1700);
  assert.equal(value, "");
  feedback.show("Copied");
  feedback.cancel();
  context.mock.timers.tick(1800);
  assert.equal(value, "Copied");
});

test("session toggles default OFF and persist independently", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const a = await storage.openSession("a"), b = await storage.openSession("b");
  assert.equal(a.streamOnline, false);
  assert.equal(a.autoReplyOnKeyboardDismiss, false);
  await storage.updateSessionSettings(a.id, { streamOnline: true, autoReplyOnKeyboardDismiss: true });
  const saved = await new ChatStorage(() => factory).readSession(a.id);
  assert.equal(saved.session.streamOnline, true);
  assert.equal(saved.session.autoReplyOnKeyboardDismiss, true);
  assert.equal((await storage.readSession(b.id)).session.streamOnline, false);
});

test("conversation pin persists and sorts ahead of newer unpinned conversations", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const olderPinned = await storage.openSession("pinned");
  const newest = await storage.openSession("newest");
  const older = await storage.openSession("older");
  await storage.updateSessionSettings(olderPinned.id, { pinned: true });
  const reloaded = new ChatStorage(() => factory);
  const pinnedSession = (await reloaded.readSession(olderPinned.id)).session;
  assert.equal(pinnedSession.pinned, true);
  assert.deepEqual(sortChatSessions([
    { ...older, updatedAt: 20 },
    { ...pinnedSession, updatedAt: 10 },
    { ...newest, updatedAt: 30 },
  ]).map((session) => session.id), [olderPinned.id, newest.id, older.id]);
});

test("direct reply awaits persisted Send and generates once with the new message in history", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  let calls = 0;
  const engine = createChatEngine(storage, async () => foundation, async function* (_config, prompt) {
    calls++;
    assert.equal(prompt.filter((turn) => turn.content === "new draft").length, 1);
    yield "one\n\ntwo";
  });
  await sendThenRequestReply("new draft", (text) => engine.send(session.id, text), () => engine.requestReply(session.id));
  assert.equal(calls, 1);
  assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["new draft", "one", "two"]);
  await sendThenRequestReply("", (text) => engine.send(session.id, text), () => engine.requestReply(session.id));
  assert.equal(calls, 1);
});

test("failed direct Send never starts generation", async () => {
  let requests = 0;
  await assert.rejects(() => sendThenRequestReply("draft", async () => { throw new Error("save failed"); },
    async () => { requests++; }));
  assert.equal(requests, 0);
});

test("streaming visibility changes only preview, not completed, stopped or failed text", () => {
  const message = { id: "a", sessionId: "a", role: "assistant" as const, status: "streaming" as const,
    content: "one\n\ntwo", order: 1, createdAt: 0 };
  assert.equal(visibleReplyText(message, false), "");
  assert.equal(visibleReplyText(message, true), message.content);
  for (const status of ["complete", "cancelled", "error"] as const)
    assert.equal(visibleReplyText({ ...message, status }, false), message.content);
});

test("keyboard detector requires focused real opening, fires once and ignores toolbar/width changes", () => {
  const detector = new KeyboardCloseDetector(390, 844);
  assert.equal(detector.measure(390, 820, 24, false), false);
  assert.equal(detector.measure(390, 844, 0, false), false);
  assert.equal(detector.measure(390, 500, 344, true), false);
  assert.equal(detector.measure(390, 844, 0, false), true);
  assert.equal(detector.measure(390, 844, 0, false), false);
  detector.measure(390, 500, 344, true);
  assert.equal(detector.measure(844, 390, 0, false), false);
  assert.equal(detector.measure(844, 600, 0, false), false);
  detector.reset(390, 844);
  assert.equal(detector.measure(390, 844, 0, false), false);
});

test("keyboard auto reply requires one real close, the setting and an unclaimed pending User message", () => {
  const detector = new KeyboardCloseDetector(390, 844);
  const pending = { id: "pending", sessionId: "s", role: "user" as const, status: "sent" as const,
    content: "hello", createdAt: 1, order: 1 };
  assert.equal(detector.measure(390, 500, 344, true), false);
  const closed = detector.measure(390, 844, 0, false);
  assert.equal(shouldRequestAutoReply(closed, true, [pending]), true);
  assert.equal(shouldRequestAutoReply(detector.measure(390, 844, 0, false), true, [pending]), false);
  assert.equal(shouldRequestAutoReply(true, false, [pending]), false);
  assert.equal(hasPendingUserContent([{ ...pending, requestedBy: "reply" }]), false);
  assert.equal(shouldRequestAutoReply(true, true, [{ ...pending, requestedBy: "reply" }]), false);
  assert.equal(shouldRequestAutoReply(true, true, []), false);
});
