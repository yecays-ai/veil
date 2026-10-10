import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { startGenerationPersistence } from "../lib/chat/persistence-diagnostics";

type Log = { label: string; data: Record<string, unknown> };
const SECRET = "provider-secret-text";

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { storage, session, document };
}
async function capture<T>(run: () => Promise<T>, env = "development") {
  const originalInfo = console.info, originalEnv = process.env.NODE_ENV;
  const logs: Log[] = [];
  Object.assign(process.env, { NODE_ENV: env });
  console.info = ((label: string, data: Record<string, unknown>) => { logs.push({ label, data }); }) as typeof console.info;
  let error: unknown, value: T | undefined;
  try { value = await run(); } catch (reason) { error = reason; } finally {
    console.info = originalInfo;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
  return { logs, error, value, events: logs.filter((e) => e.label === "[VEIL generation:persisted]").map((e) => e.data) };
}
const one = (events: Record<string, unknown>[]) => {
  assert.equal(events.length, 1, "exactly one persistence event per claimed attempt");
  assert.equal(typeof events[0].durationMs, "number");
  assert.deepEqual(Object.keys(events[0]).sort(), ["durationMs", "outcome", "releaseFailed", "requestId", "source"]);
  return events[0];
};

test("a committed reply records one persistence event tied to the model call's requestId, after it", async () => {
  const { storage, session, document } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Hello"; });
  const { logs, events } = await capture(() => engine.requestReply(session.id));
  const event = one(events);
  assert.equal(event.outcome, "committed");
  assert.equal(event.releaseFailed, false);
  assert.equal(event.source, "manual-reply");
  const reply = (await storage.readSession(session.id)).messages.find((m) => m.role === "assistant");
  assert.equal(event.requestId, reply?.attemptId);
  const labels = logs.map((l) => l.label);
  assert.equal(labels[labels.length - 1], "[VEIL generation:persisted]");
});

test("a model that finished but whose final write failed is a recorded failure, not a commit", async () => {
  const { storage, session, document } = await setup();
  storage.finalizeReply = async () => { throw new Error("disk full"); };
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Hello"; });
  const { events } = await capture(() => engine.requestReply(session.id));
  assert.equal(one(events).outcome, "failure-recorded");
  assert.equal((await storage.readSession(session.id)).messages.at(-1)?.status, "error");
});

test("provider failures and Stop are recorded as what was saved", async () => {
  const failed = await setup();
  const failing = createChatEngine(failed.storage, async () => failed.document, async function* () { throw new Error(SECRET); });
  const failure = await capture(() => failing.requestReply(failed.session.id));
  assert.equal(one(failure.events).outcome, "failure-recorded");
  assert.equal(JSON.stringify(failure.events).includes(SECRET), false);
  const stopped = await setup();
  const engine = createChatEngine(stopped.storage, async () => stopped.document, async function* () {
    engine.stop(stopped.session.id); yield "late";
  });
  const stop = await capture(() => engine.requestReply(stopped.session.id));
  assert.equal(one(stop.events).outcome, "stopped-recorded");
});

test("a failure marker that cannot be saved, or whose ownership is gone, is told apart", async () => {
  const lost = await setup();
  lost.storage.failGeneration = async () => null;
  const lostEngine = createChatEngine(lost.storage, async () => lost.document, async function* () { throw new Error("boom"); });
  assert.equal(one((await capture(() => lostEngine.requestReply(lost.session.id))).events).outcome, "owner-lost");
  const broken = await setup();
  broken.storage.failGeneration = async () => { throw new Error("marker write failed"); };
  const brokenEngine = createChatEngine(broken.storage, async () => broken.document, async function* () { throw new Error("boom"); });
  const result = await capture(() => brokenEngine.requestReply(broken.session.id));
  assert.match(String((result.error as Error).message), /marker write failed/);
  assert.equal(one(result.events).outcome, "failure-record-failed");
});

test("a release failure after a commit is reported without turning the commit into a failure", async () => {
  const { storage, session, document } = await setup();
  storage.releaseGeneration = async () => { throw new Error("release failed"); };
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Hello"; });
  const { events, error } = await capture(() => engine.requestReply(session.id));
  assert.match(String((error as Error).message), /release failed/); // existing behaviour: the call rejects
  const event = one(events);
  assert.equal(event.outcome, "committed");
  assert.equal(event.releaseFailed, true);
  assert.equal((await storage.readSession(session.id)).messages.at(-1)?.status, "complete");
});

test("an attempt that never claimed ownership records nothing; regenerate keeps its source", async () => {
  const { storage, session, document } = await setup();
  const notClaimed = createChatEngine(storage, async () => { throw new Error("no foundation"); }, async function* () { yield "x"; });
  const early = await capture(() => notClaimed.requestReply(session.id));
  assert.ok(early.error);
  assert.equal(early.events.length, 0);
  const engine = createChatEngine(storage, async () => document, async function* () { yield "First"; });
  await engine.requestReply(session.id);
  const original = (await storage.readSession(session.id)).messages.find((m) => m.role === "assistant")!;
  const replacement = await capture(() => engine.regenerateMessage(original.id));
  const event = one(replacement.events);
  assert.equal(event.outcome, "committed");
  assert.equal(event.source, "regenerate");
});

test("persistence events are development-only, can never break a reply, and are recorded once", async () => {
  const { storage, session, document } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { yield "Hello"; });
  assert.equal((await capture(() => engine.requestReply(session.id), "production")).logs.length, 0);
  const second = await setup();
  const engine2 = createChatEngine(second.storage, async () => second.document, async function* () { yield "Hello"; });
  const originalInfo = console.info;
  const broken = await capture(async () => {
    console.info = (() => { throw new Error("logging is broken"); }) as typeof console.info;
    return engine2.requestReply(second.session.id);
  });
  console.info = originalInfo;
  assert.equal(broken.error, undefined);
  const logs: unknown[] = [];
  const info = console.info, env = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "development" });
  console.info = ((_l: string, data: unknown) => { logs.push(data); }) as typeof console.info;
  try {
    const finish = startGenerationPersistence("manual-reply");
    finish("id", "committed", false);
    finish("id", "failure-recorded", true);
  } finally { console.info = info; if (env === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: env }); }
  assert.equal(logs.length, 1);
});
