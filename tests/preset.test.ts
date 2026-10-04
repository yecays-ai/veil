import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { createChatEngine } from "../lib/chat/engine";
import { ChatStorage } from "../lib/chat/storage";
import { DEFAULT_API_CONFIG_ID, type ChatMessage, type PromptTurn } from "../lib/chat/types";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import {
  CHAT_OUTPUT_FORMAT,
  createBuiltinPreset,
  createPresetDocument,
  validatePresetDocument,
  activePreset,
} from "../lib/preset";
import { copyPreset, updatePreset } from "../lib/preset-library";
import { createPresetStorage } from "../lib/preset-storage";

function foundation() {
  const document = defaultFoundation();
  document.user.name = "Current User";
  document.universe.name = "Current Universe";
  document.characters = [{ characterId: "a",
    ...normalizeCharacterInput({ name: "Current Character" }) }];
  return document;
}
function memoryStorage() {
  const values = new Map<string, string>();
  return { values, storage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } };
}
function chatMessage(id: string, role: ChatMessage["role"], content: string, order: number): ChatMessage {
  return { id, sessionId: "character:a", role, content, order, createdAt: order,
    status: role === "assistant" ? "complete" : "sent" };
}

test("built-in Preset is created once, custom edits persist, and initialization never overwrites them", async () => {
  const memory = memoryStorage();
  const first = createPresetStorage(() => memory.storage);
  let document = await first.load();
  assert.equal(activePreset(document).id, "veil-default-v1");
  assert.equal(activePreset(document).builtIn, true);
  document = copyPreset(document);
  const custom = document.presets.at(-1)!;
  const directive = custom.prompts.find((entry) =>
    entry.identifier === "response-directive");
  assert(directive?.source === "prompt");
  directive.content = "Keep replies concise.";
  await first.save(document);
  const reloaded = await createPresetStorage(() => memory.storage).load();
  assert.deepEqual(reloaded, document);
  assert.equal((await first.load()).presets.at(-1)!.prompts.find((entry) =>
    entry.identifier === "response-directive")?.source, "prompt");
});

test("v1 Preset storage adds chat output format once without overwriting user edits", async () => {
  const memory = memoryStorage();
  const legacy = { version: 1, activePreset: createBuiltinPreset() };
  legacy.activePreset.prompts = legacy.activePreset.prompts.filter((entry) =>
    entry.identifier !== "chat_output_format");
  legacy.activePreset.promptOrder = legacy.activePreset.promptOrder.filter((entry) =>
    entry.identifier !== "chat_output_format");
  const directive = legacy.activePreset.prompts.find((entry) =>
    entry.identifier === "response-directive")!;
  assert(directive.source === "prompt");
  directive.content = "My saved directive";
  memory.storage.setItem("veil.preset.v1", JSON.stringify(legacy));
  const store = createPresetStorage(() => memory.storage);
  const migrated = await store.load();
  assert.equal(migrated.version, 3);
  assert.equal(activePreset(migrated).prompts.filter((entry) =>
    entry.identifier === "chat_output_format").length, 1);
  assert.equal(activePreset(migrated).prompts.find((entry) =>
    entry.identifier === "response-directive")?.source, "prompt");
  assert.equal((activePreset(migrated).prompts.find((entry) =>
    entry.identifier === "response-directive") as { content: string }).content,
  "My saved directive");
  assert(activePreset(migrated).promptOrder.findIndex((entry) =>
    entry.identifier === "history") < activePreset(migrated).promptOrder.findIndex((entry) =>
    entry.identifier === "chat_output_format"));
  assert(activePreset(migrated).promptOrder.findIndex((entry) =>
    entry.identifier === "chat_output_format") < activePreset(migrated).promptOrder.findIndex((entry) =>
    entry.identifier === "response-directive"));
  assert.deepEqual(await store.load(), migrated);
});

test("default chat output format contains only the text multi-bubble protocol", () => {
  const preset = createBuiltinPreset();
  const format = preset.prompts.find((entry) => entry.identifier === "chat_output_format");
  assert(format?.source === "prompt");
  assert.equal(format.content, CHAT_OUTPUT_FORMAT);
  assert(format.content.includes("one blank line"));
  for (const excluded of ["red packet", "transfer", "voice call", "group chat", "sticker"])
    assert(!format.content.toLowerCase().includes(excluded));
});

test("Preset schema separates ordinary content from runtime markers", () => {
  const preset = createBuiltinPreset();
  const marker = preset.prompts.find((entry) => entry.source === "marker")!;
  assert.throws(() => validatePresetDocument({ version: 2, activePreset: {
    ...preset,
    prompts: preset.prompts.map((entry) => entry === marker
      ? { ...entry, content: "duplicated snapshot" } : entry),
  } }), /marker prompt/);
});

test("promptOrder controls runtime order, disabled entries are skipped, and markers stay live", () => {
  const document = foundation();
  const preset = createBuiltinPreset();
  const directive = preset.prompts.find((entry) => entry.identifier === "response-directive")!;
  assert(directive.source === "prompt");
  directive.content = "DIRECTIVE";
  preset.promptOrder = [
    { identifier: "response-directive", enabled: true },
    { identifier: "character", enabled: false },
    { identifier: "user", enabled: true },
  ];
  const first = assembleChatPrompt(document, document.characters[0], [], [], undefined, preset);
  assert(first.messages[0].content.indexOf("DIRECTIVE") <
    first.messages[0].content.indexOf("Current User"));
  assert(!JSON.stringify(first).includes("Current Character"));
  document.user.name = "Updated User";
  const second = assembleChatPrompt(document, document.characters[0], [], [], undefined, preset);
  assert(JSON.stringify(second).includes("Updated User"));
  assert(!JSON.stringify(preset).includes("Updated User"));
});

test("Memory emits no empty turn, Response Directive obeys order, and pending is always last once", () => {
  const document = foundation(), preset = createBuiltinPreset();
  assert(preset.promptOrder.findIndex((entry) => entry.identifier === "history") <
    preset.promptOrder.findIndex((entry) => entry.identifier === "response-directive"));
  const directive = preset.prompts.find((entry) => entry.identifier === "response-directive")!;
  assert(directive.source === "prompt");
  directive.content = "AFTER HISTORY";
  const history = chatMessage("history", "assistant", "OLD REPLY", 1);
  const pending = chatMessage("pending", "user", "NEW MESSAGE", 2);
  const prompt = assembleChatPrompt(document, document.characters[0], [history, pending],
    [pending, pending], undefined, preset);
  assert.equal(prompt.messages.at(-1)?.content, "NEW MESSAGE");
  assert.equal(prompt.messages.filter((turn) => turn.content === "NEW MESSAGE").length, 1);
  assert(prompt.messages.findIndex((turn) => turn.content.endsWith("\nOLD REPLY")) <
    prompt.messages.findIndex((turn) => turn.content.includes("AFTER HISTORY")));
  assert(!prompt.sections.some((section) => section.identifier === "memory"));
  const directiveOrder = preset.promptOrder.find((entry) =>
    entry.identifier === "response-directive")!;
  preset.promptOrder = [directiveOrder, ...preset.promptOrder.filter((entry) =>
    entry !== directiveOrder)];
  const moved = assembleChatPrompt(document, document.characters[0], [history, pending],
    [pending], undefined, preset);
  assert(moved.messages.findIndex((turn) => turn.content.includes("AFTER HISTORY")) <
    moved.messages.findIndex((turn) => turn.content.endsWith("\nOLD REPLY")));
  assert.equal(moved.messages.at(-1)?.content, "NEW MESSAGE");
});

test("the next Request Reply loads edited Response Directive without changing two-stage semantics", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.saveApiConfig({ id: DEFAULT_API_CONFIG_ID, baseUrl: "https://example.test/v1",
    apiKey: "private", model: "model" });
  let preset = copyPreset(createPresetDocument());
  preset.activePresetId = preset.presets.at(-1)!.id;
  const prompts: PromptTurn[][] = [];
  const engine = createChatEngine(storage, async () => foundation(),
    async function* (_config, messages) { prompts.push(messages); yield "reply"; },
    async () => structuredClone(preset));
  await engine.send(session.id, "first");
  assert.equal(prompts.length, 0);
  await engine.requestReply(session.id);
  const edited = structuredClone(activePreset(preset));
  const directive = edited.prompts.find((entry) =>
    entry.identifier === "response-directive")!;
  assert(directive.source === "prompt");
  directive.content = "NEW DIRECTIVE";
  preset = updatePreset(preset, edited);
  await engine.send(session.id, "second");
  await engine.requestReply(session.id);
  assert(!JSON.stringify(prompts[0]).includes("NEW DIRECTIVE"));
  assert(JSON.stringify(prompts[1]).includes("NEW DIRECTIVE"));
  assert.equal(prompts[1].filter((turn) => turn.content === "second").length, 1);
  assert.equal(await engine.requestReply(session.id), null);
});
