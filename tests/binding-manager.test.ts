import { createBindingStorage } from "../lib/binding-storage";
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { APP_REGISTRY, bindingCapableApps } from "../lib/app-registry";
import { cleanStaleBindings, resolveBindings, setBindingField,
  withoutApiConfigBinding, withoutPresetBinding, type BindingDocument } from "../lib/bindings";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine as baseChatEngine } from "../lib/chat/engine";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createBuiltinPreset, createPresetDocument, presetForBinding } from "../lib/preset";
import { createPresetStorage, deletePresetAndBindings } from "../lib/preset-storage";
import { deleteApiConfigAndBindings } from "../lib/settings/text-api";
import { DEFAULT_REGEX_GROUP_ID } from "../lib/regex-defaults";
import { resolveRegexGroups, type RegexDocument } from "../lib/regex";

test("App Registry exposes only binding-capable Apps and supports future capability declarations", () => {
  assert.deepEqual(bindingCapableApps(APP_REGISTRY).map((app) => app.id), ["messages"]);
  assert.deepEqual(bindingCapableApps(APP_REGISTRY)[0].bindingCapabilities,
    ["apiConfigId", "presetId", "worldBookIds", "regexIds"]);
  const extended = [...APP_REGISTRY, { id: "future-chat", label: "Future Chat",
    bindingCapabilities: ["presetId"] as const }];
  assert.deepEqual(bindingCapableApps(extended).map((app) => app.id), ["messages", "future-chat"]);
});

test("Binding edits preserve scalar/list inheritance, ordered replacement and prune empty overrides", () => {
  let bindings: BindingDocument = { global: { apiConfigId: "api-a", presetId: "preset-a",
    worldBookIds: ["book-a", "book-b"], regexIds: ["regex-a", "regex-b"] }, characters: {} };
  bindings = setBindingField(bindings, { characterId: "p" }, "apiConfigId", "api-b");
  bindings = setBindingField(bindings, { characterId: "p" }, "worldBookIds", ["book-b", "book-a"]);
  bindings = setBindingField(bindings, { characterId: "p", appId: "messages" }, "apiConfigId", null);
  bindings = setBindingField(bindings, { characterId: "p", appId: "messages" }, "regexIds", []);
  assert.deepEqual(resolveBindings(bindings, "p", "messages"), {
    apiConfigId: null, presetId: "preset-a", worldBookIds: ["book-b", "book-a"], regexIds: [],
  });
  assert.deepEqual(resolveBindings(bindings, "p", "appearance").regexIds, ["regex-a", "regex-b"]);
  bindings = setBindingField(bindings, { characterId: "p", appId: "messages" }, "apiConfigId", undefined);
  bindings = setBindingField(bindings, { characterId: "p", appId: "messages" }, "regexIds", undefined);
  assert.equal(bindings.characters.p.apps.messages, undefined);
  assert.equal(resolveBindings(bindings, "p", "messages").apiConfigId, "api-b");
  bindings = setBindingField(bindings, { characterId: "p" }, "apiConfigId", undefined);
  bindings = setBindingField(bindings, { characterId: "p" }, "worldBookIds", undefined);
  assert.equal(bindings.characters.p, undefined);
  assert.equal(resolveBindings(bindings, "p", "messages").apiConfigId, "api-a");
});

test("stale IDs are cleaned without materializing inheritance or exposing Default Regex", () => {
  const original: BindingDocument = { global: { apiConfigId: "missing-api", presetId: "missing-preset",
    worldBookIds: ["valid-book", "missing-book"], regexIds: [DEFAULT_REGEX_GROUP_ID, "valid-regex"] },
  characters: { p: { defaults: { presetId: "missing-preset" },
    apps: { messages: { apiConfigId: "missing-api", worldBookIds: ["missing-book"] } } } } };
  const cleaned = cleanStaleBindings(original, {
    apiConfigIds: new Set(["api-a"]), presetIds: new Set(["preset-a"]),
    worldBookIds: new Set(["valid-book"]), regexIds: new Set(["valid-regex"]),
  });
  assert.deepEqual(cleaned.global, { apiConfigId: null, worldBookIds: ["valid-book"], regexIds: ["valid-regex"] });
  assert.deepEqual(cleaned.characters.p.defaults, {});
  assert.deepEqual(cleaned.characters.p.apps.messages, { apiConfigId: null, worldBookIds: [] });
  assert.deepEqual(cleanStaleBindings(cleaned, {
    apiConfigIds: new Set(["api-a"]), presetIds: new Set(["preset-a"]),
    worldBookIds: new Set(["valid-book"]), regexIds: new Set(["valid-regex"]),
  }), cleaned);
  const regex: RegexDocument = { version: 1, groups: [{ id: DEFAULT_REGEX_GROUP_ID, name: "Default Rules",
    description: "", enabled: true, rules: [], createdAt: 0, updatedAt: 0 },
    { id: "valid-regex", name: "Custom", description: "", enabled: true, rules: [], createdAt: 0, updatedAt: 0 }] };
  assert.deepEqual(resolveRegexGroups(regex, [DEFAULT_REGEX_GROUP_ID, "valid-regex"]).map((g) => g.id),
    [DEFAULT_REGEX_GROUP_ID, "valid-regex"]);
  assert(APP_REGISTRY.some((app) => app.id === "messages"));
});

test("Preset binding chooses per-app, per-character and active fallback in real generation", async () => {
  const chat = new ChatStorage(() => new IDBFactory());
  await chat.saveApiConfig({ id: "chat-default", baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  const presetA = { ...createBuiltinPreset(), id: "preset-a", name: "A", builtIn: false,
    prompts: createBuiltinPreset().prompts.map((entry) => entry.identifier === "base" && entry.source === "prompt"
      ? { ...entry, content: "PRESET_A_ONLY" } : entry) };
  const presetB = { ...createBuiltinPreset(), id: "preset-b", name: "B", builtIn: false,
    prompts: createBuiltinPreset().prompts.map((entry) => entry.identifier === "base" && entry.source === "prompt"
      ? { ...entry, content: "PRESET_B_ONLY" } : entry) };
  const library = { ...createPresetDocument(), presets: [createBuiltinPreset(), presetA, presetB],
    activePresetId: "preset-a" };
  const foundation = testFoundation(); foundation.runtime.timeAware = false;
  foundation.characters = [
    { characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) },
    { characterId: "l", ...normalizeCharacterInput({ name: "Lan" }) },
  ];
  bindings = { global: {}, characters: { p: { defaults: { presetId: "preset-b" },
    apps: { messages: { presetId: "preset-a" } } } } };
  const captured: string[] = [];
  const engine = createChatEngine(chat, async () => foundation, async function* (_config, prompt) {
    captured.push(JSON.stringify(prompt)); yield "reply";
  }, async () => library);
  const peter = await chat.openSession("p");
  const lan = await chat.openSession("l");
  async function reply(id: string) { await engine.send(id, "hi"); await engine.requestReply(id); }
  await reply(peter.id); await reply(lan.id);
  bindings = setBindingField(bindings, { characterId: "p", appId: "messages" }, "presetId", undefined);
  await reply(peter.id);
  bindings = setBindingField(bindings, { characterId: "p" }, "presetId", undefined);
  await reply(peter.id);
  bindings = setBindingField(bindings, { characterId: "p" }, "presetId", null);
  await reply(peter.id);
  assert(captured[0].includes("PRESET_A_ONLY"));
  assert(captured[1].includes("PRESET_A_ONLY"));
  assert(captured[2].includes("PRESET_B_ONLY"));
  assert(captured[3].includes("PRESET_A_ONLY"));
  assert(!captured[4].includes("PRESET_A_ONLY") && !captured[4].includes("PRESET_B_ONLY"));
  assert.equal(presetForBinding(library, "missing").id, "preset-a");
});

test("Preset and Text API deletion remove dangling IDs without switching a cleared API", async () => {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const foundation = createBindingStorage(() => backend);
  const presets = createPresetStorage(() => backend);
  const custom = { ...createBuiltinPreset(), id: "custom", name: "Custom", builtIn: false };
  await presets.save({ ...createPresetDocument(), presets: [createBuiltinPreset(), custom], activePresetId: "custom" });
  await foundation.save({ global: { presetId: "custom", apiConfigId: "api-a" },
      characters: { p: { defaults: { presetId: "custom", apiConfigId: "api-a" },
        apps: { messages: { presetId: "custom", apiConfigId: "api-a" } } } } });
  await deletePresetAndBindings("custom", presets, foundation);
  assert.equal((await presets.load()).activePresetId, "veil-default-v1");
  const afterPreset = (await foundation.load());
  assert.equal(afterPreset.global.presetId, undefined);
  assert.equal(afterPreset.characters.p.apps.messages?.presetId, undefined);
  const chat = new ChatStorage(() => new IDBFactory());
  await chat.saveApiConfig({ id: "api-a", baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  await deleteApiConfigAndBindings("api-a", chat, foundation);
  const afterApi = (await foundation.load());
  assert.equal(afterApi.global.apiConfigId, null);
  assert.equal(afterApi.characters.p.defaults.apiConfigId, null);
  assert.equal(afterApi.characters.p.apps.messages?.apiConfigId, null);
  assert.equal(await chat.getApiConfig("api-a"), undefined);
  assert.deepEqual(withoutApiConfigBinding({ global: { apiConfigId: "other" }, characters: {} }, "api-a").global,
    { apiConfigId: "other" });
  assert.deepEqual(withoutPresetBinding({ global: { presetId: "other" }, characters: {} }, "custom").global,
    { presetId: "other" });
});

test("failed cross-store cleanup restores a deleted Preset or Text API", async () => {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const presets = createPresetStorage(() => backend);
  const custom = { ...createBuiltinPreset(), id: "custom", name: "Custom", builtIn: false };
  await presets.save({ ...createPresetDocument(), presets: [createBuiltinPreset(), custom], activePresetId: "custom" });
  const failing = { transact: async () => { throw new Error("Foundation unavailable"); } };
  await assert.rejects(() => deletePresetAndBindings("custom", presets, failing), /Foundation unavailable/);
  assert((await presets.load()).presets.some((preset) => preset.id === "custom"));
  const chat = new ChatStorage(() => new IDBFactory());
  await chat.saveApiConfig({ id: "api-a", baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });
  await assert.rejects(() => deleteApiConfigAndBindings("api-a", chat, failing), /Foundation unavailable/);
  assert(await chat.getApiConfig("api-a"));
});

let bindings: BindingDocument = { global: {}, characters: {} };
function testFoundation() { bindings = { global: {}, characters: {} }; return defaultFoundation(); }
function createChatEngine(...args: Parameters<typeof baseChatEngine>) { args[7] = async () => bindings; return baseChatEngine(...args); }
