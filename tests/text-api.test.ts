import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { DEFAULT_API_CONFIG_ID, type NamedApiConfig } from "../lib/chat/types";
import {
  defaultFoundation,
  normalizeCharacterInput,
} from "../lib/foundation-types";
import { createChatEngine } from "../lib/chat/engine";
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

test("legacy default config is readable without rewriting or losing its ID/key", async () => {
  const factory = new IDBFactory();
  const store = new ChatStorage(() => factory);
  await store.listSessions();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("veil-chat-v1", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const legacy = {
    id: DEFAULT_API_CONFIG_ID,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("apiConfigs", "readwrite");
    tx.objectStore("apiConfigs").put(legacy);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const reloaded = new ChatStorage(() => factory);
  assert.deepEqual(await reloaded.getApiConfig(), {
    ...legacy,
    name: "Imported Text API",
    provider: "Custom",
  });
  assert.equal((await reloaded.listApiConfigs()).length, 1);
  const raw = await new Promise((resolve, reject) => {
    const req = db
      .transaction("apiConfigs")
      .objectStore("apiConfigs")
      .get(DEFAULT_API_CONFIG_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  assert.deepEqual(
    raw,
    legacy,
    "read compatibility must not rewrite existing private records",
  );
  db.close();
});

test("named config CRUD preserves multiple stable resources and independent credentials", async () => {
  const factory = new IDBFactory(),
    store = new ChatStorage(() => factory);
  const second = {
    ...config,
    id: "second",
    name: "Custom backup",
    model: "other",
    apiKey: "fake-other-key",
  };
  await store.saveApiConfig(config);
  await store.saveApiConfig(second);
  await store.saveApiConfig({ ...config, name: "Renamed" });
  assert.equal((await store.listApiConfigs()).length, 2);
  assert.equal((await store.getApiConfig())?.name, "Renamed");
  assert.deepEqual(await store.getApiConfig("second"), second);
  await store.deleteApiConfig(DEFAULT_API_CONFIG_ID);
  assert.equal(await store.getApiConfig(), undefined);
  assert.deepEqual(await new ChatStorage(() => factory).listApiConfigs(), [
    second,
  ]);
});

test("deletion retains references and chat fails closed instead of picking a different provider", async () => {
  const store = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation();
  document.characters = [
    { characterId: "a", ...normalizeCharacterInput({ name: "A" }) },
  ];
  document.bindings = {
    global: { apiConfigId: "second" },
    characters: {
      a: {
        defaults: { apiConfigId: config.id },
        apps: { messages: { apiConfigId: config.id } },
      },
    },
  };
  assert.equal(apiConfigReferences(document.bindings, config.id).length, 2);
  await store.saveApiConfig(config);
  await store.saveApiConfig({ ...config, id: "second" });
  const session = await store.openSession("a");
  let calls = 0;
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
  await store.deleteApiConfig(config.id);
  assert.equal(
    resolveBindings(document.bindings, "a", "messages").apiConfigId,
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
  document.bindings.characters.a.apps.messages = { apiConfigId: null };
  await assert.rejects(engine.requestReply(session.id), /disabled/);
});

test("Test Connection success/failure is independent of saving, capped and credential-safe", async () => {
  const original = globalThis.fetch;
  const store = new ChatStorage(() => new IDBFactory());
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
    assert.deepEqual(await store.getApiConfig(), config);
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
    assert.deepEqual(await store.getApiConfig(), config);
  } finally {
    globalThis.fetch = original;
  }
});

test("Fetch Models endpoint normalization, selection candidates and failures never change saved data", async () => {
  const original = globalThis.fetch;
  const store = new ChatStorage(() => new IDBFactory());
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
    assert.deepEqual(await store.getApiConfig(), config);
  } finally {
    globalThis.fetch = original;
  }
});
