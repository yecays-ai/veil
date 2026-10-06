import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
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
  const document = defaultFoundation();
  document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { factory, storage, document, messages };
}


test("regenerate truncates target and all future including users, then splits a normal reply", async () => {
  const { factory, storage, document } = await setup();
  let calls = 0;
  let finalized: readonly ChatMessage[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_config, prompt) {
    calls++;
    const text = prompt.map((turn) => turn.content).join("\n");
    assert.match(text, /User 1/);
    assert.match(text, /Assistant A/);
    assert.doesNotMatch(text, /target B|future C|future User 2|future D|replacement message|regenerating one/);
    const during = await storage.readSession("s");
    assert.deepEqual(during.messages.map((m) => m.content), ["User 1", "Assistant A", ""]);
    assert.equal(during.messages[2].status, "streaming");
    yield "B'\n\nC'\n\nD'";
  });
  await engine.regenerateMessage("2", (messages) => { finalized = messages; });
  const after = await new ChatStorage(() => factory).readSession("s");
  assert.equal(calls, 1);
  assert.deepEqual(after.messages.map((m) => m.content), ["User 1", "Assistant A", "B'", "C'", "D'"]);
  assert.deepEqual(after.messages.map((m) => m.order), [1, 2, 3, 4, 5]);
  assert.equal(finalized.length, 3);
  assert.equal(new Set(after.messages.map((m) => m.id)).size, 5);
  assert.ok(after.messages.slice(2).every((m) => !["2", "3", "4", "5"].includes(m.id)));
  assert.equal(after.session.nextOrder, 6);
  assert.equal(after.session.lastMessageId, after.messages[4].id);
  assert.equal(after.session.lastMessagePreview, "D'");
  assert.ok(after.session.updatedAt > 6);
});

test("regeneration needs no pending user and new bubble count is independent", async () => {
  const { storage, document } = await setup();
  const backup = await storage.exportBackup();
  backup.messages[0].requestedBy = "1";
  await storage.replaceBackup(await storage.exportBackup(), backup);
  const engine = createChatEngine(storage, async () => document, async function* () { yield "one"; });
  await engine.regenerateMessage("2");
  const after = await storage.readSession("s");
  assert.deepEqual(after.messages.map((m) => m.content), ["User 1", "Assistant A", "one"]);
  assert.equal(after.messages[0].requestedBy, "1");
  assert.equal(await engine.requestReply("s"), null);
  assert.equal(after.session.nextOrder, 4);
});

test("atomic truncation repairs retained user requestedBy when its reply is deleted", async () => {
  const { storage } = await setup();
  const backup = await storage.exportBackup();
  backup.messages[0].requestedBy = "2";
  await storage.replaceBackup(await storage.exportBackup(), backup);
  const batch = await storage.beginReply("s", "2");
  assert.ok(batch);
  assert.deepEqual(batch.pending, []);
  const after = await storage.readSession("s");
  assert.equal(after.messages[0].requestedBy, batch.assistant.id);
  assert.equal(after.session.lastMessageId, batch.assistant.id);
  assert.equal(after.session.nextOrder, 4);
});

test("provider failure, empty output and Stop never restore the truncated future", async () => {
  for (const mode of ["error", "empty", "stop"] as const) {
    const { storage, document } = await setup();
    const engine = createChatEngine(storage, async () => document, async function* () {
      yield mode === "empty" ? "[2026-10-05 13:26 Asia/Shanghai]" : "partial";
      if (mode === "error") throw new Error("provider failed");
      if (mode === "stop") engine.stop("s");
    });
    const result = await engine.regenerateMessage("2");
    assert.equal(result?.status, mode === "stop" ? "cancelled" : "error");
    const after = await storage.readSession("s");
    assert.deepEqual(after.messages.slice(0, 2).map((m) => m.content), ["User 1", "Assistant A"]);
    assert.equal(after.messages.length, 3);
    assert.ok(after.messages.slice(2).every((m) => !["2", "3", "4", "5"].includes(m.id)));
    assert.equal(engine.isGenerating("s"), false);
  }
});

test("regeneration streaming and finalized bubbles use the timestamp sanitizer", async () => {
  const { storage, document } = await setup();
  const previews: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* () {
    for (const chunk of ["[2026-10-", "05 13:26 Asia/", "Shanghai]\nHello", "\n\nWorld"]) {
      yield chunk;
      previews.push((await storage.readSession("s")).messages[2].content);
    }
  });
  await engine.regenerateMessage("2");
  assert.deepEqual(previews, ["", "", "Hello", "Hello\n\nWorld"]);
  assert.deepEqual((await storage.readSession("s")).messages.slice(2).map((m) => m.content), ["Hello", "World"]);
});

test("ineligible target or mismatched session cannot truncate or call provider", async () => {
  for (const [role, status] of [["user", "sent"], ["assistant", "streaming"],
    ["assistant", "error"], ["assistant", "cancelled"], ["system", "complete"]] as const) {
    const { storage, document } = await setup();
    const backup = await storage.exportBackup();
    backup.messages[2] = { ...backup.messages[2], role, status };
    await storage.replaceBackup(await storage.exportBackup(), backup);
    const before = await storage.readSession("s");
    const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
    await assert.rejects(engine.regenerateMessage("2", undefined, "s"), /completed Assistant/);
    assert.deepEqual(await storage.readSession("s"), before);
  }
  const { storage, document } = await setup();
  document.characters.push({ ...document.characters[0], characterId: "other" });
  const other = await storage.openSession("other");
  const before = await storage.readSession("s");
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(engine.regenerateMessage("2", undefined, other.id), /completed Assistant/);
  assert.deepEqual(await storage.readSession("s"), before);
});

test("regenerate and normal reply protect concurrent generation", async () => {
  const { storage, document } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const engine = createChatEngine(storage, async () => document, async function* () {
    started(); await gate; yield "new";
  });
  const first = engine.regenerateMessage("2", undefined, "s");
  await ready;
  await assert.rejects(engine.regenerateMessage("1", undefined, "s"), /in progress/);
  assert.equal(await engine.requestReply("s"), null);
  const secondEngine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(secondEngine.regenerateMessage("1", undefined, "s"), /in progress/);
  release(); await first;
  await storage.send("s", "new user");
  const reply = engine.requestReply("s");
  await assert.rejects(engine.regenerateMessage("1", undefined, "s"), /in progress/);
  await reply;
});

test("UI session reservation allows immediate Stop before truncation", async () => {
  const { storage, document } = await setup();
  const before = await storage.readSession("s");
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  const request = engine.regenerateMessage("2", undefined, "s");
  engine.stop("s");
  assert.equal(await request, null);
  assert.deepEqual(await storage.readSession("s"), before);
  assert.equal(engine.isGenerating("s"), false);
});

test("truncation and new reply reservation roll back together if storage preparation fails", async () => {
  const { storage } = await setup();
  const before = await storage.readSession("s");
  const randomUUID = crypto.randomUUID;
  crypto.randomUUID = () => { throw new Error("reservation failed"); };
  try {
    await assert.rejects(storage.beginReply("s", "2"), /reservation failed/);
  } finally {
    crypto.randomUUID = randomUUID;
  }
  assert.deepEqual(await storage.readSession("s"), before);
});

test("regeneration can truncate the first assistant and reset the empty timeline order", async () => {
  const { storage, document } = await setup();
  await storage.deleteMessages("s", ["0"]);
  const engine = createChatEngine(storage, async () => document, async function* () { yield "fresh"; });
  await engine.regenerateMessage("1", undefined, "s");
  const after = await storage.readSession("s");
  assert.equal(after.messages.length, 1);
  assert.equal(after.messages[0].order, 1);
  assert.equal(after.session.nextOrder, 2);
  assert.equal(after.session.lastMessageId, after.messages[0].id);
  assert.equal(after.session.lastMessagePreview, "fresh");
});
