import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { analyzeSessionCSS } from "../lib/chat/custom-css";
import { ChatStorage } from "../lib/chat/storage";

test("conversation CSS is scoped while root, legacy selectors and containers remain usable", () => {
  const source = `:root { --bubble: pink; }
.chat-bubble-role-user, .chat-input-bar { color: red; }
@media (max-width: 500px) { .chat-bubble-role-assistant { padding: 8px; } }`;
  const scoped = analyzeSessionCSS(source, ".chat-room-wrapper").css;
  assert.match(scoped, /\.chat-room-wrapper \{ --bubble: pink; \}/);
  assert.match(scoped, /\.chat-room-wrapper \.chat-bubble-role-user, \.chat-room-wrapper \.chat-input-bar/);
  assert.match(scoped, /@media \(max-width: 500px\) \{ \.chat-room-wrapper \.chat-bubble-role-assistant/);
  assert.doesNotMatch(scoped, /(^|})\s*\.chat-bubble-role-user\s*[{,]/);
});

test("conversation CSS removes unscoped imports and tolerates empty or malformed input", () => {
  const imported = analyzeSessionCSS('@import url("https://example.test/theme.css");\n.foo{}', ".chat-room-wrapper");
  assert.doesNotMatch(imported.css, /import|example\.test/i);
  assert.match(imported.css, /\.chat-room-wrapper \.foo/);
  assert.match(imported.errors.join(" "), /@import is not supported/);
  assert.equal(analyzeSessionCSS("", ".chat-room-wrapper").css, "");
  assert.doesNotThrow(() => analyzeSessionCSS(".broken { color: red", ".chat-room-wrapper"));
});

test("custom CSS persists and clears independently per conversation", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const peter = await storage.openSession("peter");
  const lan = await storage.openSession("lan");
  const css = ".chat-bubble-role-assistant { color: rebeccapurple; }";
  await storage.updateSessionSettings(peter.id, { customCSS: css });

  const reloaded = new ChatStorage(() => factory);
  assert.equal((await reloaded.readSession(peter.id)).session.customCSS, css);
  assert.equal((await reloaded.readSession(lan.id)).session.customCSS, undefined);
  await reloaded.updateSessionSettings(peter.id, { customCSS: null });
  assert.equal((await reloaded.readSession(peter.id)).session.customCSS, undefined);
  assert.equal((await reloaded.readSession(lan.id)).session.customCSS, undefined);
});
