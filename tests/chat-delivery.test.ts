import assert from "node:assert/strict";
import test from "node:test";
import { immediateReadState, resolveUserMessageDelivery, userMessageDeliveryLabel } from "../lib/chat/delivery";
import type { ChatMessage } from "../lib/chat/types";

const user: ChatMessage = {
  id: "user", sessionId: "session", role: "user", content: "hello",
  status: "sent", createdAt: 1, order: 1,
};

test("successful User messages use a replaceable read-state boundary", () => {
  assert.equal(resolveUserMessageDelivery(user), "read");
  assert.equal(immediateReadState.resolve(user), "read");
  assert.equal(resolveUserMessageDelivery(user, { resolve: () => "delivered" }), "delivered");
  assert.equal(userMessageDeliveryLabel("sent"), "Delivered");
  assert.equal(userMessageDeliveryLabel("delivered"), "Delivered");
  assert.equal(userMessageDeliveryLabel("read"), "Read");
});

test("delivery state is not inferred from an Assistant reply or failed message", () => {
  assert.equal(resolveUserMessageDelivery({ ...user, role: "assistant", status: "complete" }), null);
  assert.equal(resolveUserMessageDelivery({ ...user, status: "error" }), null);
  assert.equal(resolveUserMessageDelivery({ ...user, requestedBy: "assistant" }), "read");
});
