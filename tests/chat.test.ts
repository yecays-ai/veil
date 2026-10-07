import type { BindingDocument } from "../lib/bindings";
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";
import { createChatEngine as baseChatEngine } from "./chat-engine-fixture";
import { assembleChatPrompt, emptyMemorySlot } from "../lib/chat/prompt";
import {
  completionUrl,
  openAITextProvider,
  type TextProvider,
} from "../lib/chat/provider";
import { completionStartSummary, parseCompletionUsage, promptSummary } from "../lib/chat/request-diagnostics";
import {
  type ChatMessage,
  type PromptTurn,
} from "../lib/chat/types";
import { DEFAULT_API_CONFIG_ID } from "../lib/api-config";
import {
  defaultFoundation,
  normalizeCharacterInput,
} from "../lib/foundation-types";
import { defaultSnapshot } from "../lib/theme-types";
import { exportTheme } from "../lib/theme-package";
import { withDefaultRegexGroup } from "../lib/regex-defaults";

function foundation() {
  const document = testFoundation();
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
    const req = factory.open(CHAT_DATABASE_NAME);
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
  assert.notEqual((await storage.openSession("b")).id, one.id);
  assert.equal((await storage.listSessions()).length, 2);
});

test("Send persists separate bubbles without generating; Request Reply consumes the batch once", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  let calls = 0;
  let source = "";
  let prompt: PromptTurn[] = [];
  const provider: TextProvider = async function* (_config, messages, _signal, _generation, request) {
    calls++;
    source = request?.source ?? "";
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
  const overlapping = await Promise.allSettled([
    engine.requestReply(session.id),
    engine.requestReply(session.id),
  ]);
  assert.equal(overlapping.filter((result) => result.status === "rejected").length, 1);
  assert.equal(calls, 1);
  assert.equal(source, "manual-reply");
  assert.deepEqual(
    prompt.filter((turn) => turn.role === "user" || turn.role === "assistant"),
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
  const batches = await Promise.allSettled([
    storage.beginReply(session.id),
    new ChatStorage(() => factory).beginReply(session.id),
  ]);
  assert.equal(batches.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(batches.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await storage.readSession(session.id)).messages.length, 2);
});

test("two Chat engines in separate tabs can only invoke one completion for the same pending batch", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "one pending message");
  let calls = 0;
  const provider: TextProvider = async function* () { calls++; yield "one reply"; };
  const first = createChatEngine(storage, async () => foundation(), provider);
  const second = createChatEngine(new ChatStorage(() => factory), async () => foundation(), provider);
  const attempts = await Promise.allSettled([first.requestReply(session.id), second.requestReply(session.id)]);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.equal(calls, 1);
  assert.equal((await storage.readSession(session.id)).messages.filter((item) => item.role === "assistant").length, 1);
});

test("one streamed generation finalizes atomically as ordered assistant bubbles and history uses only parts", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "first question");
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const streaming = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  let secondPrompt: PromptTurn[] = [];
  const engine = createChatEngine(storage, async () => foundation(), async function* (_config, prompt) {
    calls++;
    if (calls === 1) {
      yield "Bugs. BUGS.\n\n";
      started();
      await gate;
      yield "Lan, I'm literally the guy for this.\n\nWhat language?";
    } else {
      secondPrompt = prompt;
      yield "next reply";
    }
  });
  const generation = engine.requestReply(session.id);
  await streaming;
  const during = await storage.readSession(session.id);
  assert.equal(during.messages.filter((message) => message.role === "assistant").length, 1);
  assert.equal(during.messages.at(-1)?.status, "streaming");
  await assert.rejects(engine.send(session.id, "sent while streaming"), /in progress/);
  release();
  await generation;
  assert.equal(calls, 1);
  const finalized = await storage.readSession(session.id);
  const replies = finalized.messages.filter((message) => message.role === "assistant");
  assert.deepEqual(replies.map((message) => message.content), [
    "Bugs. BUGS.",
    "Lan, I'm literally the guy for this.",
    "What language?",
  ]);
  assert.equal(new Set(replies.map((message) => message.id)).size, 3);
  assert.deepEqual(finalized.messages.map((message) => message.order), [1, 2, 3, 4]);
  assert.equal(finalized.messages[0].requestedBy, replies[0].id);
  assert.equal(finalized.messages.at(-1)?.content, "What language?");
  await engine.send(session.id, "sent while streaming");
  await engine.requestReply(session.id);
  assert.equal(calls, 2);
  for (const part of replies)
    assert.equal(secondPrompt.filter((turn) => turn.content.endsWith(`\n${part.content}`)).length, 1);
  assert(!secondPrompt.some((turn) => turn.content.includes("Bugs. BUGS.\n\nLan")));
  assert.equal(secondPrompt.filter((turn) => turn.content === "sent while streaming").length, 1);
});

test("multi-bubble finalization updates session order and preview to the last part", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "question");
  const batch = await storage.beginReply(session.id);
  assert(batch);
  await storage.updateReply(batch.assistant.id, { content: "one\n\ntwo", status: "streaming" });
  const parts = await storage.finalizeReply(batch.assistant.id, "one\n\ntwo");
  assert.equal(parts.length, 2);
  const saved = await storage.readSession(session.id);
  assert.equal(saved.session.nextOrder, 4);
  assert.equal(saved.session.lastMessageId, parts[1].id);
  assert.equal(saved.session.lastMessagePreview, "two");
  assert.deepEqual(saved.messages.map((message) => message.content), ["question", "one", "two"]);
});

test("stored transforms cannot persist empty assistant bubbles", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "question");
  const batch = await storage.beginReply(session.id);
  assert(batch);
  const parts = await storage.finalizeReply(batch.assistant.id,
    "normal reply\n\nremove me\n\nsecond reply", undefined,
    (part) => part === "remove me" ? "  \n " : part);
  assert.deepEqual(parts.map((message) => message.content), ["normal reply", "second reply"]);
  const saved = await storage.readSession(session.id);
  assert.deepEqual(saved.messages.map((message) => message.content),
    ["question", "normal reply", "second reply"]);
});

test("literal Blank separator artifacts are split away before stored Regex and persistence", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  const raw = "First paragraph\n\nBlank\n\nSecond paragraph\n\nBlank\n\nThird paragraph";
  const defaults = withDefaultRegexGroup([]);
  assert(defaults[0].rules.every((rule) => rule.mode === "display"));
  const engine = createChatEngine(storage, async () => foundation(), async function* () { yield raw; },
    undefined, undefined, undefined, async () => ({ version: 1, groups: defaults }));
  await engine.send(session.id, "Continue.");

  const first = await engine.requestReply(session.id);
  const saved = (await storage.readSession(session.id)).messages;

  assert.equal(first?.content, "First paragraph");
  assert.deepEqual(saved.slice(1).map((item) => item.content), [
    "First paragraph", "Second paragraph", "Third paragraph",
  ]);
  assert(saved.slice(1).every((item) => item.content.toLowerCase() !== "blank"));
});

test("message maintenance edits storage and deletion repairs order, preview and reply claims", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  const user = await storage.send(session.id, "original");
  const batch = await storage.beginReply(session.id);
  assert(batch);
  const replies = await storage.finalizeReply(batch.assistant.id, "one\n\ntwo");
  await storage.editMessage(user.id, "edited");
  await storage.deleteMessages(session.id, [replies[0].id]);
  const saved = await storage.readSession(session.id);
  assert.deepEqual(saved.messages.map((message) => message.content), ["edited", "two"]);
  assert.deepEqual(saved.messages.map((message) => message.order), [1, 2]);
  assert.equal(saved.messages[0].requestedBy, undefined);
  assert.equal(saved.messages[0].status, "complete");
  assert.equal(saved.session.lastMessageId, replies[1].id);
  assert.equal(saved.session.lastMessagePreview, "two");
  assert.equal(await storage.beginReply(session.id), null);
  const prompt = assembleChatPrompt(foundation(), foundation().characters[0], saved.messages, []);
  assert(prompt.messages.some((message) => message.content.endsWith("\nedited")));
  assert(!prompt.messages.some((message) => message.content.endsWith("\none")));
});

test("batch delete uses the full stored timeline and clear only resets the target conversation", async () => {
  const { storage } = create();
  const first = await storage.openSession("a");
  const second = await storage.openSession("b");
  const messages = await Promise.all(["a", "b", "c"].map((text) => storage.send(first.id, text)));
  await storage.send(second.id, "keep");
  assert.equal(await storage.deleteMessages(first.id, [messages[0].id, messages[2].id]), 2);
  assert.deepEqual((await storage.readSession(first.id)).messages.map((message) => message.content), ["b"]);
  assert.equal(await storage.clearSession(first.id), 1);
  const cleared = await storage.readSession(first.id);
  assert.equal(cleared.messages.length, 0);
  assert.equal(cleared.session.nextOrder, 1);
  assert.deepEqual((await storage.readSession(second.id)).messages.map((message) => message.content), ["keep"]);
});

test("ordinary maintenance rejects streaming messages atomically", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "question");
  const batch = await storage.beginReply(session.id);
  assert(batch);
  await assert.rejects(() => storage.editMessage(batch.assistant.id, "changed"), /in progress/);
  await assert.rejects(() => storage.deleteMessages(session.id, [batch.assistant.id]), /in progress/);
  assert.equal((await storage.readSession(session.id)).messages.length, 2);
});

test("default prompt includes profiles and only direct relations while empty Memory is skipped", () => {
  const document = foundation();
  const prompt = assembleChatPrompt(document, document.characters[0], [], []);
  assert.deepEqual(
    prompt.sections.map((s) => s.identifier),
    ["base", "user", "universe", "character", "relations", "chat_output_format"],
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
  assert(!prompt.sections.some((section) => section.identifier === "memory"));
  document.characters = document.characters.filter(
    (c) => c.characterId !== "b",
  );
  assert.equal(
    assembleChatPrompt(document, document.characters[0], [], []).sections[4]
      .content,
    "[]",
  );
});

test("prompt cache order is stable sections, bounded history, runtime facts and pending input", () => {
  const document = foundation();
  const history = [
    { ...message(1, "PRIVATE_HISTORY_BODY"), role: "user" as const, status: "sent" as const },
    { ...message(2, "private assistant history"), role: "assistant" as const, status: "complete" as const },
  ];
  const pending = { ...message(3, "PRIVATE_PENDING_BODY"), role: "user" as const, status: "sent" as const };
  const prompt = assembleChatPrompt(document, document.characters[0], [...history, pending], [pending]);
  const stableIndex = prompt.messages.findIndex((turn) => turn.role === "system" && turn.content.includes("Speak as the Character"));
  const historyIndex = prompt.messages.findIndex((turn) => turn.content.includes("PRIVATE_HISTORY_BODY"));
  const runtimeIndex = prompt.messages.findIndex((turn) => turn.role === "system" && turn.content.includes("Current time context:"));
  const pendingIndex = prompt.messages.findIndex((turn) => turn.content.includes("PRIVATE_PENDING_BODY"));
  assert.ok(stableIndex >= 0 && stableIndex < historyIndex);
  assert.ok(historyIndex < runtimeIndex && runtimeIndex < pendingIndex);
  assert.equal(prompt.messages.filter((turn) => turn.content.includes("PRIVATE_PENDING_BODY")).length, 1);
});

test("development prompt summaries expose section sizes but never prompt bodies or credentials", () => {
  const document = foundation();
  const body = "SECRET_CHAT_BODY_SHOULD_NEVER_BE_LOGGED";
  const pending = { ...message(2, body), role: "user" as const, status: "sent" as const };
  const prompt = assembleChatPrompt(document, document.characters[0], [message(1, body), pending], [pending]);
  const request = { requestId: "request-safe-id", source: "manual-reply" as const, sessionId: "character:peter" };
  const start = completionStartSummary(request, "deepseek-flash", prompt.messages, true, "2026-10-06T00:00:00.000Z");
  const summary = promptSummary(request, "deepseek-flash", prompt.diagnostics, prompt.messages);
  const privateApiKey = "PRIVATE_API_KEY";
  const serialized = JSON.stringify({ start, summary });
  assert(!serialized.includes(body));
  assert(!serialized.includes(privateApiKey));
  assert(!serialized.includes("character:peter"));
  assert.equal(start.source, "manual-reply");
  assert.equal(start.stream, true);
  assert.equal(summary.totalMessageCount, prompt.messages.length);
  assert(summary.sections.some((section) => section.identifier === "history"));
  assert(summary.sections.some((section) => section.identifier === "runtime" && section.role === "system"));
  assert(summary.sections.some((section) => section.identifier === "pending" && section.role === "user"));
});

test("completion usage parser supports DeepSeek cache fields, partial usage and absent usage", () => {
  assert.deepEqual(parseCompletionUsage({ usage: {
    prompt_tokens: 120, completion_tokens: 8, total_tokens: 128,
    prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 80,
  } }), {
    prompt_tokens: 120, completion_tokens: 8, total_tokens: 128,
    prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 80,
  });
  assert.deepEqual(parseCompletionUsage({ usage: { prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } } }), {
    prompt_tokens: 5, completion_tokens: null, total_tokens: null,
    prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: null,
  });
  assert.equal(parseCompletionUsage({ choices: [] }), null);
  assert.equal(parseCompletionUsage({ usage: null }), null);
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
  assert.equal(prompt.messages.length, 44);
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
    44,
  );
  const updated = assembleChatPrompt(
    document,
    document.characters[0],
    [{ ...pending[0], content: "edited" }],
    pending,
  );
  assert.deepEqual(updated.messages.filter((turn) => turn.role === "user" || turn.role === "assistant"), [
    { role: "user", content: "edited" },
  ]);
  assert(!JSON.stringify(updated).includes("pending one"));
  assert(!JSON.stringify(updated).includes("pending two"));
});

test("engine loads authoritative message records rather than cached edited/deleted content", async () => {
  const { storage, factory } = create();
  const session = await storage.openSession("a");
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
  assert.deepEqual(prompt.filter((turn) => turn.role === "user" || turn.role === "assistant"),
    [{ role: "user", content: "new text" }]);
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
  await storage.send(session.id, "first");
  let streamed!: () => void;
  const started = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const engine = createChatEngine(
    storage,
    async () => foundation(),
    async function* (_config, _messages, signal) {
      yield "first part\n\nsecond part";
      streamed();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    },
  );
  const generating = engine.requestReply(session.id);
  await started;
  await assert.rejects(engine.send(session.id, "next batch"), /in progress/);
  engine.stop(session.id);
  const stopped = await generating;
  await engine.send(session.id, "next batch");
  assert.equal(stopped?.status, "cancelled");
  assert.equal(stopped?.content, "first part\n\nsecond part");
  const messages = (await storage.readSession(session.id)).messages;
  assert.equal(messages.filter((message) => message.role === "assistant").length, 1);
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

test("missing API config persists a failed attempt and only explicit retry starts the provider", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  let calls = 0, available = false;
  const engine = createChatEngine(
    storage,
    async () => foundation(),
    async function* () {
      calls++;
      yield "first part\n\nsecond part";
      throw new Error("API request failed (HTTP 401).");
    }, undefined, undefined, undefined, undefined, undefined, undefined,
    async (id) => id === config.id && available ? config : undefined,
  );
  const failed = await engine.requestReply(session.id);
  assert.match(failed?.error ?? "", /selected Text API is missing/);
  assert.ok((await storage.readSession(session.id)).messages[0].requestedBy);
  assert.equal(await engine.requestReply(session.id), null);
  available = true;
  assert.equal((await engine.regenerateMessage(failed!.id))?.status, "error");
  assert.equal((await storage.readSession(session.id)).messages.filter(
    (message) => message.role === "assistant").length, 2);
  assert(
    (await storage.readSession(session.id)).messages.at(-1)?.error?.includes("401"),
  );
  assert.equal(await engine.requestReply(session.id), null);
  assert.equal(calls, 1);
});

test("API configuration is local/separate, respects binding precedence, and never enters theme/profile/prompt exports", async () => {
  const { storage } = create();
  const session = await storage.openSession("a");
  const bound = { ...config, id: "character-api", model: "bound-model" };
  const document = foundation();
  bindings.characters.a = {
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
    }, undefined, undefined, undefined, undefined, undefined, undefined,
    async (id) => id === bound.id ? bound : id === config.id ? config : undefined,
  );
  await engine.send(session.id, "hello");
  await engine.requestReply(session.id);
  assert.equal(model, bound.model);
  const unrelated = JSON.stringify([
    document,
    defaultSnapshot(),
    exportTheme(defaultSnapshot()),
    await storage.readSession(session.id),
  ]);
  assert(!unrelated.includes(config.apiKey));
  assert(!unrelated.includes("apiKey"));
  bindings.characters.a.apps.messages = { apiConfigId: null };
  await engine.send(session.id, "new");
  assert.match((await engine.requestReply(session.id))?.error ?? "", /binding is disabled/);
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
  assert.equal(completionUrl("http://localhost:1234/v1"), "http://localhost:1234/v1/chat/completions");
  assert.equal(completionUrl("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(completionUrl("http://[::1]:1234/v1"), "http://[::1]:1234/v1/chat/completions");
  for (const unsafe of ["http://provider.example/v1", "http://192.168.1.8/v1",
    "https://provider.example/v1?key=x", "https://provider.example/v1#fragment", "ftp://provider.example"]) {
    assert.throws(() => completionUrl(unsafe));
  }
  const originalFetch = globalThis.fetch;
  const payload =
    ': heartbeat\r\ndata: {"choices":[{"delta":{"reasoning_content":"not chat text"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"Héllo"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":19,"completion_tokens":2,"total_tokens":21,"prompt_tokens_details":{"cached_tokens":7},"prompt_cache_hit_tokens":7,"prompt_cache_miss_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.referrerPolicy, "no-referrer");
    const body = JSON.parse(options!.body as string);
    assert.equal(body.stream, true);
    assert.equal(body.model, config.model);
    assert.equal("temperature" in body, false);
    assert.equal("max_tokens" in body, false);
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
    const originalInfo = console.info;
    const originalNodeEnv = process.env.NODE_ENV;
    const logs: { label: unknown; data: unknown }[] = [];
    Object.assign(process.env, { NODE_ENV: "development" });
    console.info = ((label: unknown, data: unknown) => { logs.push({ label, data }); }) as typeof console.info;
    try {
      for await (const text of openAITextProvider(
        config,
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        undefined,
        { requestId: "usage-stream", source: "manual-reply", sessionId: "character:a" },
      )) reply += text;
    } finally {
      console.info = originalInfo;
      if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    }
    assert.equal(reply, "Héllo world");
    const usageLog = logs.find((entry) => entry.label === "[VEIL completion:usage]")?.data as Record<string, unknown>;
    assert.deepEqual(usageLog, { requestId: "usage-stream", source: "manual-reply", prompt_tokens: 19,
      completion_tokens: 2, total_tokens: 21, prompt_cache_hit_tokens: 7, prompt_cache_miss_tokens: 12 });
    const startLog = logs.find((entry) => entry.label === "[VEIL completion:start]")?.data as Record<string, unknown>;
    assert.equal(startLog.messageCount, 1);
    assert.equal(startLog.totalCharacters, "hello".length);
    assert.equal(startLog.sessionIdHash === "character:a", false);
    let configuredBody: Record<string, unknown> = {};
    globalThis.fetch = async (_url, options) => {
      configuredBody = JSON.parse(String(options?.body));
      return Response.json({ choices: [{ message: { content: "configured" } }] });
    };
    for await (const text of openAITextProvider(config, [], new AbortController().signal,
      { temperature: 0.4, maxTokens: 321 })) void text;
    assert.equal(configuredBody.temperature, 0.4);
    assert.equal(configuredBody.max_tokens, 321);
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

test("completed SSE response without usage still returns its reply", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
  try {
    let reply = "";
    for await (const text of openAITextProvider(config, [], new AbortController().signal)) reply += text;
    assert.equal(reply, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

let bindings: BindingDocument = { global: {}, characters: {} };
function testFoundation() { bindings = { global: {}, characters: {} }; return defaultFoundation(); }
function createChatEngine(...args: Parameters<typeof baseChatEngine>) { args[7] = async () => bindings; return baseChatEngine(...args); }
