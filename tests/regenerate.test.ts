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
  const session = await storage.openSession("a");
  const user = await storage.send(session.id, "User 1");
  const document = defaultFoundation();
  document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  let initialGeneration = 0;
  const initial = createChatEngine(storage, async () => document, async function* () {
    yield initialGeneration++ === 0 ? "Assistant A\n\nTarget B\n\nFuture C" : "Future D";
  });
  await initial.requestReply(session.id);
  const target = (await storage.readSession(session.id)).messages.find((message) => message.content === "Target B")!;
  await storage.send(session.id, "Future User 2");
  await initial.requestReply(session.id);
  const messages = (await storage.readSession(session.id)).messages;
  return { factory, storage, session, document, user, target, messages };
}

test("regenerate truncates target and all future messages, then stores normal multi-bubble output", async () => {
  const { factory, storage, session, document, target, user } = await setup();
  let calls = 0;
  let finalized: readonly ChatMessage[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_config, prompt, _signal, _generation, request) {
    calls++;
    assert.equal(request?.source, "regenerate");
    const text = prompt.map((turn) => turn.content).join("\n");
    assert.match(text, /User 1/);
    assert.match(text, /Assistant A/);
    assert.doesNotMatch(text, /Target B|Future C|Future User 2|Future D|replacement message|regenerating one/);
    const during = await storage.readSession(session.id);
    assert.deepEqual(during.messages.map((message) => message.content), ["User 1", "Assistant A", ""]);
    assert.equal(during.messages[2].status, "streaming");
    yield "B'\n\nC'\n\nD'";
  });
  await engine.regenerateMessage(target.id, (messages) => { finalized = messages; });
  const after = await new ChatStorage(() => factory).readSession(session.id);
  assert.equal(calls, 1);
  assert.deepEqual(after.messages.map((message) => message.content), ["User 1", "Assistant A", "B'", "C'", "D'"]);
  assert.equal(after.messages[0].id, user.id);
  assert.deepEqual(after.messages.map((message) => message.order), [1, 2, 3, 4, 5]);
  assert.equal(finalized.length, 3);
  assert.equal(after.session.nextOrder, 6);
  assert.equal(after.session.lastMessageId, after.messages[4].id);
  assert.equal(after.session.lastMessagePreview, "D'");
});

test("regeneration needs no pending user and new bubble count is independent", async () => {
  const { storage, session, document, target } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { yield "one"; });
  await engine.regenerateMessage(target.id);
  const after = await storage.readSession(session.id);
  assert.deepEqual(after.messages.map((message) => message.content), ["User 1", "Assistant A", "one"]);
  assert.equal(await engine.requestReply(session.id), null);
  assert.equal(after.session.nextOrder, 4);
});

test("truncation preserves a retained user's association with its retained reply", async () => {
  const { storage, session, target } = await setup();
  const batch = await storage.beginReply(session.id, target.id);
  assert.ok(batch);
  const after = await storage.readSession(session.id);
  assert.equal(after.messages[0].requestedBy, (await storage.readSession(session.id)).messages[1].id);
  assert.equal(after.session.lastMessageId, batch.assistant.id);
  assert.equal(after.session.nextOrder, 4);
});

test("provider failure, empty output and Stop never restore the truncated future", async () => {
  for (const mode of ["error", "empty", "stop"] as const) {
    const { storage, session, document, target } = await setup();
    const engine = createChatEngine(storage, async () => document, async function* () {
      yield mode === "empty" ? "[2026-10-05 13:26 Asia/Shanghai]" : "partial";
      if (mode === "error") throw new Error("provider failed");
      if (mode === "stop") engine.stop(session.id);
    });
    const result = await engine.regenerateMessage(target.id);
    assert.equal(result?.status, mode === "stop" ? "cancelled" : "error");
    const after = await storage.readSession(session.id);
    assert.deepEqual(after.messages.slice(0, 2).map((message) => message.content), ["User 1", "Assistant A"]);
    assert.equal(after.messages.length, 3);
    assert.equal(engine.isGenerating(session.id), false);
  }
});

test("regeneration streaming and finalized bubbles use the timestamp sanitizer", async () => {
  const { storage, session, document, target } = await setup();
  const previews: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* () {
    for (const chunk of ["[2026-10-", "05 13:26 Asia/", "Shanghai]\nHello", "\n\nWorld"]) {
      yield chunk;
      previews.push((await storage.readSession(session.id)).messages.at(-1)!.content);
    }
  });
  await engine.regenerateMessage(target.id);
  assert.deepEqual(previews, ["", "", "Hello", "Hello\n\nWorld"]);
  assert.deepEqual((await storage.readSession(session.id)).messages.slice(2).map((message) => message.content), ["Hello", "World"]);
});

test("user and streaming messages cannot be regeneration targets", async () => {
  const { storage, session, document, user, target } = await setup();
  const before = await storage.readSession(session.id);
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(engine.regenerateMessage(user.id), /completed Assistant/);
  assert.deepEqual(await storage.readSession(session.id), before);
  await storage.send(session.id, "pending for streaming draft");
  const batch = await storage.beginReply(session.id);
  assert.ok(batch);
  const streamingEngine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(streamingEngine.regenerateMessage(batch.assistant.id), /completed Assistant/);
  assert.equal((await storage.readSession(session.id)).messages.some((message) => message.id === target.id), true);
});

test("regenerate and normal reply protect concurrent generation", async () => {
  const { storage, session, document, target } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const engine = createChatEngine(storage, async () => document, async function* () {
    started(); await gate; yield "new";
  });
  const first = engine.regenerateMessage(target.id, undefined, session.id);
  await ready;
  await assert.rejects(engine.regenerateMessage(target.id, undefined, session.id), /in progress/);
  assert.equal(await engine.requestReply(session.id), null);
  release(); await first;
  await storage.send(session.id, "new user");
  const reply = engine.requestReply(session.id);
  await assert.rejects(engine.regenerateMessage(target.id, undefined, session.id), /in progress/);
  await reply;
});

test("immediate Stop cancels before regeneration truncates the timeline", async () => {
  const { storage, session, document, target } = await setup();
  const before = await storage.readSession(session.id);
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  const request = engine.regenerateMessage(target.id, undefined, session.id);
  engine.stop(session.id);
  assert.equal(await request, null);
  assert.deepEqual(await storage.readSession(session.id), before);
  assert.equal(engine.isGenerating(session.id), false);
});

test("truncation and new reply reservation roll back together if storage preparation fails", async () => {
  const { storage, session, target } = await setup();
  const before = await storage.readSession(session.id);
  const randomUUID = crypto.randomUUID;
  crypto.randomUUID = () => { throw new Error("reservation failed"); };
  try {
    await assert.rejects(storage.beginReply(session.id, target.id), /reservation failed/);
  } finally {
    crypto.randomUUID = randomUUID;
  }
  assert.deepEqual(await storage.readSession(session.id), before);
});
