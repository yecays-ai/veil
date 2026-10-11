import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createChatEngine } from "./chat-engine-fixture";
import type { TextProvider } from "../lib/chat/provider";

const replyWithActions = 'Hello. <veil-action>{"signature":"new signature","userNote":"new note","situation":{"status":"busy"}}</veil-action>';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function setup() {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("simulated-character");
  await storage.send(session.id, "Simulated question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated" }) }];
  return { storage, session, document };
}

for (const failure of ["provider", "stop", "commit"] as const) {
  test(`Presence T7/T8 actions from a ${failure} failure are never applied`, async () => {
    const app = await setup(), applied: unknown[] = [], sent: unknown[] = [];
    let requests = 0;
    const provider: TextProvider = async function* () {
      requests++;
      yield replyWithActions;
      if (failure === "provider") throw new Error("simulated provider failure");
      if (failure === "stop") engine.stop(app.session.id);
    };
    if (failure === "commit") app.storage.finalizeReply = async () => { throw new Error("simulated storage failure"); };
    const engine = createChatEngine(app.storage, async () => app.document, provider, undefined, () => new Date(1_700_000_000_000),
      undefined, undefined, undefined, undefined, undefined, async (...args) => { sent.push(args); }, undefined,
      async (...args) => { applied.push(args); });
    await engine.requestReply(app.session.id);
    await flush();
    assert.equal(requests, 1);
    assert.deepEqual(applied, []);
    assert.deepEqual(sent, []);
    const messages = (await app.storage.readSession(app.session.id)).messages;
    assert.equal(messages.some((message) => message.role === "assistant" && message.status === "complete"), false);
    assert.doesNotMatch(messages.map((message) => message.content).join("\n"), /veil-action/);
  });
}

test("a committed Regenerate applies its actions once with the committed reply id and Character owner", async () => {
  const app = await setup(), applied: unknown[][] = [];
  let requests = 0;
  const engine = createChatEngine(app.storage, async () => app.document, async function* () { requests++; yield replyWithActions; },
    undefined, () => new Date(1_700_000_000_000), undefined, undefined, undefined, undefined, undefined, async () => {}, undefined,
    async (...args) => { applied.push(args); });
  const first = await engine.requestReply(app.session.id); await flush();
  assert.ok(first); assert.equal(applied.length, 1);
  await engine.regenerateMessage(first.id); await flush();
  const latest = (await app.storage.readSession(app.session.id)).messages.find((message) => message.role === "assistant" && message.status === "complete");
  assert.ok(latest); assert.equal(requests, 2); assert.equal(applied.length, 2);
  assert.equal(applied[1][0], "simulated-character"); assert.equal(applied[1][3], latest.id);
  assert.doesNotMatch(latest.content, /veil-action/);
});
