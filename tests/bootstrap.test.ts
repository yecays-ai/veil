import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createBindingStorage } from "../lib/binding-storage";
import { resolveBindings } from "../lib/bindings";
import { bootstrapCurrentProduct } from "../lib/bootstrap";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { DEFAULT_API_CONFIG_ID } from "../lib/api-config";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { createRegexStorage } from "../lib/regex-storage";
import { createPresetStorage } from "../lib/preset-storage";
import { BUILTIN_PRESET_ID, createBuiltinPreset, createPresetDocument } from "../lib/preset";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { DEFAULT_REGEX_GROUP_ID, defaultRegexGroup } from "../lib/regex-defaults";
import { emptyWorldBookDocument } from "../lib/worldbook";
import type { StringStorage } from "../lib/storage-types";

class MemoryStorage implements StringStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("clean install bootstraps canonical VEIL defaults and immediately supports Messages generation", async () => {
  const memory = new MemoryStorage();
  const presets = createPresetStorage(() => memory);
  const bindings = createBindingStorage(() => memory);
  const regex = createRegexStorage(() => memory);
  await bootstrapCurrentProduct(presets, bindings, regex);

  const presetDocument = await presets.load();
  const preset = presetDocument.presets.find((item) => item.id === BUILTIN_PRESET_ID);
  assert.equal(preset?.name, "VEIL Default");
  const messageBinding = resolveBindings(await bindings.load(), null, "messages");
  assert.equal(messageBinding.presetId, undefined);
  assert((await regex.load()).groups.some((group) => group.id === DEFAULT_REGEX_GROUP_ID));
  assert.deepEqual(emptyWorldBookDocument(), { version: 1, books: [] });

  const api = new ApiConfigStorage(() => new IDBFactory());
  await api.saveApiConfig({ id: DEFAULT_API_CONFIG_ID, name: "Local API", provider: "Custom",
    baseUrl: "https://provider.example/v1", apiKey: "test-key", model: "test-model" });
  await bindings.transact((current) => ({ ...current,
    global: { ...current.global, apiConfigId: DEFAULT_API_CONFIG_ID } }));

  const chat = new ChatStorage(() => new IDBFactory());
  const session = await chat.openSession("peter");
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) }];
  let providerCalls = 0;
  const engine = createChatEngine(chat, async () => foundation, async function* (config, prompt) {
    providerCalls++;
    assert.equal(config.id, DEFAULT_API_CONFIG_ID);
    assert(prompt.some((turn) => turn.content.includes("instant-message text conversation")));
    yield "Ready to chat.";
  }, async () => presets.load(), undefined, undefined, async () => regex.load(),
  async () => bindings.load(), undefined, async (id) => api.getApiConfig(id));
  await engine.send(session.id, "Hi");
  await engine.requestReply(session.id);
  assert.equal(providerCalls, 1);
  assert((await chat.readSession(session.id)).messages.some((message) => message.content === "Ready to chat."));
});

test("startup refreshes VEIL-owned defaults but preserves user Presets, API config and chat history", async () => {
  const memory = new MemoryStorage();
  const stale = createPresetDocument();
  stale.presets[0].prompts.find((prompt) => prompt.identifier === "chat_output_format")!.enabled = false;
  const custom = { ...createBuiltinPreset(), id: "user-preset", name: "My Preset", builtIn: false };
  stale.presets.push(custom);
  stale.activePresetId = custom.id;
  memory.setItem("veil.preset.v1", JSON.stringify(stale));
  const oldDefaultRules = defaultRegexGroup();
  oldDefaultRules.rules[0].replace = "stale rule";
  memory.setItem("veil.regex.v1", JSON.stringify({ version: 1, groups: [oldDefaultRules] }));

  const presets = createPresetStorage(() => memory);
  const bindings = createBindingStorage(() => memory);
  const regex = createRegexStorage(() => memory);
  memory.setItem("veil.worldbooks.v1", JSON.stringify({ version: 1, books: [{ id: "user-book",
    name: "My Lore", description: "", enabled: true, entries: [] }] }));
  const apiFactory = new IDBFactory();
  const api = new ApiConfigStorage(() => apiFactory);
  await api.saveApiConfig({ id: "peter-api", baseUrl: "https://provider.example/v1", apiKey: "kept",
    model: "kept-model" });
  const chatFactory = new IDBFactory();
  const chat = new ChatStorage(() => chatFactory);
  const session = await chat.openSession("peter");
  await chat.send(session.id, "Existing history");

  await bootstrapCurrentProduct(presets, bindings, regex);
  const current = await presets.load();
  assert.deepEqual(current.presets.find((item) => item.id === BUILTIN_PRESET_ID), createBuiltinPreset());
  assert.deepEqual(current.presets.find((item) => item.id === custom.id), custom);
  assert.equal(current.activePresetId, custom.id);
  assert.notEqual((await regex.load()).groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID)?.rules[0].replace,
    "stale rule");
  assert.equal((await api.getApiConfig("peter-api"))?.apiKey, "kept");
  assert.match(memory.getItem("veil.worldbooks.v1") ?? "", /My Lore/);
  assert.deepEqual((await chat.readSession(session.id)).messages.map((message) => message.content), ["Existing history"]);
});

test("startup does not overwrite a user-customized Default Rules group", async () => {
  const memory = new MemoryStorage();
  const customized = defaultRegexGroup();
  customized.updatedAt = 42;
  customized.rules[0].replace = "user choice";
  memory.setItem("veil.regex.v1", JSON.stringify({ version: 1, groups: [customized] }));
  await bootstrapCurrentProduct(createPresetStorage(() => memory), createBindingStorage(() => memory),
    createRegexStorage(() => memory));
  assert.equal((await createRegexStorage(() => memory).load()).groups[0].rules[0].replace, "user choice");
});

test("bootstrap refuses an unreadable Preset document without changing other persisted data", async () => {
  const memory = new MemoryStorage();
  memory.setItem("veil.preset.v1", "{obsolete preset data");
  memory.setItem("veil.bindings.v1", JSON.stringify({
    global: { apiConfigId: "peter-api", presetId: "removed-preset" }, characters: {},
  }));
  const presets = createPresetStorage(() => memory);
  const bindings = createBindingStorage(() => memory);
  const regex = createRegexStorage(() => memory);

  const idb = new IDBFactory();
  const foundationStorage = createIndexedDBFoundationStorage(new IndexedDBDocumentStorage(() => idb));
  const peter = { characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) };
  await foundationStorage.transact((current) => ({ ...current, characters: [peter] }));
  const api = new ApiConfigStorage(() => idb);
  await api.saveApiConfig({ id: "peter-api", name: "Peter API", provider: "Custom",
    baseUrl: "https://provider.example/v1", apiKey: "kept-secret", model: "chat-model" });
  const chat = new ChatStorage(() => idb);
  const session = await chat.openSession(peter.characterId);
  await chat.send(session.id, "Earlier question");
  const firstReply = await chat.beginReply(session.id);
  assert(firstReply);
  await chat.finalizeReply(firstReply.assistant.id, "Earlier answer");
  await chat.send(session.id, "New question after update");
  const before = await chat.readSession(session.id);

  const bindingBefore = memory.getItem("veil.bindings.v1");
  await assert.rejects(bootstrapCurrentProduct(presets, bindings, regex), /could not be read/);

  assert.equal(memory.getItem("veil.preset.v1"), "{obsolete preset data");
  assert.equal(memory.getItem("veil.bindings.v1"), bindingBefore);
  assert.equal(memory.getItem("veil.regex.v1"), null);
  const messageBinding = resolveBindings(await bindings.load(), peter.characterId, "messages");
  assert.equal(messageBinding.presetId, "removed-preset");
  assert.equal(messageBinding.apiConfigId, "peter-api");
  assert.equal((await foundationStorage.load()).characters[0].characterId, peter.characterId);
  assert.deepEqual(await api.getApiConfig("peter-api"), {
    id: "peter-api", name: "Peter API", provider: "Custom",
    baseUrl: "https://provider.example/v1", apiKey: "kept-secret", model: "chat-model",
  });
  assert.deepEqual(await chat.readSession(session.id), before);

});
