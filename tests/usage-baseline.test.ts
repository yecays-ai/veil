import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAITextProvider } from "../lib/chat/provider";
import { BACKUP_LOCAL_KEYS } from "../lib/backup/static-source";
import { testTextApiConnection } from "../lib/settings/text-api";
import {
  appendUsageBaseline, buildUsageBaselineRecord, clearUsageBaseline, readUsageBaseline, summarizeUsageBaseline,
  USAGE_BASELINE_KEY, USAGE_BASELINE_MAX_RECORDS,
} from "../lib/chat/usage-baseline";

const secret = "sk-secret-key-value";
const config = { id: "c", name: "Private Config Name", provider: "Custom" as const,
  baseUrl: "https://private.example/v1", apiKey: secret, model: "chat-model" };
const prompt = [{ role: "user" as const, content: "private prompt text" }, { role: "assistant" as const, content: "abc" }];
const context = { requestId: "req-1", source: "manual-reply" as const, sessionId: "character:Secret Character" };

function fakeStorage(options: { failWrites?: boolean } = {}) {
  const values = new Map<string, string>(); let writes = 0;
  return { values, get writes() { return writes; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (options.failWrites) throw new Error("QuotaExceededError"); writes++; values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
async function withEnvironment<T>(storage: ReturnType<typeof fakeStorage>, fetcher: typeof fetch, run: () => Promise<T>) {
  const originalFetch = globalThis.fetch, hadWindow = "window" in globalThis;
  let calls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { calls++; return fetcher(...args); }) as typeof fetch;
  Object.assign(globalThis, { window: { localStorage: storage } });
  try { return { value: await run(), calls }; }
  finally { globalThis.fetch = originalFetch; if (!hadWindow) Reflect.deleteProperty(globalThis, "window"); }
}
const sse = (text: string) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } }),
  { headers: { "Content-Type": "text/event-stream" } });
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
async function drain(signal = new AbortController().signal) {
  let text = "";
  for await (const part of createOpenAITextProvider()(config, prompt, signal, undefined, context)) text += part;
  return text;
}

test("a streamed reply with usage and cache fields records exactly one numeric record", async () => {
  const storage = fakeStorage();
  const { value, calls } = await withEnvironment(storage, async () => sse(frame({ choices: [{ delta: { content: "Hi" } }] })
    + frame({ choices: [{ delta: { content: "!" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2,
      total_tokens: 12, prompt_cache_hit_tokens: 6, prompt_cache_miss_tokens: 4 } }) + "data: [DONE]\n\n"), drain);
  assert.equal(value, "Hi!");
  assert.equal(calls, 1);
  const rows = readUsageBaseline(storage);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], at: 0, durationMs: 0 }, { at: 0, source: "manual-reply", outcome: "completed", durationMs: 0,
    model: "chat-model", promptTokens: 10, completionTokens: 2, totalTokens: 12, cacheHitTokens: 6, cacheMissTokens: 4,
    messageCount: 2, totalCharacters: "private prompt text".length + 3 });
});

test("a non-streaming reply and a missing usage object keep unknown values null", async () => {
  const storage = fakeStorage();
  const { value } = await withEnvironment(storage, async () => new Response(JSON.stringify({ choices: [{ message: { content: "Plain" },
    finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } }), drain);
  assert.equal(value, "Plain");
  const [row] = readUsageBaseline(storage);
  assert.equal(readUsageBaseline(storage).length, 1);
  assert.deepEqual([row.promptTokens, row.completionTokens, row.totalTokens, row.cacheHitTokens, row.cacheMissTokens],
    [null, null, null, null, null]);
  assert.equal(summarizeUsageBaseline(readUsageBaseline(storage)).unknownUsageRequests, 1);
});

test("OpenAI-style cached_tokens fills the cache-hit field only", async () => {
  const storage = fakeStorage();
  await withEnvironment(storage, async () => new Response(JSON.stringify({ choices: [{ message: { content: "x" } }],
    usage: { prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } } }), { headers: { "Content-Type": "application/json" } }), drain);
  const [row] = readUsageBaseline(storage);
  assert.equal(row.cacheHitTokens, 3); assert.equal(row.cacheMissTokens, null); assert.equal(row.totalTokens, null);
});

test("failure, cancellation and abandonment each record one row", async () => {
  const storage = fakeStorage();
  await withEnvironment(storage, async () => new Response("secret body", { status: 500 }), () => drain().catch(() => {}));
  const controller = new AbortController();
  await withEnvironment(storage, async (_url, init) => {
    controller.abort();
    throw Object.assign(new Error("aborted"), { name: "AbortError", signal: init?.signal });
  }, () => drain(controller.signal).catch(() => {}));
  await withEnvironment(storage, async () => sse(frame({ choices: [{ delta: { content: "a" } }] })), async () => {
    const iterator = createOpenAITextProvider()(config, prompt, new AbortController().signal, undefined, context)[Symbol.asyncIterator]();
    await iterator.next(); await iterator.return?.(undefined);
  });
  assert.deepEqual(readUsageBaseline(storage).map((row) => row.outcome), ["error", "cancelled", "abandoned"]);
  assert.equal(summarizeUsageBaseline(readUsageBaseline(storage)).failed, 1);
  assert.equal(summarizeUsageBaseline(readUsageBaseline(storage)).cancelled, 1);
});

test("test-connection records one non-streaming row with its source", async () => {
  const storage = fakeStorage();
  await withEnvironment(storage, async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }],
    usage: { total_tokens: 9 } }), { headers: { "Content-Type": "application/json" } }), () => testTextApiConnection(config));
  const rows = readUsageBaseline(storage);
  assert.equal(rows.length, 1); assert.equal(rows[0].source, "test-connection"); assert.equal(rows[0].totalTokens, 9);
});

test("storage is bounded to the capacity and cleanup can be repeated", () => {
  const storage = fakeStorage();
  const meta = { model: "m", messages: prompt };
  for (let index = 0; index < USAGE_BASELINE_MAX_RECORDS + 25; index++)
    appendUsageBaseline(buildUsageBaselineRecord(meta, "manual-reply", "completed", index, null, index), storage);
  const rows = readUsageBaseline(storage);
  assert.equal(rows.length, USAGE_BASELINE_MAX_RECORDS);
  assert.equal(rows[0].at, 25);
  clearUsageBaseline(storage); clearUsageBaseline(storage);
  assert.deepEqual(readUsageBaseline(storage), []);
});

test("a full or broken store never changes the reply, and damaged data reads as empty", async () => {
  const full = fakeStorage({ failWrites: true });
  const { value } = await withEnvironment(full, async () => sse(frame({ choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }] })), drain);
  assert.equal(value, "Hi");
  const broken = fakeStorage(); broken.values.set(USAGE_BASELINE_KEY, "{not json");
  assert.deepEqual(readUsageBaseline(broken), []);
  broken.values.set(USAGE_BASELINE_KEY, JSON.stringify([{ nope: 1 }, null, "x"]));
  assert.deepEqual(readUsageBaseline(broken), []);
  assert.doesNotThrow(() => appendUsageBaseline(buildUsageBaselineRecord({ model: "m", messages: [] }, "continue", "error", 1, null), undefined));
});

test("stored data holds no prompt, reply, URL, key, or Character/session names", async () => {
  const storage = fakeStorage();
  await withEnvironment(storage, async () => sse(frame({ choices: [{ delta: { content: "private reply text" }, finish_reason: "stop" }] })), drain);
  const raw = storage.values.get(USAGE_BASELINE_KEY) ?? "";
  for (const forbidden of ["private prompt text", "private reply text", "private.example", secret, "Secret Character",
    "Private Config Name", "req-1", "character:"]) assert.ok(!raw.includes(forbidden), forbidden);
  assert.deepEqual(Object.keys(JSON.parse(raw)[0]).sort(), ["at", "cacheHitTokens", "cacheMissTokens", "completionTokens",
    "durationMs", "messageCount", "model", "outcome", "promptTokens", "source", "totalCharacters", "totalTokens"]);
});

test("summary sums known numbers only and reports cost as absent; key is outside the backup domains", () => {
  const meta = { model: "m", messages: prompt };
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 6, prompt_cache_miss_tokens: 4 };
  const summary = summarizeUsageBaseline([
    buildUsageBaselineRecord(meta, "manual-reply", "completed", 100, usage), buildUsageBaselineRecord(meta, "regenerate", "error", 300, null)]);
  assert.equal(summary.requests, 2); assert.equal(summary.totalTokens, 12); assert.equal(summary.unknownUsageRequests, 1);
  assert.equal(summary.averageDurationMs, 200); assert.equal(summary.bySource.regenerate.failed, 1);
  assert.ok(!("cost" in summary));
  assert.ok(!(Object.values(BACKUP_LOCAL_KEYS) as string[]).includes(USAGE_BASELINE_KEY));
});
