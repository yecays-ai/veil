import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { getMessageActions, registerMessageAction, runMessageAction } from "../lib/chat/message-action-registry";

test("temporary action filters messages, persists its update, toasts, and unregisters", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("character");
  const message = await storage.send(session.id, "original");
  const other = { ...message, role: "assistant" as const };
  const toasts: string[] = [];
  const registration = registerMessageAction({
    id: "test:edit", label: "Test action", filter: (message) => message.role === "user",
    onSelect: async (message, helpers) => {
      await helpers.updateMessage({ content: `${message.content} updated` });
      helpers.toast("Updated");
    },
  });
  const helpers = {
    updateMessage: (patch: { content: string }) => storage.editMessage(message.id, patch.content),
    toast: (text: string) => { toasts.push(text); },
  };
  try {
    assert.deepEqual(getMessageActions(message).map((action) => action.id), ["test:edit"]);
    assert.deepEqual(getMessageActions(other), []);
    await assert.rejects(runMessageAction("test:edit", other, helpers), /unavailable/);
    await runMessageAction("test:edit", message, helpers);
    const saved = await storage.readSession(session.id);
    assert.equal(saved.messages[0].content, "original updated");
    assert.equal(saved.session.lastMessagePreview, "original updated");
    assert.deepEqual(toasts, ["Updated"]);
  } finally { registration.unregister(); }
  assert.deepEqual(getMessageActions(message), []);
  await assert.rejects(runMessageAction("test:edit", message, helpers), /unavailable/);
  registration.dispose();
});

test("filter failures stay hidden, duplicate IDs reject and action errors propagate", async () => {
  const message = { id: "m", sessionId: "s", role: "user" as const, content: "text",
    status: "sent" as const, createdAt: 1, order: 1 };
  const hidden = registerMessageAction({ id: "test:hidden", label: "Hidden",
    filter: () => { throw new Error("filter failed"); }, onSelect: () => {} });
  const failing = registerMessageAction({ id: "test:error", label: "Error",
    onSelect: async () => { throw new Error("action failed"); } });
  try {
    assert.deepEqual(getMessageActions(message).map((action) => action.id), ["test:error"]);
    assert.throws(() => registerMessageAction({ id: "test:error", label: "Duplicate", onSelect: () => {} }), /already registered/);
    await assert.rejects(runMessageAction("test:error", message, {
      updateMessage: async () => message, toast: () => {},
    }), /action failed/);
  } finally { hidden.dispose(); failing.dispose(); }
});
