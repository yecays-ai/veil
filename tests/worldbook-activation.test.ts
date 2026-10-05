import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../lib/chat/types";
import { normalizeWorldBook } from "../lib/worldbook";
import { evaluateWorldBooks, historyFingerprint } from "../lib/worldbook-activation";

const message = (id: string, content: string, order: number, role: "user" | "assistant" = "user"): ChatMessage => ({
  id, sessionId: "s", content, order, role, status: role === "user" ? "sent" : "complete", createdAt: order,
});
const book = (entries: object[]) => normalizeWorldBook({ name: "Lore", entries });

test("constant, literal, regex, case sensitivity, invalid patterns, disabled and priority", () => {
  const lore = book([
    { name: "constant", content: "C", constant: true, priority: 1 },
    { name: "literal", content: "L", key: ["Otto"], priority: 5 },
    { name: "regex", content: "R", key: ["[bad", "o.+o"], use_regex: true, priority: 5, position: "after" },
    { name: "sensitive", content: "S", key: ["Otto"], caseSensitive: true },
    { name: "invalid", content: "I", key: ["[bad"], use_regex: true },
    { name: "disabled", content: "D", constant: true, disable: true },
    { name: "empty", content: "", constant: true },
  ]);
  const result = evaluateWorldBooks([lore], [message("u", "otto", 1)], null);
  assert.deepEqual(result.before.map((item) => item.entry.content), ["L", "C"]);
  assert.deepEqual(result.after.map((item) => item.entry.content), ["R"]);
  assert.equal(result.nextState.cycle, 1);
  assert.deepEqual(evaluateWorldBooks([{ ...lore, enabled: false }], [message("u", "otto", 1)], null).before, []);
});

test("scanDepth counts real messages, includes pending and Quote, excludes streaming/error", () => {
  const lore = book([{ content: "Otto fact", keywords: ["Otto"], scanDepth: 1 }]);
  const history = [message("old", "Otto", 1), message("new", "later", 2)];
  assert.equal(evaluateWorldBooks([lore], history, null).before.length, 0);
  const pending = message("pending", "Otto now", 3);
  pending.quote = { messageId: "old", preview: "Otto", role: "user" };
  const placeholder = { ...message("stream", "Otto", 4, "assistant"), status: "streaming" as const };
  assert.equal(evaluateWorldBooks([lore], [...history, pending, placeholder], null).before.length, 1);
  assert.equal(historyFingerprint([...history, placeholder]).length, 2);
});

test("sticky, cooldown and delay advance by generation cycle, not Bubble count", () => {
  const lore = book([{ content: "Timed", key: ["Otto"], sticky: 2, cooldown: 3, delay: 1 }]);
  let state = null;
  const before = [message("u", "Otto", 1)];
  const activations: number[] = [];
  for (let cycle = 1; cycle <= 6; cycle++) {
    const input = cycle === 1 ? before : [...before, message("a", "hello", 2, "assistant")];
    const result = evaluateWorldBooks([lore], input, state);
    if (result.before.length) activations.push(cycle);
    state = { ...result.nextState, prefix: historyFingerprint(input) };
  }
  assert.deepEqual(activations, [2, 3, 4, 6]);
});

test("edit, delete and truncated regenerate invalidate timed state; pure evaluation never mutates it", () => {
  const lore = book([{ content: "Sticky", key: ["Otto"], sticky: 5 }]);
  const original = [message("u", "Otto", 1), message("a", "reply", 2, "assistant")];
  const first = evaluateWorldBooks([lore], original, null);
  const committed = { ...first.nextState, prefix: historyFingerprint(original) };
  const snapshot = structuredClone(committed);
  assert.equal(evaluateWorldBooks([lore], original, committed).before.length, 1);
  assert.deepEqual(committed, snapshot);
  assert.equal(evaluateWorldBooks([lore], [message("u", "changed", 1), original[1]], committed).before.length, 0);
  assert.equal(evaluateWorldBooks([lore], [original[0]], committed).nextState.cycle, 1);
  assert.equal(evaluateWorldBooks([lore], [], committed).nextState.cycle, 1);
});
