import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { canRegenerateTurn } from "../lib/chat/turns";
import { regressionContract } from "./regression-contract";

async function setup() {
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory);
  const session = await storage.openSession("a"), user = await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const initial = createChatEngine(storage, async () => document, async function* () { yield "First\n\nSecond\n\nThird"; });
  await initial.requestReply(session.id);
  const originals = (await storage.readSession(session.id)).messages.filter((m) => m.role === "assistant");
  return { factory, storage, session, document, user, originals };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

regressionContract("chat.regenerate-preserves-original", "async-race-safety",
  "every latest split bubble replaces the whole turn only after success", async () => {
    for (const bubble of [0, 1, 2]) {
      const { factory, storage, session, document, user, originals } = await setup();
      const ready = deferred(), finish = deferred();
      const engine = createChatEngine(storage, async () => document, async function* (_config, prompt) {
        ready.resolve();
        assert.ok(prompt.some((m) => m.content === user.content));
        assert.ok(!prompt.some((m) => /First|Second|Third/.test(m.content)));
        await finish.promise; yield "Replacement\n\nTail";
      });
      const pending = engine.regenerateMessage(originals[bubble].id);
      try {
        await ready.promise;
        assert.deepEqual((await storage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
        await assert.rejects(storage.send(session.id, "Later user"), /in progress/);
      } finally { finish.resolve(); await pending; }
      const saved = await new ChatStorage(() => factory).readSession(session.id);
      assert.deepEqual(saved.messages.map((m) => m.content), ["Question", "Replacement", "Tail"]);
      assert.equal(saved.messages[0].id, user.id);
      assert.deepEqual(saved.messages.map((m) => m.order), [1, 2, 3]);
      assert.equal(saved.session.nextOrder, 4);
      assert.equal(saved.session.lastMessagePreview, "Tail");
      assert.ok(saved.messages.slice(1).every((m) => m.turnId === originals[0].turnId));
    }
  });

regressionContract("chat.regenerate-failure-retry", "async-race-safety",
  "failed, empty and stopped replacements preserve originals and remain retryable", async () => {
    for (const mode of ["failed", "empty", "stopped"] as const) {
      const { storage, session, document, originals } = await setup();
      const engine = createChatEngine(storage, async () => document, async function* () {
        if (mode === "failed") { yield "partial"; throw new Error("offline"); }
        if (mode === "stopped") { engine.stop(session.id); yield "late"; }
      });
      const result = await engine.regenerateMessage(originals[1].id);
      assert.equal(result?.status, mode === "stopped" ? "cancelled" : "error");
      assert.deepEqual((await storage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
      assert.ok(canRegenerateTurn((await storage.readSession(session.id)).messages, originals[2].id));
      const retry = createChatEngine(storage, async () => document, async function* () { yield "Recovered"; });
      await retry.regenerateMessage(result!.id);
      assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["Question", "Recovered"]);
      assert.equal(engine.isGenerating(session.id), false);
    }
  });

test("a later User permanently confirms every bubble even if that User is deleted", async () => {
  const { storage, session, document, originals } = await setup();
  assert.ok(originals.every((m) => canRegenerateTurn(originals, m.id)));
  const later = await storage.send(session.id, "Accepted");
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  const before = (await storage.readSession(session.id)).messages;
  for (const bubble of originals) {
    assert.equal(canRegenerateTurn(before, bubble.id), false);
    await assert.rejects(engine.regenerateMessage(bubble.id, undefined, session.id), /eligible/);
  }
  assert.deepEqual((await storage.readSession(session.id)).messages, before);
  await storage.deleteMessages(session.id, [later.id]);
  for (const bubble of originals) await assert.rejects(engine.regenerateMessage(bubble.id), /unconfirmed/);
});

test("User and active streaming bubbles are not replacement targets", async () => {
  const { storage, session, document, user } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("must not generate"); });
  await assert.rejects(engine.regenerateMessage(user.id), /Assistant/);
  await storage.send(session.id, "New question");
  const draft = await storage.beginReply(session.id); assert.ok(draft);
  await assert.rejects(engine.regenerateMessage(draft.assistant.id), /in progress/);
  await storage.updateReply(draft.assistant.id, { content: "", status: "cancelled" });
});

test("safe regeneration sanitizes timestamps and preserves split turn identity", async () => {
  const { storage, session, document, originals } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () {
    yield "[2026-10-05 13:26 Asia/Shanghai]\nHello\n\nWorld";
  });
  await engine.regenerateMessage(originals[2].id);
  assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["Question", "Hello", "World"]);
});

test("remaining split bubbles retain replacement eligibility after their first bubble is deleted", async () => {
  const { storage, session, document, originals } = await setup();
  await storage.deleteMessages(session.id, [originals[0].id]);
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Replacement"; });
  await engine.regenerateMessage(originals[2].id);
  assert.deepEqual((await storage.readSession(session.id)).messages.map((m) => m.content), ["Question", "Replacement"]);
});

test("failed reservation retains data and releases resource ownership", async () => {
  const { storage, session, originals } = await setup();
  const before = await storage.readSession(session.id), randomUUID = crypto.randomUUID;
  crypto.randomUUID = () => { throw new Error("reservation failed"); };
  try { await assert.rejects(storage.beginReply(session.id, originals[0].id), /reservation failed/); }
  finally { crypto.randomUUID = randomUUID; }
  assert.deepEqual(await storage.readSession(session.id), before);
  const draft = await storage.beginReply(session.id, originals[0].id); assert.ok(draft);
  await storage.updateReply(draft.assistant.id, { content: "", status: "cancelled" });
});

test("Stop during target lookup prevents a late regenerate while another session's Stop is independent", async () => {
  for (const stopSameSession of [true, false]) {
    const { storage, session, document, originals } = await setup();
    const lookup = deferred(), ready = deferred(); let calls = 0;
    const resolve = storage.regenerationSessionId.bind(storage);
    storage.regenerationSessionId = async (id) => { ready.resolve(); await lookup.promise; return resolve(id); };
    const engine = createChatEngine(storage, async () => document, async function* () { calls++; yield "Replacement"; });
    const pending = engine.regenerateMessage(originals[1].id);
    await ready.promise;
    engine.stop(stopSameSession ? session.id : (await storage.openSession("b")).id);
    lookup.resolve(); await pending;
    assert.equal(calls, stopSameSession ? 0 : 1);
    if (stopSameSession)
      assert.deepEqual((await storage.readSession(session.id)).messages.filter((m) => m.role === "assistant"), originals);
  }
});

test("Stop during the replacement transaction rolls back deletes and preserves the original turn", async (context) => {
  const { storage, session, document, originals } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Replacement"; });
  const remove = IDBObjectStore.prototype.delete;
  const intercept = context.mock.method(IDBObjectStore.prototype, "delete", function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    const result = remove.call(this, key);
    if (this.name === "messages" && key === originals[0].id) engine.stop(session.id);
    return result;
  });
  const stopped = await engine.regenerateMessage(originals[1].id);
  assert.equal(stopped?.outcome, "stopped"); assert.equal(stopped?.failureStage, "finalizing");
  assert.deepEqual((await storage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
  intercept.mock.restore();
  const retry = createChatEngine(storage, async () => document, async function* () { yield "Recovered"; });
  assert.equal((await retry.regenerateMessage(originals[0].id))?.content, "Recovered");
});

test("a replacement persistence error after deletion rolls back atomically and remains retryable", async (context) => {
  const { storage, session, document, originals } = await setup();
  const put = IDBObjectStore.prototype.put;
  const intercept = context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const message = value as { content?: string; status?: string };
    if (this.name === "messages" && message.status === "complete" && message.content === "Replacement")
      throw new DOMException("Cannot persist replacement", "QuotaExceededError");
    return put.call(this, value, key);
  });
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Replacement"; });
  const failed = await engine.regenerateMessage(originals[2].id);
  assert.equal(failed?.outcome, "failed"); assert.equal(failed?.failureStage, "finalizing");
  assert.deepEqual((await storage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
  intercept.mock.restore();
  assert.equal((await engine.regenerateMessage(failed!.id))?.content, "Replacement");
});
