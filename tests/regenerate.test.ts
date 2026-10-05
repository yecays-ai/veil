import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import type { ChatMessage } from "../lib/chat/types";

async function setup() {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const messages: ChatMessage[] = ["User 1", "Assistant A", "target B", "future C", "future User 2", "future D"]
    .map((content, index) => ({ id: String(index), sessionId: "s", content, order: index + 1,
      createdAt: index + 1, role: index === 0 || index === 4 ? "user" : "assistant",
      status: index === 0 || index === 4 ? "sent" : "complete" }));
  messages[2].quote = { messageId: "0", preview: "User 1", role: "user" };
  await storage.importBackup({ version: 1, messages, sessions: [{ id: "s", characterId: "a",
    updatedAt: 6, nextOrder: 7, remark: null, autoReplyOnKeyboardDismiss: false,
    lastMessageId: "5", lastMessagePreview: "future D" }] });
  await storage.saveApiConfig({ id: "chat-default", baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  const document = defaultFoundation();
  document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { factory, storage, document, messages };
}

test("regenerate B replaces only its content, preserves future timeline and Quote, and uses past-only prompt", async () => {
  const { factory, storage, document } = await setup();
  const before = await storage.readSession("s");
  let calls = 0;
  const engine = createChatEngine(storage, async () => document, async function* (_config, prompt) {
    calls++;
    const text = prompt.map((turn) => turn.content).join("\n");
    assert.match(text, /User 1/);
    assert.match(text, /Assistant A/);
    assert.doesNotMatch(text, /target B|future C|future User 2|future D/);
    assert.match(text, /Return exactly one replacement message/);
    yield "replacement\n\nmore text";
  });
  await engine.regenerateMessage("2");
  const after = await new ChatStorage(() => factory).readSession("s");
  assert.equal(calls, 1);
  assert.deepEqual(after.session, before.session);
  assert.deepEqual(after.messages, before.messages.map((message) => message.id === "2"
    ? { ...message, content: "replacement\n\nmore text" } : message));
});

test("regenerate last message updates only its preview and never nextOrder or identity", async () => {
  const { storage, document } = await setup();
  const before = await storage.readSession("s");
  const engine = createChatEngine(storage, async () => document, async function* () { yield "new final"; });
  await engine.regenerateMessage("5");
  const after = await storage.readSession("s");
  assert.deepEqual(after.session, { ...before.session, lastMessagePreview: "new final" });
  assert.deepEqual(after.messages[5], { ...before.messages[5], content: "new final" });
});

test("provider error, empty sanitized output, Stop and storage failure leave the original timeline intact", async () => {
  for (const mode of ["error", "empty", "stop", "storage"] as const) {
    const { storage, document } = await setup();
    const before = await storage.readSession("s");
    const engine = createChatEngine(storage, async () => document, async function* () {
      yield mode === "empty" ? "[2026-10-05 13:26 Asia/Shanghai]" : "partial";
      if (mode === "error") throw new Error("provider failed");
      if (mode === "stop") engine.stop("s");
    });
    if (mode === "storage") storage.replaceRegeneratedMessage = async () => { throw new Error("storage failed"); };
    await assert.rejects(engine.regenerateMessage("2"));
    assert.deepEqual(await storage.readSession("s"), before);
    assert.equal(engine.isGenerating("s"), false);
  }
});

test("regeneration streaming and final replacement share the timestamp sanitizer without persisted previews", async () => {
  const { storage, document } = await setup();
  const previews: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* () {
    for (const chunk of ["[2026-10-", "05 13:26 Asia/", "Shanghai]\nHello"]) {
      yield chunk;
      assert.equal((await storage.readSession("s")).messages[2].content, "target B");
    }
  });
  const result = await engine.regenerateMessage("2", (text) => previews.push(text));
  assert.deepEqual(previews, ["", "", "Hello"]);
  assert.equal(result.content, "Hello");
});

test("ineligible roles/statuses are rejected before provider calls", async () => {
  const { storage, document, messages } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(engine.regenerateMessage("0"), /completed Assistant/);
  for (const [role, status] of [["assistant", "streaming"], ["assistant", "error"],
    ["assistant", "cancelled"], ["system", "complete"]] as const) {
    const fresh = new ChatStorage(() => new IDBFactory());
    const exported = await storage.exportBackup();
    exported.messages = messages.map((message) => message.id === "2" ? { ...message, role, status } : message);
    await fresh.importBackup(exported);
    const candidate = createChatEngine(fresh, async () => document, async function* () { assert.fail("must not generate"); });
    await assert.rejects(candidate.regenerateMessage("2"), /completed Assistant/);
  }
});

test("regenerate and normal reply cannot run concurrently in the same engine", async () => {
  const { storage, document } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const engine = createChatEngine(storage, async () => document, async function* () {
    started(); await gate; yield "replacement";
  });
  const first = engine.regenerateMessage("2");
  await ready;
  await assert.rejects(engine.regenerateMessage("3"), /already in progress/);
  assert.equal(await engine.requestReply("s"), null);
  release(); await first;
  const reply = engine.requestReply("s");
  // requestReply reserves its session synchronously, before storage hydration.
  await assert.rejects(engine.regenerateMessage("2"), /in progress/);
  await reply;
});

test("concurrent edits fail CAS instead of being overwritten", async () => {
  const { storage, document } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () {
    await storage.editMessage("2", "edited elsewhere"); yield "replacement";
  });
  await assert.rejects(engine.regenerateMessage("2"), /changed/);
  assert.equal((await storage.readSession("s")).messages[2].content, "edited elsewhere");
});

test("Stop at the final storage boundary aborts replacement and keeps the original", async () => {
  const { storage, document } = await setup();
  const before = await storage.readSession("s");
  const engine = createChatEngine(storage, async () => document, async function* () { yield "replacement"; });
  const replace = storage.replaceRegeneratedMessage.bind(storage);
  storage.replaceRegeneratedMessage = (original, content, signal) => {
    engine.stop("s");
    return replace(original, content, signal);
  };
  await assert.rejects(engine.regenerateMessage("2"));
  assert.deepEqual(await storage.readSession("s"), before);
});

test("UI session reservation makes immediate Stop work before target hydration", async () => {
  const { storage, document } = await setup();
  const before = await storage.readSession("s");
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  const request = engine.regenerateMessage("2", undefined, "s");
  engine.stop("s");
  await assert.rejects(request);
  assert.deepEqual(await storage.readSession("s"), before);
  assert.equal(engine.isGenerating("s"), false);
});
