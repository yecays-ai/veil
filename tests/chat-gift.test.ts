import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { normalizeGiftContent, normalizeGiftIcon } from "../lib/chat/gift";
import { splitActions } from "../lib/presence/actions";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";

test("gift acceptance updates the original card and persists one linked result event", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("gift-user");
  const original = await storage.createGift(session.id, "🧋", "A drink for the trip", "user");
  assert.deepEqual(original.gift, { icon: "🧋", content: "A drink for the trip", sender: "user", recipient: "assistant", status: "pending" });
  await assert.rejects(storage.actOnGift(original.id, "user", "accept"), /not available/);
  const accepted = await storage.actOnGift(original.id, "assistant", "accept");
  assert.equal(accepted.message.gift?.status, "accepted");
  assert.equal(accepted.event.giftEvent?.giftId, original.id);
  await assert.rejects(storage.actOnGift(original.id, "assistant", "decline"), /not available/);
  assert.equal((await storage.readSession(session.id)).messages.filter((message) => message.gift).length, 1);
  await storage.deleteMessages(session.id, [original.id]);
  assert.equal((await storage.readSession(session.id)).messages.some((message) => message.giftEvent), false);
});

test("Character may send free-text gifts and user may reject them", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("gift-character");
  await storage.send(session.id, "hello");
  const reply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "I brought you something.")).at(0)!;
  const sent = await storage.createGiftForReply(reply.id, "🌻", "A tiny sunflower");
  assert.equal(sent.gift?.recipient, "user");
  const ordered = (await storage.readSession(session.id)).messages;
  assert.ok(ordered.findIndex((message) => message.id === sent.id) < ordered.findIndex((message) => message.id === reply.id),
    "Character gift card is fixed before the reply that carried its Action");
  const parsed = splitActions('<veil-action>{"gift":{"icon":"🌻","content":"A tiny sunflower"}}</veil-action>');
  assert.deepEqual(parsed.actions?.gift, { icon: "🌻", content: "A tiny sunflower" });
  const declined = await storage.actOnGift(sent.id, "user", "decline");
  assert.equal(declined.message.gift?.status, "declined");
  assert.equal(declined.event.giftEvent?.action, "decline");
});

test("Character gift result is inserted before the reply that decided it", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("gift-action-order");
  const gift = await storage.createGift(session.id, "☕", "coffee", "user");
  const reply = (await storage.finalizeReply((await storage.beginReply(session.id))!.assistant.id, "Coffee sounds good.")).at(0)!;
  await storage.actOnGiftForCharacter("gift-action-order", gift.id, "accept", reply.id);
  const messages = (await storage.readSession(session.id)).messages;
  const event = messages.find((message) => message.giftEvent?.giftId === gift.id)!;
  assert.ok(event.order < messages.find((message) => message.id === reply.id)!.order);
});

test("gift icon and content are bounded, custom text stays free-form", () => {
  assert.equal(normalizeGiftIcon(" 🎁 "), "🎁");
  assert.equal(normalizeGiftContent("  A custom  gift\nfor you "), "A custom gift for you");
  assert.throws(() => normalizeGiftIcon(""));
  assert.throws(() => normalizeGiftContent("  "));
  assert.throws(() => normalizeGiftContent("x".repeat(501)));
});

test("backup validates a gift and its linked operation result", async () => {
  const data = backupData(), session = data.chat.sessions[0];
  const gift = { id: "gift-test", sessionId: session.id, role: "assistant" as const, content: "[VEIL gift gift-test] Character sent 🌻 \\\"A sunflower\\\"; status: accepted.",
    status: "complete" as const, createdAt: session.updatedAt, order: 3, gift: { icon: "🌻", content: "A sunflower", sender: "assistant" as const,
      recipient: "user" as const, status: "accepted" as const } };
  const event = { id: "gift-result-test", sessionId: session.id, role: "user" as const, content: "[VEIL gift result for gift-test] You accepted 🌻 \\\"A sunflower\\\".",
    status: "sent" as const, createdAt: session.updatedAt, order: 4, giftEvent: { giftId: gift.id, action: "accept" as const, actor: "user" as const,
      icon: "🌻", content: "A sunflower" } };
  data.chat.messages.push(gift, event);
  Object.assign(session, { nextOrder: 5, lastMessageId: event.id, lastMessagePreview: event.content });
  const fixture = await packageFixture(data);
  const result = await validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  assert.equal(result.data.chat.messages.at(-1)?.giftEvent?.giftId, gift.id);
});
