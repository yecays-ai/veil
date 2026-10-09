import assert from "node:assert/strict";
import test from "node:test";
import { createChatDiagnosticRecorder, readChatDiagnosticsOptIn, writeChatDiagnosticsOptIn } from "../lib/diagnostics/chat-first-paint";

test("diagnostic opt-in can use isolated storage for standalone mode", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(readChatDiagnosticsOptIn(storage, "diag"), false);
  writeChatDiagnosticsOptIn(storage, "diag", true);
  assert.equal(readChatDiagnosticsOptIn(storage, "diag"), true);
  writeChatDiagnosticsOptIn(storage, "diag", false);
  assert.equal(readChatDiagnosticsOptIn(storage, "diag"), false);
});

test("diagnostics are silent until explicitly enabled and redact identity and content", () => {
  let now = 10;
  const recorder = createChatDiagnosticRecorder(() => now);
  recorder.record("should-not-appear", { messageCount: 1 });
  assert.equal(recorder.currentNavigation().events.length, 0);
  recorder.setEnabled(true);
  recorder.beginNavigation("/messages/peter-id?token=private", now, "touch");
  recorder.record("navigation-call", { target: "/messages/peter-id?token=private", characterId: "peter-id" });
  now += 3;
  recorder.record("session-publish", { characterId: "peter-id", hasSession: true, messageCount: 2, content: "private text" });
  const output = recorder.exportCurrentNavigation();
  assert.match(output, /user-input-start/);
  assert.match(output, /session-publish/);
  assert.match(output, /character-1/);
  assert.doesNotMatch(output, /peter-id|private text|token=private/);
  assert.ok(output.includes("messages/[character]"));
});

test("events share monotonic navigation time and clear only the active navigation", () => {
  let now = 100;
  const recorder = createChatDiagnosticRecorder(() => now);
  recorder.setEnabled(true);
  recorder.beginNavigation("/contacts/a", now, "touch");
  now = 125;
  recorder.record("contact-ready");
  assert.equal(recorder.currentNavigation().elapsedSinceClickMs, 25);
  assert.equal(recorder.currentNavigation().events.at(-1)?.fromClickMs, 25);
  recorder.beginNavigation("/messages/b", now, "touch");
  assert.equal(recorder.currentNavigation().events.length, 2);
  recorder.clearCurrentNavigation();
  assert.equal(recorder.currentNavigation().events.length, 0);
});
