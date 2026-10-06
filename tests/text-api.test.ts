import type { BindingDocument } from "../lib/bindings";
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { DEFAULT_API_CONFIG_ID, type NamedApiConfig } from "../lib/api-config";
import {
  defaultFoundation,
  normalizeCharacterInput,
} from "../lib/foundation-types";
import { createChatEngine as baseChatEngine } from "../lib/chat/engine";
import { resolveBindings } from "../lib/bindings";
import {
  apiConfigReferences,
  modelsUrl,
  testTextApiConnection,
  fetchTextApiModels,
} from "../lib/settings/text-api";
const config: NamedApiConfig = {
  id: DEFAULT_API_CONFIG_ID,
  name: "DeepSeek",
  provider: "Custom",
  baseUrl: "https://api.example/v1",
  apiKey: "fake-test-secret",
  model: "chat",
};

test("named config CRUD preserves multiple stable resources and independent credentials", async () => {
  const factory = new IDBFactory(),
    store = new ApiConfigStorage(() => factory);
  const second = {
    ...config,
    id: "second",
    name: "Secondary API",
    model: "other",
    apiKey: "fake-other-key",
  };
  await store.saveApiConfig(config);
  await store.saveApiConfig(second);
  await store.saveApiConfig({ ...config, name: "Renamed" });
  assert.equal((await store.listApiConfigs()).length, 2);
  assert.equal((await store.getApiConfig(DEFAULT_API_CONFIG_ID))?.name, "Renamed");
  assert.deepEqual(await store.getApiConfig("second"), second);
  await store.deleteApiConfig(DEFAULT_API_CONFIG_ID);
  assert.equal(await store.getApiConfig(DEFAULT_API_CONFIG_ID), undefined);
  assert.deepEqual(await new ApiConfigStorage(() => factory).listApiConfigs(), [
    second,
  ]);
});

test("deletion retains references and chat fails closed instead of picking a different provider", async () => {
  const factory = new IDBFactory();
  const store = new ChatStorage(() => factory);
  const api = new ApiConfigStorage(() => factory);
  const document = testFoundation();
  document.characters = [
    { characterId: "a", ...normalizeCharacterInput({ name: "A" }) },
  ];
  bindings = {
    global: { apiConfigId: "second" },
    characters: {
      a: {
        defaults: { apiConfigId: config.id },
        apps: { messages: { apiConfigId: config.id } },
      },
    },
  };
  assert.equal(apiConfigReferences(bindings, config.id).length, 2);
  await api.saveApiConfig(config);
  await api.saveApiConfig({ ...config, id: "second" });
  const session = await store.openSession("a");
  let calls = 0;
  apiLoader = (id) => api.getApiConfig(id);
  const engine = createChatEngine(
    store,
    async () => document,
    async function* (selected) {
      calls++;
      assert.equal(selected.id, config.id);
      yield "Reply";
    },
  );
  await engine.send(session.id, "First");
  await engine.requestReply(session.id);
  assert.equal(calls, 1);
  await api.deleteApiConfig(config.id);
  assert.equal(
    resolveBindings(bindings, "a", "messages").apiConfigId,
    config.id,
  );
  await engine.send(session.id, "Second");
  await assert.rejects(
    engine.requestReply(session.id),
    /selected Text API is missing/,
  );
  assert.equal(calls, 1);
  assert.equal(
    (await store.readSession(session.id)).messages.filter(
      (m) => m.role === "user" && !m.requestedBy,
    ).length,
    1,
  );
  bindings.characters.a.apps.messages = { apiConfigId: null };
  await assert.rejects(engine.requestReply(session.id), /disabled/);
});

test("Test Connection success/failure is independent of saving, capped and credential-safe", async () => {
  const original = globalThis.fetch;
  const store = new ApiConfigStorage(() => new IDBFactory());
  await store.saveApiConfig(config);
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, false);
      assert.equal(body.max_tokens, 64);
      assert.equal(body.messages.length, 1);
      return Response.json({ choices: [{ message: { content: "OK" } }] });
    };
    await testTextApiConnection({ ...config, model: "unsaved" });
    assert.deepEqual(await store.getApiConfig(DEFAULT_API_CONFIG_ID), config);
    globalThis.fetch = async () =>
      Response.json({ error: { message: config.apiKey } }, { status: 401 });
    await assert.rejects(
      testTextApiConnection(config),
      (err) =>
        err instanceof Error &&
        err.message.includes("HTTP 401") &&
        !err.message.includes(config.apiKey),
    );
    globalThis.fetch = async () => {
      throw new Error(config.apiKey);
    };
    await assert.rejects(testTextApiConnection(config), /Could not reach/);
    globalThis.fetch = async () => Response.json({ choices: [] });
    await assert.rejects(testTextApiConnection(config), /no completion/);
    assert.deepEqual(await store.getApiConfig(DEFAULT_API_CONFIG_ID), config);
  } finally {
    globalThis.fetch = original;
  }
});

test("Fetch Models endpoint normalization, selection candidates and failures never change saved data", async () => {
  const original = globalThis.fetch;
  const store = new ApiConfigStorage(() => new IDBFactory());
  await store.saveApiConfig(config);
  assert.equal(
    modelsUrl("https://api.example/v1/chat/completions/"),
    "https://api.example/v1/models",
  );
  assert.equal(modelsUrl("https://api.example"), "https://api.example/models");
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.example/v1/models");
      assert.equal(init?.method, "GET");
      return Response.json({
        data: [
          { id: "b" },
          { id: "a" },
          { id: "b" },
          { id: config.apiKey },
          { id: 3 },
        ],
      });
    };
    assert.deepEqual(await fetchTextApiModels({ ...config, model: "" }), [
      "a",
      "b",
    ]);
    globalThis.fetch = async () =>
      Response.json({ error: config.apiKey }, { status: 404 });
    await assert.rejects(fetchTextApiModels(config), /HTTP 404/);
    globalThis.fetch = async () => Response.json({ models: [] });
    await assert.rejects(fetchTextApiModels(config), /Enter a model manually/);
    globalThis.fetch = async () => new Response("not json");
    await assert.rejects(fetchTextApiModels(config), /invalid JSON/);
    assert.deepEqual(await store.getApiConfig(DEFAULT_API_CONFIG_ID), config);
  } finally {
    globalThis.fetch = original;
  }
});

let bindings: BindingDocument = { global: {}, characters: {} };
let apiLoader: (id: string) => Promise<NamedApiConfig | undefined> = async () => undefined;
function testFoundation() { bindings = { global: {}, characters: {} }; return defaultFoundation(); }
function createChatEngine(...args: Parameters<typeof baseChatEngine>) {
  args[7] = async () => bindings;
  args[9] = apiLoader;
  return baseChatEngine(...args);
}
