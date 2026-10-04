import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { BubbleRevealQueue, bubbleDelayMs, groupVisibleMessages, hiddenForReveal } from "../lib/chat/bubble-pacing";
import { createChatEngine } from "../lib/chat/engine";
import { ChatStorage } from "../lib/chat/storage";
import { DEFAULT_API_CONFIG_ID, type ChatMessage } from "../lib/chat/types";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

const message = (id: string, content = "short", createdAt = 0): ChatMessage => ({
  id, content, createdAt, sessionId: "s", role: "assistant", status: "complete", order: 0,
});

test("pacing clamps short and long text and counts Unicode characters", () => {
  assert.equal(bubbleDelayMs("lol"), 600);
  assert.equal(bubbleDelayMs("a".repeat(50)), 1200);
  assert.equal(bubbleDelayMs("😀".repeat(50)), 1200);
  assert.equal(bubbleDelayMs("a".repeat(1000)), 2400);
});

test("three bubbles reveal in order, using upcoming length and first latency credit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = new BubbleRevealQueue();
  const parts = [message("a", "a".repeat(50)), message("b", "b".repeat(100)), message("c")];
  const token = queue.begin("s", [], false, 0);
  queue.complete("s", parts, 900, token);
  t.mock.timers.tick(299);
  assert.equal(queue.getSnapshot().hiddenIds.size, 3);
  t.mock.timers.tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["b", "c"]);
  t.mock.timers.tick(1949);
  assert.equal(queue.getSnapshot().hiddenIds.size, 2);
  t.mock.timers.tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["c"]);
  t.mock.timers.tick(600);
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(queue.getSnapshot().hiddenIds.size, 0);
});

test("single bubble reveals immediately when generation already covered its delay", () => {
  const queue = new BubbleRevealQueue();
  const token = queue.begin("s", [], false, 0);
  queue.complete("s", [message("a")], 1800, token);
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(hiddenForReveal(message("a"), queue.getSnapshot()), false);
});

test("cancel covers Stop, unmount and switch; stale completion cannot affect new generation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = new BubbleRevealQueue();
  const old = queue.begin("s", [], false, 0);
  queue.complete("s", [message("a"), message("b")], 1000, old);
  queue.cancel();
  t.mock.timers.tick(10000);
  assert.equal(queue.getSnapshot().sessionId, undefined);
  const next = queue.begin("s", [], false, 0);
  queue.complete("s", [message("old")], 1000, old);
  queue.settle("s", old);
  assert.equal(queue.getSnapshot().awaiting, true);
  queue.settle("s", next);
  assert.equal(queue.getSnapshot().pending, false);
});

test("deleting queued messages and clearing authoritative history cancel pending timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const deletion of [true, false]) {
    const queue = new BubbleRevealQueue();
    const parts = [message("a"), message("b")];
    const token = queue.begin("s", [], false, 0);
    queue.complete("s", parts, 1000, token);
    queue.reconcile(parts);
    if (deletion) queue.discard(["b"]);
    else queue.reconcile([]);
    t.mock.timers.tick(10000);
    assert.equal(queue.getSnapshot().pending, false);
    assert.equal(queue.getSnapshot().replyIds.length, 0);
  }
});

test("streaming bypasses reveal; awaiting OFF hides previews without hiding known history", () => {
  const queue = new BubbleRevealQueue();
  let token = queue.begin("s", [message("known")], false, 0);
  assert.equal(hiddenForReveal(message("known"), queue.getSnapshot()), false);
  assert.equal(hiddenForReveal(message("new"), queue.getSnapshot()), true);
  token = queue.begin("s", [], true, 0);
  queue.complete("s", [message("new")], 0, token);
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(hiddenForReveal(message("new"), queue.getSnapshot()), false);
});

test("timestamp grouping uses adjacent visible messages, inclusive three-minute boundary", () => {
  const rows = [message("a"), { ...message("b", "user", 179999), role: "user" as const },
    message("c", "reply", 180000), message("d", "reply", 360000), message("e", "reply", 360000)];
  const before = structuredClone(rows);
  assert.deepEqual(groupVisibleMessages(rows).map((row) => row.showTimestamp), [true, false, false, true, false]);
  assert.deepEqual(rows, before);
  const hidden = message("hidden", "hidden", 120000);
  const visible = [rows[0], hidden, message("later", "later", 180000)].filter((row) => row.id !== "hidden");
  assert.deepEqual(groupVisibleMessages(visible).map((row) => row.showTimestamp), [true, true]);
  const continuous = Array.from({ length: 40 }, (_, i) => message(String(i), "chat", i * 60000));
  assert.equal(groupVisibleMessages(continuous).filter((row) => row.showTimestamp).length, 1);
});

test("finalization notification reveals real persisted IDs once, preserving requestedBy and history", async () => {
  const storage = new ChatStorage(() => factory);
  const factory = new IDBFactory();
  const document = defaultFoundation();
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  await storage.saveApiConfig({ id: DEFAULT_API_CONFIG_ID, baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  const session = await storage.openSession("a");
  const user = await storage.send(session.id, "hello");
  let calls = 0;
  const engine = createChatEngine(storage, async () => document, async function* () {
    calls++;
    yield "A\n\nB\n\nC";
  });
  let notifications = 0;
  let parts: readonly ChatMessage[] = [];
  await engine.requestReply(session.id, (completed) => { notifications++; parts = completed; });
  const saved = await storage.readSession(session.id);
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(parts.map((row) => row.content), ["A", "B", "C"]);
  assert.deepEqual(saved.messages.filter((row) => row.role === "assistant").map((row) => row.id), parts.map((row) => row.id));
  assert.equal(saved.messages.find((row) => row.id === user.id)?.requestedBy, parts[0].id);
  assert.equal(new Set(saved.messages.map((row) => row.id)).size, 4);
  await storage.send(session.id, "again");
  await engine.requestReply(session.id, () => { throw new Error("UI observer failed"); });
  assert.equal((await storage.readSession(session.id)).messages.at(-1)?.status, "complete");
});

test("Stop and provider error never notify finalized split bubbles", async () => {
  for (const stop of [false, true]) {
    const factory = new IDBFactory();
    const storage = new ChatStorage(() => factory);
    const document = defaultFoundation();
    document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
    await storage.saveApiConfig({ id: DEFAULT_API_CONFIG_ID, baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
    const session = await storage.openSession("a");
    await storage.send(session.id, "hello");
    const engine = createChatEngine(storage, async () => document, async function* () {
      yield "A\n\nB";
      if (stop) engine.stop(session.id);
      else throw new Error("provider failed");
    });
    const queue = new BubbleRevealQueue();
    const token = queue.begin(session.id, [], false, 0);
    let notifications = 0;
    await engine.requestReply(session.id, (parts) => {
      notifications++;
      queue.complete(session.id, parts, 1000, token);
    });
    queue.settle(session.id, token);
    const saved = await storage.readSession(session.id);
    assert.equal(notifications, 0);
    assert.equal(queue.getSnapshot().pending, false);
    assert.equal(saved.messages.filter((row) => row.role === "assistant").length, 1);
    assert.equal(saved.messages.at(-1)?.status, stop ? "cancelled" : "error");
  }
});
