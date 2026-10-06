import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { BubbleRevealQueue, bubbleDelayMs, groupVisibleMessages, hiddenForReveal } from "../lib/chat/bubble-pacing";
import { createChatEngine } from "./chat-engine-fixture";
import { ChatStorage } from "../lib/chat/storage";
import { DEFAULT_BUBBLE_TIMING } from "../lib/chat/types";
import type { ChatMessage } from "../lib/chat/types";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

const message = (id: string, content = "short", createdAt = 0): ChatMessage => ({
  id, content, createdAt, sessionId: "s", role: "assistant", status: "complete", order: 0,
});

test("three timing tiers cover every boundary, empty fallback and Unicode", () => {
  for (const [length, delay] of [[0,1200],[1,1200],[60,1200],[61,2400],[200,2400],[201,3600],[1000,3600]]) {
    assert.equal(bubbleDelayMs("a".repeat(length)), delay);
    assert.equal(bubbleDelayMs("😀".repeat(length)), delay);
  }
  assert.deepEqual(DEFAULT_BUBBLE_TIMING, { shortMs: 1200, mediumMs: 2400, longMs: 3600 });
});

test("editing any timing tier leaves the other two independent", () => {
  for (const tier of ["shortMs", "mediumMs", "longMs"] as const) {
    const timing = { ...DEFAULT_BUBBLE_TIMING, [tier]: 5000 };
    for (const [key, length] of [["shortMs",10],["mediumMs",100],["longMs",1000]] as const)
      assert.equal(bubbleDelayMs("a".repeat(length), timing), key === tier ? 5000 : DEFAULT_BUBBLE_TIMING[key]);
  }
});

test("timing Settings exposes three fixed labels and individual seconds inputs", () => {
  const ui = readFileSync("components/settings/global-profile-settings.tsx", "utf8");
  for (const label of ["1–60 characters", "61–200 characters", "200+ characters"]) assert.ok(ui.includes(label));
  assert.match(ui, /onBlur=/);
  assert.doesNotMatch(ui, /Save Timing|Timing multiplier|bubbleDelayMsPerCharacter/);
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
  t.mock.timers.tick(2399);
  assert.equal(queue.getSnapshot().hiddenIds.size, 2);
  t.mock.timers.tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["c"]);
  t.mock.timers.tick(1200);
  assert.equal(queue.getSnapshot().pending, false);
  assert.equal(queue.getSnapshot().hiddenIds.size, 0);
});

test("queue credits first latency and uses each upcoming bubble's independent tier", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const queue = new BubbleRevealQueue();
  const token = queue.begin("s", [], false, 0, { ...DEFAULT_BUBBLE_TIMING, longMs: 5000 });
  queue.complete("s", [message("a", "a".repeat(10)), message("b", "b".repeat(100)), message("c", "c".repeat(1000))], 900, token);
  t.mock.timers.tick(299);
  assert.equal(queue.getSnapshot().hiddenIds.size, 3);
  t.mock.timers.tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["b", "c"]);
  t.mock.timers.tick(2399);
  assert.equal(queue.getSnapshot().hiddenIds.size, 2);
  t.mock.timers.tick(1);
  assert.deepEqual([...queue.getSnapshot().hiddenIds], ["c"]);
  t.mock.timers.tick(4999);
  assert.equal(queue.getSnapshot().pending, true);
  t.mock.timers.tick(1);
  assert.equal(queue.getSnapshot().pending, false);
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

test("timestamp grouping uses adjacent visible messages, inclusive fifteen-minute boundary", () => {
  const rows = [message("a"), { ...message("b", "user", 899999), role: "user" as const },
    message("c", "reply", 900000), message("d", "reply", 1800000), message("e", "reply", 1800000)];
  const before = structuredClone(rows);
  assert.deepEqual(groupVisibleMessages(rows).map((row) => row.showTimestamp), [true, false, false, true, false]);
  assert.deepEqual(rows, before);
  const hidden = message("hidden", "hidden", 600000);
  const visible = [rows[0], hidden, message("later", "later", 900000)].filter((row) => row.id !== "hidden");
  assert.deepEqual(groupVisibleMessages(visible).map((row) => row.showTimestamp), [true, true]);
  const continuous = Array.from({ length: 40 }, (_, i) => message(String(i), "chat", i * 60000));
  assert.equal(groupVisibleMessages(continuous).filter((row) => row.showTimestamp).length, 1);
});

test("visual grouping exposes one shared start and end boundary per sender sequence", () => {
  const rows = [
    message("a", "one", 0), message("b", "two", 1), message("c", "three", 2),
    { ...message("d", "user", 3), role: "user" as const },
    { ...message("e", "user", 4), role: "user" as const },
    message("f", "single", 900004),
  ];
  assert.deepEqual(groupVisibleMessages(rows).map(({ isGroupStart, isGroupEnd }) =>
    [isGroupStart, isGroupEnd]), [
    [true, false], [false, false], [false, true],
    [true, false], [false, true], [true, true],
  ]);
});

test("finalization notification reveals real persisted IDs once, preserving requestedBy and history", async () => {
  const storage = new ChatStorage(() => factory);
  const factory = new IDBFactory();
  const document = defaultFoundation();
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
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
