import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { assembleChatPrompt, emptyMemorySlot } from "../lib/chat/prompt";
import {
  completionUrl,
  openAITextProvider,
  type TextProvider,
} from "../lib/chat/provider";
import {
  DEFAULT_API_CONFIG_ID,
  type ChatMessage,
  type PromptTurn,
} from "../lib/chat/types";
import {
  defaultFoundation,
  normalizeCharacterInput,
} from "../lib/foundation-types";
import { defaultSnapshot } from "../lib/theme-types";
import { exportTheme } from "../lib/theme-package";

function foundation() {
  const document = defaultFoundation();
  document.user.name = "Writer";
  document.user.aboutMe = "User biography";
  document.universe.name = "Harbor";
  document.universe.worldSetting = "Quiet seaside world";
  document.characters = ["a", "b", "c", "d"].map((id) => ({
    characterId: id,
    ...normalizeCharacterInput({
      name: id.toUpperCase(),
      personality: `Personality ${id}`,
      backstory: `Backstory ${id}`,
    }),
  }));
  document.universe.relations = [
    {
      id: "ab",
      characterAId: "a",
      characterBId: "b",
      label: "DIRECT AB",
      aToBContext: "trust",
      bToAContext: "respect",
      sharedHistory: "shared AB",
    },
    {
      id: "bc",
      characterAId: "b",
      characterBId: "c",
      label: "INDIRECT BC",
      aToBContext: null,
      bToAContext: null,
      sharedHistory: null,
    },
    {
      id: "cd",
      characterAId: "c",
      characterBId: "d",
      label: "UNRELATED CD",
      aToBContext: null,
      bToAContext: null,
      sharedHistory: null,
    },
  ];
  return document;
}
const config = {
  id: DEFAULT_API_CONFIG_ID,
  baseUrl: "https://provider.example/v1",
  apiKey: "private-test-key",
  model: "test-model",
};
function create() {
  const factory = new IDBFactory();
  return { factory, storage: new ChatStorage(() => factory) };
}
const message = (i: number, content = `turn-${i}`): ChatMessage => ({
  id: `m-${i}`,
  sessionId: "character:a",
  role: i % 2 ? "assistant" : "user",
  content,
  status: i % 2 ? "complete" : "sent",
  createdAt: i,
  order: i,
});

async function editDatabase(
  factory: IDBFactory,
  edit: (table: IDBObjectStore) => void,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("veil-chat-v1");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    edit(tx.objectStore("messages"));
  });
  db.close();
}

test("Character sessions are unique, reused across clients, and preserve defaults", async () => {
  const { storage, factory } = create();
  const [one, two] = await Promise.all([
    storage.openSession("a"),
    new ChatStorage(() => factory).openSession("a"),
  ]);
  assert.equal(one.id, two.id);
  assert.equal(one.characterId, "a");
  assert.equal(one.autoReplyOnKeyboardDismiss, false);
  assert.equal(one.remark, null);
  assert.notEqual((await storage.openSession("b")).id, one.id);
  assert.equal((await storage.listSessions()).length, 2);
});

test("Send persists separate bubbles without generating; Request Reply consumes the batch once", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.saveApiConfig(config);
  let calls = 0;
  let prompt: PromptTurn[] = [];
  const provider: TextProvider = async function* (_config, messages) {
    calls++;
    prompt = messages;
    yield "Hello ";
    yield "Writer";
  };
  const engine = createChatEngine(storage, async () => foundation(), provider);
  await engine.send(session.id, "first");
  await engine.send(session.id, "second");
  await engine.send(session.id, "third");
  assert.equal(calls, 0);
  assert.deepEqual(
    (await storage.readSession(session.id)).messages.map((m) => m.content),
    ["first", "second", "third"],
  );
  await Promise.all([
    engine.requestReply(session.id),
    engine.requestReply(session.id),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    prompt.slice(1),
    ["first", "second", "third"].map((content) => ({ role: "user", content })),
  );
  assert.equal(await engine.requestReply(session.id), null);
  const reloaded = await new ChatStorage(() => factory).readSession(session.id);
  assert.equal(reloaded.messages.length, 4);
  assert.equal(reloaded.messages[3].content, "Hello Writer");
  assert.equal(reloaded.messages[3].status, "complete");
  assert(
    reloaded.messages
      .slice(0, 3)
      .every((m) => m.requestedBy === reloaded.messages[3].id),
  );
  assert.deepEqual(
    reloaded.messages.map((m) => m.order),
    [1, 2, 3, 4],
  );
  assert.equal(reloaded.session.lastMessagePreview, "Hello Writer");
  const restarted = createChatEngine(
    new ChatStorage(() => factory),
    async () => foundation(),
    provider,
  );
  assert.equal(await restarted.requestReply(session.id), null);
  assert.equal(calls, 1);
});

test("atomic reservation across clients cannot claim the same pending batch twice", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "pending");
  const batches = await Promise.all([
    storage.beginReply(session.id),
    new ChatStorage(() => factory).beginReply(session.id),
  ]);
  assert.equal(batches.filter(Boolean).length, 1);
  assert.equal((await storage.readSession(session.id)).messages.length, 2);
});

test("prompt order includes profiles, only direct relations, and an empty Memory insertion slot", () => {
  const document = foundation();
  const prompt = assembleChatPrompt(document, document.characters[0], [], []);
  assert.deepEqual(
    prompt.sections.map((s) => s.name),
    ["base", "user", "universe", "character", "relations", "memory"],
  );
  const text = prompt.messages[0].content;
  for (const value of [
    "Writer",
    "User biography",
    "Harbor",
    "Quiet seaside world",
    "Personality a",
    "Backstory a",
    "DIRECT AB",
    "shared AB",
  ])
    assert(text.includes(value));
  for (const value of [
    "INDIRECT BC",
    "UNRELATED CD",
    "Personality b",
    "Personality c",
    "Personality d",
  ])
    assert(!text.includes(value));
  assert.deepEqual(emptyMemorySlot(), { entries: [] });
  assert(prompt.sections[5].content.includes("empty"));
  document.characters = document.characters.filter(
    (c) => c.characterId !== "b",
  );
  assert.equal(
    assembleChatPrompt(document, document.characters[0], [], []).sections[4]
      .content,
    "[]",
  );
});

test("context window is bounded and pending, edited or deleted content is never duplicated/stale", () => {
  const document = foundation();
  const history = Array.from({ length: 70 }, (_, i) => message(i));
  const pending = [
    message(70, "pending one"),
    { ...message(71, "pending two"), role: "user" as const },
  ];
  const prompt = assembleChatPrompt(
    document,
    document.characters[0],
    [...history, ...pending],
    pending,
  );
  assert.equal(prompt.messages.length, 43);
  assert(!prompt.messages.some((m) => m.content === "turn-0"));
  assert.equal(
    prompt.messages.filter((m) => m.content === "pending one").length,
    1,
  );
  assert.equal(
    prompt.messages.filter((m) => m.content === "pending two").length,
    1,
  );
  assert.equal(
    assembleChatPrompt(
      document,
      document.characters[0],
      [...history, ...pending],
      [...pending, ...pending],
    ).messages.length,
    43,
  );
  const updated = assembleChatPrompt(
    document,
    document.characters[0],
    [{ ...pending[0], content: "edited" }],
    pending,
  );
  assert.deepEqual(updated.messages.slice(1), [
    { role: "user", content: "edited" },
  ]);
  assert(!JSON.stringify(updated).includes("pending one"));
  assert(!JSON.stringify(updated).includes("pending two"));
});

test("engine loads authoritative message records rather than cached edited/deleted content", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.saveApiConfig(config);
  const first = await storage.send(session.id, "old text");
  const removed = await storage.send(session.id, "deleted text");
  await editDatabase(factory, (table) => {
    table.put({ ...first, content: "new text" });
    table.delete(removed.id);
  });
  let prompt: PromptTurn[] = [];
  const engine = createChatEngine(
    storage,
    async () => foundation(),
    async function* (_config, messages) {
      prompt = messages;
      yield "ok";
    },
  );
  await engine.requestReply(session.id);
  assert.deepEqual(prompt.slice(1), [{ role: "user", content: "new text" }]);
});

test("failed/empty hydration cannot overwrite valid stored chat records", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "keep this history");
  let unavailable = true;
  const failed = new ChatStorage(() => {
    if (unavailable) throw new Error("unavailable");
    return factory;
  });
  await assert.rejects(() => failed.listSessions());
  await assert.rejects(() => failed.send(session.id, "cannot save"));
  unavailable = false;
  assert.deepEqual(
    (await failed.readSession(session.id)).messages.map((m) => m.content),
    ["keep this history"],
  );
  class EmptyHydration extends ChatStorage {
    listSessions() {
      return Promise.resolve([]);
    }
  }
  const empty = new EmptyHydration(() => factory);
  assert.deepEqual(await empty.listSessions(), []);
  assert.equal((await empty.openSession("a")).id, session.id);
  await empty.send(session.id, "append only");
  const reloaded = await new ChatStorage(() => factory).readSession(session.id);
  assert.deepEqual(
    reloaded.messages.map((m) => m.content),
    ["keep this history", "append only"],
  );
});

test("stop preserves streamed content and keeps the claimed batch consumed; new Send remains pending", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.saveApiConfig(config);
  await storage.send(session.id, "first");
  let streamed!: () => void;
  const started = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const engine = createChatEngine(
    storage,
    async () => foundation(),
    async function* (_config, _messages, signal) {
      yield "partial";
      streamed();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  );
  const generating = engine.requestReply(session.id);
  await started;
  await engine.send(session.id, "next batch");
  engine.stop(session.id);
  const stopped = await generating;
  assert.equal(stopped?.status, "cancelled");
  assert.equal(stopped?.content, "partial");
  const messages = (await storage.readSession(session.id)).messages;
  assert(messages[0].requestedBy);
  assert.equal(messages[2].requestedBy, undefined);
  assert.equal(engine.isGenerating(session.id), false);
  const next = createChatEngine(
    storage,
    async () => foundation(),
    async function* () {
      yield "next";
    },
  );
  assert.equal((await next.requestReply(session.id))?.status, "complete");
  assert.equal(await next.requestReply(session.id), null);
});

test("API errors are visible, reserved batches are not retried, and missing config does not consume them", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  let calls = 0;
  const engine = createChatEngine(
    storage,
    async () => foundation(),
    async function* () {
      calls++;
      throw new Error("API request failed (HTTP 401).");
    },
  );
  await assert.rejects(
    () => engine.requestReply(session.id),
    /selected Text API is missing/,
  );
  assert.equal(
    (await storage.readSession(session.id)).messages[0].requestedBy,
    undefined,
  );
  await storage.saveApiConfig(config);
  assert.equal((await engine.requestReply(session.id))?.status, "error");
  assert(
    (await storage.readSession(session.id)).messages[1].error?.includes("401"),
  );
  assert.equal(await engine.requestReply(session.id), null);
  assert.equal(calls, 1);
});

test("API configuration is local/separate, respects binding precedence, and never enters theme/profile/prompt exports", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.saveApiConfig(config);
  const bound = { ...config, id: "character-api", model: "bound-model" };
  await storage.saveApiConfig(bound);
  const document = foundation();
  document.bindings.characters.a = {
    defaults: { apiConfigId: bound.id },
    apps: {},
  };
  let model = "";
  const engine = createChatEngine(
    storage,
    async () => document,
    async function* (config, prompt) {
      model = config.model;
      assert(!JSON.stringify(prompt).includes(config.apiKey));
      yield "ok";
    },
  );
  await engine.send(session.id, "hello");
  await engine.requestReply(session.id);
  assert.equal(model, bound.model);
  const api = await new ChatStorage(() => factory).getApiConfig();
  assert.equal(api?.apiKey, config.apiKey);
  const unrelated = JSON.stringify([
    document,
    defaultSnapshot(),
    exportTheme(defaultSnapshot()),
    await storage.readSession(session.id),
  ]);
  assert(!unrelated.includes(config.apiKey));
  assert(!unrelated.includes("apiKey"));
  document.bindings.characters.a.apps.messages = { apiConfigId: null };
  await engine.send(session.id, "new");
  await assert.rejects(
    () => engine.requestReply(session.id),
    /binding is disabled/,
  );
});

test("OpenAI adapter handles fragmented UTF-8 SSE, ignores reasoning fields, and normalizes endpoint paths", async () => {
  assert.equal(
    completionUrl("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions",
  );
  assert.equal(
    completionUrl("https://provider.example/v1/"),
    "https://provider.example/v1/chat/completions",
  );
  assert.equal(
    completionUrl("https://provider.example/chat/completions"),
    "https://provider.example/chat/completions",
  );
  assert.throws(() => completionUrl("https://key:secret@provider.example/v1"));
  const originalFetch = globalThis.fetch;
  const payload =
    ': heartbeat\r\ndata: {"choices":[{"delta":{"reasoning_content":"not chat text"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"Héllo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(body.stream, true);
    assert.equal(body.model, config.model);
    const bytes = new TextEncoder().encode(payload);
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 3)
            controller.enqueue(bytes.slice(i, i + 3));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    let reply = "";
    for await (const text of openAITextProvider(
      config,
      [{ role: "user", content: "hello" }],
      new AbortController().signal,
    ))
      reply += text;
    assert.equal(reply, "Héllo world");
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "JSON reply" } }] }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    let jsonReply = "";
    for await (const text of openAITextProvider(
      config,
      [],
      new AbortController().signal,
    ))
      jsonReply += text;
    assert.equal(jsonReply, "JSON reply");
    globalThis.fetch = async () =>
      new Response(`gateway echoed ${config.apiKey}`, { status: 401 });
    await assert.rejects(
      async () => {
        for await (const text of openAITextProvider(
          config,
          [],
          new AbortController().signal,
        ))
          void text;
      },
      (e: Error) =>
        e.message.includes("401") && !e.message.includes(config.apiKey),
    );
    globalThis.fetch = async () =>
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    await assert.rejects(async () => {
      for await (const text of openAITextProvider(
        config,
        [],
        new AbortController().signal,
      ))
        void text;
    }, /ended unexpectedly/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
