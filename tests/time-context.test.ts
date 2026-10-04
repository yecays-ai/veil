import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { buildTimeContext, historyTimestamp } from "../lib/chat/time-context";
import { defaultFoundation, normalizeFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createFoundationStorage } from "../lib/foundation-storage";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { createChatEngine } from "../lib/chat/engine";
import { ChatStorage } from "../lib/chat/storage";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import type { ChatMessage, PromptTurn } from "../lib/chat/types";

const instant = new Date("2026-10-04T13:50:00Z");
function foundation() {
  const document = defaultFoundation();
  document.user.timezone = "Australia/Sydney";
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A", timezone: "America/New_York" }) }];
  return document;
}

test("one instant projects to each person's local date, weekday and clock including DST", () => {
  const context = buildTimeContext(instant, "Australia/Sydney", "America/New_York", "UTC");
  assert.deepEqual(context.user, { date: "2026-10-05", time: "00:50", weekday: "Monday", timezone: "Australia/Sydney" });
  assert.deepEqual(context.character, { date: "2026-10-04", time: "09:50", weekday: "Sunday", timezone: "America/New_York" });
  assert.equal(context.differentDate, true);
  assert.equal(context.differentLocalTime, true);
  assert.match(context.content, /Current instant \(UTC\): 2026-10-04T13:50:00.000Z/);
  assert.equal(buildTimeContext(new Date("2026-01-04T13:50:00Z"), "UTC", "America/New_York").character.time, "08:50");
});

test("timezone authority and missing/invalid fallback are explicit and safe", (context) => {
  assert.equal(buildTimeContext(instant, "Asia/Tokyo", null, "UTC").character.timezone, "Asia/Tokyo");
  assert.equal(buildTimeContext(instant, null, null, "Europe/London").user.timezone, "Europe/London");
  assert.equal(buildTimeContext(instant, "Invalid/Zone", "Bad/Zone", null).character.timezone, "UTC");
  assert.equal(buildTimeContext(instant, "Asia/Tokyo", "America/New_York", "UTC").user.timezone, "Asia/Tokyo");
  context.mock.method(Intl.DateTimeFormat.prototype, "resolvedOptions", () => ({ timeZone: "Asia/Tokyo" }));
  assert.equal(buildTimeContext(instant).user.timezone, "Asia/Tokyo");
});

test("timeAware defaults ON for old documents and persists through existing foundation storage", async () => {
  assert.equal(defaultFoundation().runtime.timeAware, true);
  assert.equal(normalizeFoundation({ version: 1 }).runtime.timeAware, true);
  const values = new Map<string, string>();
  const storage = createFoundationStorage(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  }));
  await storage.transact((document) => ({ ...document, runtime: { timeAware: false } }));
  assert.equal((await storage.load()).runtime.timeAware, false);
});

test("runtime time is independent of Preset markers and history timestamps use User timezone only", () => {
  const document = foundation();
  const message: ChatMessage = { id: "reply", sessionId: "character:a", role: "assistant", status: "complete",
    content: "old reply", createdAt: instant.getTime(), order: 1 };
  const original = structuredClone(message);
  const prompt = assembleChatPrompt(document, document.characters[0], [message], [], undefined, undefined, instant);
  const timestamped = prompt.messages.find((turn) => turn.role === "assistant")!;
  assert.equal(timestamped.content, "[2026-10-05 00:50 Australia/Sydney]\nold reply");
  assert(prompt.messages.findIndex((turn) => turn.content.includes("Current time context:")) < prompt.messages.indexOf(timestamped));
  assert.deepEqual(message, original);
  const preset = createBuiltinPreset();
  preset.promptOrder = [];
  const bare = assembleChatPrompt(document, document.characters[0], [], [], undefined, preset, instant);
  assert.equal(bare.messages[0].role, "system");
  assert.match(bare.messages[0].content, /Character local time:\n2026-10-04 09:50, Sunday/);
  document.runtime.timeAware = false;
  const off = assembleChatPrompt(document, document.characters[0], [message], [], undefined, undefined, instant);
  assert(!JSON.stringify(off).includes("Current time context:"));
  assert.equal(off.messages.find((turn) => turn.role === "assistant")?.content, "old reply");
  assert.equal(historyTimestamp(instant.getTime(), "Australia/Sydney"), "[2026-10-05 00:50 Australia/Sydney]");
});

test("every generation re-reads runtime setting and clock, OFF removes current context and timestamps", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const session = await storage.openSession("a");
  await storage.saveApiConfig({ id: "chat-default", baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  const document = foundation();
  let now = instant;
  const prompts: PromptTurn[][] = [];
  const engine = createChatEngine(storage, async () => structuredClone(document),
    async function* (_config, prompt) { prompts.push(prompt); yield "reply"; },
    async () => createPresetDocument(), () => now);
  await engine.send(session.id, "first"); await engine.requestReply(session.id);
  assert.match(JSON.stringify(prompts[0]), /2026-10-05 00:50, Monday/);
  assert.match(JSON.stringify(prompts[0]), /2026-10-04 09:50, Sunday/);
  now = new Date("2026-10-04T14:50:00Z");
  await engine.send(session.id, "second"); await engine.requestReply(session.id);
  assert.match(JSON.stringify(prompts[1]), /2026-10-05 01:50, Monday/);
  assert(prompts[1].some((turn) => turn.content.endsWith("\nfirst")));
  document.runtime.timeAware = false;
  await engine.send(session.id, "third"); await engine.requestReply(session.id);
  assert(!JSON.stringify(prompts[2]).includes("Current time context:"));
  assert(prompts[2].some((turn) => turn.content === "first"));
});
