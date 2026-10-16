import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { BubbleRevealQueue } from "../lib/chat/bubble-pacing";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import type { MessageSticker } from "../lib/chat/sticker-message";

function setup(...replies: string[]) {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const prompts: { role: string; content: string }[][] = [];
  let call = 0;
  const engine = createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push([...prompt] as never); yield replies[Math.min(call++, replies.length - 1)] ?? "ok"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  return { storage, engine, prompts };
}
const three = "alpha\n\nbravo\n\ncharlie";
async function replied(...replies: string[]) {
  const ctx = setup(...replies);
  const session = await ctx.storage.openSession("a");
  await ctx.storage.send(session.id, "hello");
  await ctx.engine.requestReply(session.id);
  const { messages } = await ctx.storage.readSession(session.id);
  return { ...ctx, session, messages, bubbles: messages.filter((m) => m.role === "assistant") };
}

test("the unshown end of a reply is removed, the shown part stays, and the new message follows in order", async () => {
  const { storage, engine, prompts, session, bubbles } = await replied(three, "later");
  assert.equal(bubbles.length, 3);
  assert.equal(await storage.discardUnrevealedTail(session.id, [bubbles[1].id, bubbles[2].id]), 2);
  await engine.send(session.id, "actually, a new thought");
  const { messages } = await storage.readSession(session.id);
  assert.deepEqual(messages.map((m) => m.content), ["hello", "alpha", "actually, a new thought"]);
  assert.deepEqual(messages.map((m) => m.order), [1, 2, 3]);
  assert.equal(messages[0].requestedBy, bubbles[0].id, "the user message is still answered by the bubble that was shown");
  await engine.requestReply(session.id);
  const sent = prompts.at(-1)!.map((m) => m.content).join("\n");
  assert.match(sent, /alpha/);
  assert.doesNotMatch(sent, /bravo|charlie/, "bubbles the user never saw are not in the model's history");
});

test("when nothing was shown yet, the old message is not answered again", async () => {
  const { storage, engine, prompts, session, bubbles } = await replied(three, "fresh");
  assert.equal(await storage.discardUnrevealedTail(session.id, bubbles.map((m) => m.id)), 3);
  let { messages } = await storage.readSession(session.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status === "sent" && !messages[0].requestedBy, false, "settled, not waiting for a reply");
  assert.equal(await engine.requestReply(session.id), null);
  assert.equal(prompts.length, 1, "no extra model request for the old message");
  await engine.send(session.id, "new message");
  await engine.requestReply(session.id);
  assert.equal(prompts.length, 2);
  const text = prompts[1].map((m) => m.content).join("\n");
  assert.match(text, /hello/); assert.match(text, /new message/); assert.doesNotMatch(text, /alpha|bravo|charlie/);
  ({ messages } = await storage.readSession(session.id));
  assert.deepEqual(messages.map((m) => m.order), [1, 2, 3]);
});

test("a sticker can interrupt in the same way", async () => {
  const { storage, engine, session, bubbles } = await replied(three);
  const sticker = { packId: "p", packName: "P", stickerId: "s", name: "wave", url: "data:image/png;base64,AA==" } as MessageSticker;
  await engine.sendSticker(session.id, sticker, undefined, { discardUnrevealed: [bubbles[2].id] }).catch(() => undefined);
  const { messages } = await storage.readSession(session.id);
  assert.equal(messages.some((m) => m.id === bubbles[2].id), false);
  assert.equal(messages.some((m) => m.id === bubbles[0].id), true);
});

test("only plain bubbles at the very end of one turn can be removed", async () => {
  const { storage, engine, session, bubbles } = await replied(three);
  const before = (await storage.readSession(session.id)).messages.length;
  const user = (await storage.readSession(session.id)).messages[0];
  for (const ids of [[bubbles[1].id], [bubbles[0].id, bubbles[2].id], [user.id, bubbles[2].id], ["missing"], [bubbles[2].id, "missing"]])
    assert.equal(await storage.discardUnrevealedTail(session.id, ids), 0, JSON.stringify(ids.map((id) => id.slice(0, 4))));
  await storage.send(session.id, "second");
  assert.equal(await storage.discardUnrevealedTail(session.id, [bubbles[2].id]), 0, "a later user message means the bubble is no longer the end");
  assert.equal((await storage.readSession(session.id)).messages.length, before + 1);
  await engine.send(session.id, "third", undefined, { discardUnrevealed: ["missing"] });
  assert.equal((await storage.readSession(session.id)).messages.length, before + 2, "a refused discard never blocks the new message");
});

test("a transfer card from the reply is never discarded", async () => {
  const { storage, session, bubbles } = await replied(three);
  await storage.createTransferForReply(bubbles[0].id, 5, "gift");
  const { messages } = await storage.readSession(session.id);
  const card = messages.find((m) => m.transfer)!;
  assert.equal(await storage.discardUnrevealedTail(session.id, [card.id]), 0);
  assert.equal(await storage.discardUnrevealedTail(session.id, [bubbles[2].id]), 1);
  assert.equal((await storage.readSession(session.id)).messages.some((m) => m.transfer), true, "the committed action stays");
});

test("the reveal queue stops by itself once its hidden bubbles are gone", () => {
  const queue = new BubbleRevealQueue();
  const make = (id: string) => ({ id, sessionId: "s", role: "assistant", content: id, status: "complete", createdAt: 1, order: 1 }) as never;
  const reply = [make("a"), make("b"), make("c")];
  queue.begin("s", [], false, 0);
  queue.complete("s", reply, 0, 1);
  queue.reconcile(reply);
  queue.reconcile([reply[0]]);
  assert.equal(queue.getSnapshot().hiddenIds.size, 0);
  assert.equal(queue.getSnapshot().replyIds.length, 0);
});
