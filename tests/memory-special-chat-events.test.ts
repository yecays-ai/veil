import assert from "node:assert/strict";
import test from "node:test";
import { maintenanceCandidateText, buildMaintenanceInput } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { progressFixture } from "./memory-progress-fixture";

test("maintenance retrieval groups gift results with their card and keeps standalone results", () => {
  const card = { id: "gift-1", sessionId: "s", role: "assistant" as const, content: "card", status: "complete" as const,
    createdAt: 1, order: 1, gift: { icon: "🌻", content: "sunflower", sender: "assistant" as const, recipient: "user" as const, status: "accepted" as const } };
  const result = { id: "result-1", sessionId: "s", role: "user" as const, content: "accepted", status: "sent" as const,
    createdAt: 2, order: 2, giftEvent: { giftId: "gift-1", action: "accept" as const, actor: "user" as const, icon: "🌻", content: "sunflower" } };
  assert.equal(maintenanceCandidateText([card, result]), "card");
  assert.equal(maintenanceCandidateText([result]), "accepted");
});

test("Memory prompt and parser treat operation results as the same lifecycle item", async () => {
  const f = await progressFixture(), original = await f.send("gesture");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(ticket);
    const cardId = "transfer-1", eventId = "transfer-result-1";
    snapshot.messages.push(
      { ...original, id: cardId, content: "virtual transfer pending", transfer: { amount: 5, note: "tea", sender: "user", recipient: "assistant", status: "received" } },
      { ...original, id: eventId, content: "virtual transfer received", transferEvent: { transferId: cardId, action: "receive", actor: "assistant", amount: 5, note: "tea" } });
    const prompt = buildMaintenanceInput(snapshot, { characterId: "c", context: "" })[0].content;
    assert.match(prompt, /same original card/);
    const create = (id: string, text: string) => ({ op: "CREATE", text, kind: "event", subject: "character", messageIds: [id] });
    assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [create(eventId, "I received a small virtual transfer")] }), snapshot));
    assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [create(cardId, "I sent tea money"), create(eventId, "I received tea money")] }), snapshot));
    const combined = { ...create(cardId, "I received a small virtual transfer for tea"), messageIds: [cardId, eventId] };
    assert.ok(parseMaintenanceOperations(JSON.stringify({ operations: [combined] }), snapshot));
  });
});
