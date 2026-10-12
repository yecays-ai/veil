import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createChatEngine } from "./chat-engine-fixture";
import { ChatStorage } from "../lib/chat/storage";
import { assembleChatPrompt, emptyMemorySlot, hasSystemMemorySlot, memoryConversationText } from "../lib/chat/prompt";
import { logPromptSummary, promptSummary } from "../lib/chat/request-diagnostics";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import type { ChatMessage, PromptTurn } from "../lib/chat/types";
import type { TextProvider } from "../lib/chat/provider";
import type { Memory } from "../lib/memory/types";
import { selectMemoryContext } from "../lib/memory/context";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import type { RegexGroup } from "../lib/regex";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";

const row = (characterId = "a", text = "I grow orchids in a greenhouse"): Memory => ({
  id: characterId, characterId, text, fingerprint: memoryFingerprint(text), kind: "fact", subject: "character",
  origin: "manual", status: "active", sources: [], lineage: {}, createdAt: 1, updatedAt: 1,
});
function foundation() {
  const document = defaultFoundation();
  document.characters = ["a", "b"].map((characterId) => ({ characterId, ...normalizeCharacterInput({ name: characterId }) }));
  document.runtime = { ...document.runtime, timeAware: false };
  return document;
}
const message = (id: string, content: string, order: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, content, order, role: "user", status: "sent", sessionId: "s", createdAt: order, ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(load: (id: string) => Promise<readonly Memory[]>, customPreset = createBuiltinPreset()) {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const calls: { messages: readonly PromptTurn[]; source?: string }[] = [];
  const provider: TextProvider = async function* (_config, messages, _signal, _generation, request, finish) {
    calls.push({ messages, source: request?.source });
    yield "A reply";
    finish?.("length");
  };
  const presets = createPresetDocument();
  presets.presets = [customPreset];
  presets.activePresetId = customPreset.id;
  const engine = createChatEngine(storage, async () => foundation(), provider, async () => presets,
    () => new Date(0), undefined, undefined, undefined, undefined, undefined,
    async () => {}, async () => undefined, async () => {}, load);
  return { engine, storage, calls };
}

test("ordinary reply, Regenerate and Continue read only their Character and invoke one provider per attempt", async () => {
  const reads: string[] = [];
  const { engine, storage, calls } = setup(async (id) => { reads.push(id); return [row(), row("b", "Orchids belong to B")]; });
  const session = await storage.openSession("a");
  await engine.send(session.id, "How are your orchids?");
  const first = await engine.requestReply(session.id);
  assert(first);
  const regenerated = await engine.regenerateMessage(first.id);
  assert(regenerated);
  await engine.continueMessage(regenerated.id);
  assert.deepEqual(reads, ["a", "a", "a"]);
  assert.deepEqual(calls.map((call) => call.source), ["manual-reply", "regenerate", "continue"]);
  for (const call of calls) {
    const memory = call.messages.filter((turn) => turn.content.includes(row().text));
    assert.equal(memory.length, 1);
    assert.equal(memory[0].role, "system");
    assert(!JSON.stringify(call.messages).includes("Orchids belong to B"));
  }
});

test("read rejection and synchronous failure degrade with exactly one read and one normal provider request", async () => {
  for (const synchronous of [false, true]) {
    let reads = 0;
    const { engine, storage, calls } = setup(() => {
      reads++;
      if (synchronous) throw new Error("secret memory body");
      return Promise.reject(new Error("secret memory body"));
    });
    const session = await storage.openSession("a");
    await engine.send(session.id, "orchids");
    assert(await engine.requestReply(session.id));
    assert.equal(reads, 1);
    assert.equal(calls.length, 1);
    assert(!JSON.stringify(calls).includes("secret memory body"));
  }
});

test("Stop settles while Memory is pending; late success and rejection cannot start a provider", async () => {
  for (const reject of [false, true]) {
    const gate = deferred<readonly Memory[]>(), started = deferred<void>();
    const { engine, storage, calls } = setup(() => { started.resolve(); return gate.promise; });
    const session = await storage.openSession("a");
    await engine.send(session.id, "orchids");
    const pending = engine.requestReply(session.id);
    await started.promise;
    engine.stop(session.id);
    await pending;
    if (reject) gate.reject(new Error("late failed read")); else gate.resolve([row()]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal(engine.isGenerating(session.id), false);
  }
});

test("switching from Character A to B via existing lifecycle Stop prevents A's late read from generating", async () => {
  const gate = deferred<readonly Memory[]>(), started = deferred<void>();
  const { engine, storage, calls } = setup((id) => {
    if (id === "a") { started.resolve(); return gate.promise; }
    return Promise.resolve([row("b", "I keep orchids beside the balcony")]);
  });
  const a = await storage.openSession("a"), b = await storage.openSession("b");
  const mounted = deferred<void>();
  const route = createChatSessionLifecycle("a", storage, (snapshot) => { if (snapshot) mounted.resolve(); }, engine.stop);
  route.mount(true);
  await mounted.promise;
  await engine.send(a.id, "orchids");
  const pending = engine.requestReply(a.id);
  await started.promise;
  route.unmount();
  await engine.send(b.id, "orchids");
  await engine.requestReply(b.id);
  gate.resolve([row()]);
  await pending;
  assert.equal(calls.length, 1);
  assert(JSON.stringify(calls[0].messages).includes("balcony"));
  assert(!JSON.stringify(calls[0].messages).includes("greenhouse"));
});

test("ownership lost during Memory read cannot invoke provider even before a subscription abort arrives", async () => {
  const gate = deferred<readonly Memory[]>(), started = deferred<void>();
  const { engine, storage, calls } = setup(() => { started.resolve(); return gate.promise; });
  const session = await storage.openSession("a");
  await engine.send(session.id, "orchids");
  const pending = engine.requestReply(session.id);
  await started.promise;
  const generation = (await storage.readSession(session.id)).session.generation!;
  // Release emits no matching generationChanged abort here; authoritative ownership must still reject it.
  await storage.releaseGeneration(session.id, generation.id);
  gate.resolve([row()]);
  await pending;
  assert.equal(calls.length, 0);
});

test("ownership lost just after provider stage is saved is rechecked before invoking provider", async () => {
  const { engine, storage, calls } = setup(async () => [row()]);
  const stage = storage.generationStage.bind(storage);
  storage.generationStage = async (sessionId, id, value) => {
    await stage(sessionId, id, value);
    if (value === "provider") await storage.releaseGeneration(sessionId, id);
  };
  const session = await storage.openSession("a");
  await engine.send(session.id, "orchids");
  await engine.requestReply(session.id);
  assert.equal(calls.length, 0);
});

test("Memory read overlaps existing self context preparation", async () => {
  const gate = deferred<readonly Memory[]>(), readStarted = deferred<void>(), selfStarted = deferred<void>();
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory);
  let calls = 0;
  const engine = createChatEngine(storage, async () => foundation(), async function* () { calls++; yield "ok"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {},
    async () => { selfStarted.resolve(); return undefined; }, async () => {},
    () => { readStarted.resolve(); return gate.promise; });
  const session = await storage.openSession("a");
  await engine.send(session.id, "orchids");
  const pending = engine.requestReply(session.id);
  await readStarted.promise;
  await selfStarted.promise;
  assert.equal(calls, 0);
  gate.resolve([row()]);
  await pending;
  assert.equal(calls, 1);
});

for (const mode of ["removed", "disabled", "order-disabled", "user-role", "assistant-role"] as const)
  test(`Preset ${mode}: no Memory read and no forced insertion`, async () => {
    const preset = createBuiltinPreset();
    const marker = preset.prompts.find((entry) => entry.source === "marker" && entry.marker === "memory")!;
    if (mode === "removed") preset.prompts = preset.prompts.filter((entry) => entry !== marker);
    if (mode === "disabled") marker.enabled = false;
    if (mode === "order-disabled") preset.promptOrder.find((entry) => entry.identifier === marker.identifier)!.enabled = false;
    if (mode === "user-role") marker.role = "user";
    if (mode === "assistant-role") marker.role = "assistant";
    assert.equal(hasSystemMemorySlot(preset), false);
    let reads = 0;
    const { engine, storage, calls } = setup(async () => { reads++; return [row()]; }, preset);
    const session = await storage.openSession("a");
    await engine.send(session.id, "orchids");
    await engine.requestReply(session.id);
    assert.equal(reads, 0);
    assert.equal(calls.length, 1);
    assert(!JSON.stringify(calls).includes(row().text));
  });

test("only the first effective system memory marker injects, without changing saved Preset", () => {
  const preset = createBuiltinPreset();
  preset.prompts.push({ identifier: "second-memory", name: "Memory", source: "marker", marker: "memory", role: "system", enabled: true });
  preset.promptOrder.push({ identifier: "second-memory", enabled: true });
  const before = structuredClone(preset), document = foundation();
  const assembled = assembleChatPrompt(document, document.characters[0], [], [], { entries: [row().text] }, preset);
  assert.equal(assembled.diagnostics.filter((entry) => entry.identifier.includes("memory")).length, 1);
  assert.equal(assembled.messages.map((turn) => turn.content).join("\n").split(row().text).length - 1, 1);
  assert.deepEqual(preset, before);
});

test("retrieval follows configured 40-message history, pending, edited bodies and Prompt Regex", () => {
  const document = foundation(), character = document.characters[0], preset = createBuiltinPreset();
  const messages = Array.from({ length: 45 }, (_, i) => message(`m${i}`, `topic${i}`, i));
  messages.push(message("pending", "orchids", 50), message("system", "ignored", 51, { role: "system" }),
    message("streaming", "ignored", 52, { role: "assistant", status: "streaming" }));
  const context = { foundation: document, character, currentMessages: messages, pending: [messages[45]], memory: emptyMemorySlot() };
  const bodies = memoryConversationText(context, preset);
  assert.equal(bodies.length, 41);
  assert.equal(bodies[0], "topic5");
  assert.equal(bodies.at(-1), "orchids");
  preset.prompts.find((entry) => entry.source === "marker" && entry.marker === "history")!.enabled = false;
  assert.deepEqual(memoryConversationText(context, preset), ["orchids"]);
  messages[45].content = "garden";
  assert.deepEqual(memoryConversationText(context, preset), ["garden"]);
  const group: RegexGroup = { id: "regex", name: "test", description: "", enabled: true, createdAt: 0, updatedAt: 0,
    rules: [{ id: "replace", name: "replace", enabled: true, find: "garden", replace: "orchids", appliesTo: ["user"], mode: "prompt" }] };
  assert.deepEqual(memoryConversationText({ ...context, regexGroups: [group] }, preset), ["orchids"]);
  assert.deepEqual(selectMemoryContext("a", [row()], memoryConversationText({ ...context, regexGroups: [group] }, preset)).ids, ["a"]);
});

test("development Memory summary contains ids/count/reason only and production does not log", () => {
  const selected = selectMemoryContext("a", [row()], ["orchids"]);
  const summary = promptSummary({ requestId: "req", source: "manual-reply" }, "model", [],
    [{ role: "system", content: row().text }], selected);
  assert.deepEqual(summary.memory, { ids: ["a"], characterLength: selected.characterLength, outcome: "selected" });
  assert(!JSON.stringify(summary).includes(row().text));
  const original = process.env.NODE_ENV, log = console.info;
  const calls: unknown[][] = [];
  console.info = (...args) => { calls.push(args); };
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    logPromptSummary({ requestId: "req", source: "manual-reply" }, "model", [], [], selected);
    assert.equal(calls.length, 0);
    Reflect.set(process.env, "NODE_ENV", "development");
    logPromptSummary({ requestId: "req", source: "manual-reply" }, "model", [], [], selected);
    assert.equal(calls.length, 1);
    assert(!JSON.stringify(calls).includes(row().text));
  } finally {
    if (original === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", original);
    console.info = log;
  }
});
