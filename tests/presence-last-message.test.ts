import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { sentRecorder } from "../lib/chat/engine";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createPresenceStorage, PRESENCE_STORAGE_KEY } from "../lib/presence/storage";

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { storage, session, document };
}
const AT = new Date("2026-10-11T03:00:00Z");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function engineWith(app: Awaited<ReturnType<typeof setup>>, provider: Parameters<typeof createChatEngine>[2], recorded: [string, number][],
  recordSent?: Parameters<typeof createChatEngine>[10]) {
  return createChatEngine(app.storage, async () => app.document, provider, undefined, () => AT, undefined, undefined, undefined, undefined,
    undefined, recordSent ?? (async (characterId, sentAt) => { recorded.push([characterId, sentAt]); }));
}

test("a committed reply records the Character's sent time once, for that Character", async () => {
  const app = await setup(), recorded: [string, number][] = [];
  await engineWith(app, async function* () { yield "Hello"; }, recorded).requestReply(app.session.id);
  await flush();
  assert.deepEqual(recorded, [["a", AT.getTime()]]);
});

test("Regenerate is a new Character message and records the time too", async () => {
  const app = await setup(), recorded: [string, number][] = [];
  const engine = engineWith(app, async function* () { yield "Hello"; }, recorded);
  const reply = await engine.requestReply(app.session.id);
  await engine.regenerateMessage(reply!.id);
  await flush();
  assert.equal(recorded.length, 2);
});

test("Continue records the Character's sent time too", async () => {
  const app = await setup(), recorded: [string, number][] = [];
  const engine = engineWith(app, async function* (_config, _messages, _signal, _generation, _request, terminal) {
    yield "Hello"; terminal?.("length");
  }, recorded);
  const reply = await engine.requestReply(app.session.id);
  await engine.continueMessage(reply!.id);
  await flush();
  assert.deepEqual(recorded, [["a", AT.getTime()], ["a", AT.getTime()]]);
});

test("a failed, stopped or unsaved reply records nothing", async () => {
  const failed = await setup(), failedRecords: [string, number][] = [];
  await engineWith(failed, async function* () { throw new Error("boom"); }, failedRecords).requestReply(failed.session.id);
  const stopped = await setup(), stoppedRecords: [string, number][] = [];
  const engine = engineWith(stopped, async function* () { engine.stop(stopped.session.id); yield "late"; }, stoppedRecords);
  await engine.requestReply(stopped.session.id);
  const unsaved = await setup(), unsavedRecords: [string, number][] = [];
  unsaved.storage.finalizeReply = async () => { throw new Error("disk full"); };
  await engineWith(unsaved, async function* () { yield "Hello"; }, unsavedRecords).requestReply(unsaved.session.id);
  await flush();
  assert.deepEqual([failedRecords, stoppedRecords, unsavedRecords], [[], [], []]);
});

test("a Presence write that fails or throws cannot change the committed reply", async () => {
  for (const recordSent of [async () => { throw new Error("quota"); }, (() => { throw new Error("sync"); }) as never]) {
    const app = await setup(), warnings: unknown[][] = [], original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const reply = await engineWith(app, async function* () { yield "Hello"; }, [], recordSent).requestReply(app.session.id);
      await flush();
      assert.equal(reply?.content, "Hello");
      assert.equal(reply?.status, "complete");
      assert.equal(warnings.length, 1);
      assert.equal(JSON.stringify(warnings).includes("quota"), false, "the error text is not logged");
    } finally { console.warn = original; }
  }
});

test("the Presence recorder raises lastMessageAt and never lowers it", async () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const record = sentRecorder(createPresenceStorage(() => storage, () => undefined));
  const read = () => (JSON.parse(values.get(PRESENCE_STORAGE_KEY)!).characters as { characterId: string; lastMessageAt: number }[])
    .map((c) => [c.characterId, c.lastMessageAt]);
  await record("a", AT.getTime());
  assert.deepEqual(read(), [["a", AT.getTime()]]);
  await record("a", AT.getTime() - 60_000);
  await record("b", AT.getTime() - 1);
  assert.deepEqual(read(), [["a", AT.getTime()], ["b", AT.getTime() - 1]], "an older time changes nothing; Characters are separate");
});
