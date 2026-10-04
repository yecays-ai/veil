import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { removeCssImports, scopeSessionCSS } from "../lib/chat/custom-css";
import { ChatStorage } from "../lib/chat/storage";

test("conversation CSS is scoped while root, legacy selectors and containers remain usable", () => {
  const source = `:root { --bubble: pink; }
.chat-bubble-role-user, .chat-input-bar { color: red; }
@media (max-width: 500px) { .chat-bubble-role-assistant { padding: 8px; } }`;
  const scoped = scopeSessionCSS(source, ".chat-room-wrapper");
  assert.match(scoped, /\.chat-room-wrapper \{ --bubble: pink; \}/);
  assert.match(scoped, /\.chat-room-wrapper \.chat-bubble-role-user, \.chat-room-wrapper \.chat-input-bar/);
  assert.match(scoped, /@media \(max-width: 500px\) \{ \.chat-room-wrapper \.chat-bubble-role-assistant/);
  assert.doesNotMatch(scoped, /(^|})\s*\.chat-bubble-role-user\s*[{,]/);
});

test("conversation CSS removes unscoped imports and tolerates empty or malformed input", () => {
  assert.equal(removeCssImports('@import url("https://example.test/theme.css");\n.foo{}'), "\n.foo{}");
  assert.equal(scopeSessionCSS("", ".chat-room-wrapper"), "");
  assert.doesNotThrow(() => scopeSessionCSS(".broken { color: red", ".chat-room-wrapper"));
});

test("custom CSS persists per conversation, clears independently and survives backup", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const peter = await storage.openSession("peter");
  const lan = await storage.openSession("lan");
  const css = ".chat-bubble-role-assistant { color: rebeccapurple; }";
  await storage.updateSessionSettings(peter.id, { customCSS: css });

  const reloaded = new ChatStorage(() => factory);
  assert.equal((await reloaded.readSession(peter.id)).session.customCSS, css);
  assert.equal((await reloaded.readSession(lan.id)).session.customCSS, undefined);
  const backup = await reloaded.exportBackup();
  assert.equal(backup.sessions.find((session) => session.id === peter.id)?.customCSS, css);
  const restored = new ChatStorage(() => new IDBFactory());
  await restored.importBackup(backup);
  assert.equal((await restored.readSession(peter.id)).session.customCSS, css);

  await reloaded.updateSessionSettings(peter.id, { customCSS: null });
  assert.equal((await reloaded.readSession(peter.id)).session.customCSS, undefined);
  assert.equal((await reloaded.readSession(lan.id)).session.customCSS, undefined);
});
