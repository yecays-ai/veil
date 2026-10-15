import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { normalizeTransferAmount, transferPromptContent } from "../lib/chat/transfer";
import { splitActions } from "../lib/presence/actions";

test("virtual transfer persists pending, receive and return as one original plus linked result cards", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("transfer-user");
  const original = await storage.createTransfer(session.id, 12.5, "coffee", "user");
  assert.deepEqual(original.transfer, { amount: 12.5, note: "coffee", sender: "user", recipient: "assistant", status: "pending" });
  await assert.rejects(storage.recallMessage(original.id, "user"), /Only your own message sent within the last 2 minutes can be recalled/);
  await assert.rejects(storage.actOnTransfer(original.id, "user", "receive"), /not available/);
  const accepted = await storage.actOnTransfer(original.id, "assistant", "receive");
  assert.equal(accepted.message.transfer?.status, "received");
  assert.equal(accepted.event.transferEvent?.transferId, original.id);
  const returned = await storage.actOnTransfer(original.id, "assistant", "return");
  assert.equal(returned.message.transfer?.status, "returned");
  const messages = (await storage.readSession(session.id)).messages;
  assert.equal(messages.filter((message) => message.transfer).length, 1);
  assert.equal(messages.filter((message) => message.transferEvent).length, 2);
  assert.match(transferPromptContent(returned.message, "Mika") ?? "", /status: returned/);
  await storage.deleteMessages(session.id, [original.id]);
  assert.equal((await storage.readSession(session.id)).messages.some((message) => message.transferEvent), false);
});

test("Character transfer action can be parsed and user can decline its pending card", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("transfer-character");
  await storage.send(session.id, "hello");
  const reply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "Here is a little gesture.")).at(0)!;
  const sent = await storage.createTransferForReply(reply.id, 5, "For you");
  assert.equal(sent.transfer?.recipient, "user");
  const ordered = (await storage.readSession(session.id)).messages;
  assert.ok(ordered.findIndex((message) => message.id === sent.id) < ordered.findIndex((message) => message.id === reply.id),
    "Character transfer card is fixed before the reply that carried its Action");
  const action = splitActions('<veil-action>{"transfer":{"recipient":"user","amount":5,"note":"For you"}}</veil-action>');
  assert.equal(action.actions?.transfer?.amount, 5);
  const declined = await storage.actOnTransfer(sent.id, "user", "decline");
  assert.equal(declined.message.transfer?.status, "declined");
  assert.equal(declined.event.transferEvent?.action, "decline");
});

test("Character transfer result is inserted before the reply that decided it", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("transfer-action-order");
  const transfer = await storage.createTransfer(session.id, 8, "snack", "user");
  const reply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "I'll take it.")).at(0)!;
  await storage.actOnTransferForCharacter("transfer-action-order", transfer.id, "receive", reply.id);
  const messages = (await storage.readSession(session.id)).messages;
  const event = messages.find((message) => message.transferEvent?.transferId === transfer.id)!;
  assert.ok(event.order < messages.find((message) => message.id === reply.id)!.order);
});

test("transfer amounts are positive, finite and capped", () => {
  assert.equal(normalizeTransferAmount(2.345), 2.35);
  assert.throws(() => normalizeTransferAmount(0));
  assert.throws(() => normalizeTransferAmount(Number.POSITIVE_INFINITY));
  assert.throws(() => normalizeTransferAmount(1_000_000_000_001));
});
