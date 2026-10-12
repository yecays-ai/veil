import assert from "node:assert/strict";
import test from "node:test";
import { ChatStorage } from "../lib/chat/storage";
import { MEMORY_TRACKING_ENABLED, allocateMemorySequence, memoryMessageEligible } from "../lib/memory/sequence";
import type { ChatMessage, ChatSession } from "../lib/chat/types";
import { progressFixture } from "./memory-progress-fixture";

test("production tracking is off and regular chat never adds sequence fields or model calls", async () => {
  const f = await progressFixture(), production = new ChatStorage(() => f.factory, () => f.locks, f.gate);
  const fetch = globalThis.fetch; let network = 0;
  globalThis.fetch = async () => { network++; throw new Error("unexpected network"); };
  try {
    assert.equal(MEMORY_TRACKING_ENABLED, false);
    const fresh = await production.openSession("other");
    await assert.rejects(f.memory.withExclusive((scope) => production.activateMemoryTracking(fresh.id, scope)), /disabled/);
    const user = await production.send(fresh.id, "hello"), batch = await production.beginReply(fresh.id);
    assert(batch); await production.finalizeReply(batch.assistant.id, "hello back\n\nsecond bubble");
    const next = await production.send(fresh.id, "next");
    const view = await production.readSession(fresh.id);
    assert.equal(user.memorySequence, undefined); assert.equal(next.memorySequence, undefined);
    assert(view?.messages.every((m) => m.memorySequence === undefined)); assert.equal(network, 0);
    assert.equal((await f.memory.listCursors("other")).length, 0);
  } finally { globalThis.fetch = fetch; }
});

test("legacy messages are never backfilled; activation and confirmation are idempotent", async () => {
  const f = await progressFixture(), session = await f.chat.openSession("legacy");
  const old = await f.chat.send(session.id, "old"), batch = await f.chat.beginReply(session.id);
  assert(batch); await f.chat.finalizeReply(batch.assistant.id, "old reply");
  await f.memory.withExclusive(async (scope) => {
    await f.chat.activateMemoryTracking(session.id, scope); await f.chat.activateMemoryTracking(session.id, scope);
  });
  const fresh = await f.chat.send(session.id, "new"), view = await f.chat.readSession(session.id);
  assert.equal(fresh.memorySequence?.seq, 1);
  assert.equal(view?.messages.find((m) => m.id === old.id)?.memorySequence, undefined);
  assert.equal(view?.messages.find((m) => m.id === batch.assistant.id)?.memorySequence, undefined);
});

test("clock rollback, same millisecond, multi-bubble confirmation, edit and deletion preserve monotonic seq", async () => {
  const f = await progressFixture(), now = Date.now;
  try {
    Date.now = () => 1000; const first = await f.send("one"); const batch = await f.chat.beginReply(f.session.id);
    assert(batch); await f.chat.finalizeReply(batch.assistant.id, "bubble one\n\nbubble two");
    assert.equal((await f.snapshot()).messages.filter((m) => m.role === "assistant").every((m) => m.memorySequence?.seq === undefined), true);
    Date.now = () => 1; const next = await f.send("two");
    const view = await f.snapshot(), bubbles = view.messages.filter((m) => m.role === "assistant").sort((a, b) => a.order - b.order);
    assert.deepEqual(bubbles.map((m) => m.memorySequence?.seq), [2, 3]); assert.equal(next.memorySequence?.seq, 4);
    await f.chat.editMessage(next.id, "edited"); await f.chat.deleteMessages(f.session.id, [first.id]);
    const reopened = new ChatStorage(() => f.factory, () => f.locks, f.gate, true), last = await reopened.send(f.session.id, "three");
    assert.equal(last.memorySequence?.seq, 5);
    assert.equal((await f.snapshot()).messages.find((m) => m.id === next.id)?.memorySequence?.seq, 4);
    assert.equal((await f.snapshot()).session?.memorySequence?.nextSeq, 6);
  } finally { Date.now = now; }
});

test("Regenerate and Continue assign only the final confirmed bubbles, without reusing order as seq", async () => {
  const f = await progressFixture(); await f.send("question");
  const initial = await f.chat.beginReply(f.session.id); assert(initial);
  const original = await f.chat.finalizeReply(initial.assistant.id, "draft\n\nold extra");
  const redo = await f.chat.beginReply(f.session.id, original[0].id); assert(redo);
  const replacement = await f.chat.finalizeReply(redo.assistant.id, "replacement", undefined, undefined, undefined, "length");
  const more = await f.chat.beginReply(f.session.id, replacement[0].id, undefined, "continue"); assert(more);
  await f.chat.finalizeReply(more.assistant.id, "continued\n\nlast");
  assert.equal((await f.snapshot()).messages.filter((m) => m.role === "assistant").every((m) => m.memorySequence?.seq === undefined), true);
  await f.send("confirm");
  const view = await f.snapshot(), bubbles = view.messages.filter((m) => m.role === "assistant").sort((a, b) => a.order - b.order);
  assert.deepEqual(bubbles.map((m) => m.memorySequence?.seq), [2, 3, 4]);
  assert.equal(view.session?.memorySequence?.nextSeq, 6);
});

test("failed assistant attempts remain ineligible; clear creates a new epoch and never reuses old epoch seq", async () => {
  const f = await progressFixture(), before = (await f.snapshot()).session!.memorySequence!.epoch;
  await f.send(); const batch = await f.chat.beginReply(f.session.id); assert(batch);
  await f.chat.failGeneration(f.session.id, batch.session.generation!.id, "failed", "failed");
  await f.chat.releaseGeneration(f.session.id, batch.session.generation!.id); await f.send("next");
  const failed = (await f.snapshot()).messages.find((m) => m.id === batch.assistant.id)!;
  assert.equal(memoryMessageEligible(failed), false); assert.equal(failed.memorySequence?.seq, undefined);
  await f.chat.clearSession(f.session.id); const next = await f.send("new epoch");
  assert.notEqual(next.memorySequence?.epoch, before); assert.equal(next.memorySequence?.seq, 1);
});

test("sequence exhaustion aborts allocation; repeated eligibility does not reuse or increment assigned seq", () => {
  const session: ChatSession = { id: "s", characterId: "c", updatedAt: 1, autoReplyOnKeyboardDismiss: false, nextOrder: 1,
    memorySequence: { epoch: "epoch", nextSeq: Number.MAX_SAFE_INTEGER } };
  const message: ChatMessage = { id: "m", sessionId: "s", role: "user", content: "x", status: "sent", createdAt: 1, order: 1,
    memorySequence: { epoch: "epoch" } };
  assert.throws(() => allocateMemorySequence(session, message), /exhausted/);
  session.memorySequence!.nextSeq = 3; const result = allocateMemorySequence(session, message);
  assert.equal(result.memorySequence?.seq, 3); assert.deepEqual(allocateMemorySequence(session, result), result);
  assert.equal(session.memorySequence!.nextSeq, 4);
});

test("confirmation still saves its counter when a delete target has already disappeared", async () => {
  const f = await progressFixture(); await f.send("first"); const batch = await f.chat.beginReply(f.session.id); assert(batch);
  await f.chat.finalizeReply(batch.assistant.id, "reply"); await f.send("next");
  const view = await f.snapshot(), assistant = view.messages.find((m) => m.role === "assistant")!;
  assistant.confirmed = false; delete assistant.memorySequence!.seq;
  await f.chat.replaceAllRows({ sessions: [view.session!], messages: view.messages, assets: [], chatSettings: [], worldBookStates: [] });
  assert.equal(await f.chat.deleteMessages(f.session.id, ["already-gone"]), 0);
  const updated = await f.snapshot(); assert.equal(updated.messages.find((m) => m.id === assistant.id)?.memorySequence?.seq, 4);
  assert.equal(updated.session?.memorySequence?.nextSeq, 5);
  assert.equal((await f.send("last")).memorySequence?.seq, 5);
});
