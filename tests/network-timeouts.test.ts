import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createOpenAITextProvider } from "../lib/chat/provider";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { emptyRegexDocument } from "../lib/regex";
import { emptyWorldBookDocument } from "../lib/worldbook";
import { WEATHER_ERROR_CACHE_MS, clearWeatherCache, fetchCurrentWeather, loadWeatherState } from "../lib/weather";
import { PLACE_ERROR_CACHE_MS, clearPlaceCache, lookupPlace } from "../lib/place-lookup";
import { ensureHereThereComment, HereThereGenerationOwner } from "../lib/here-there-comment";
import { bindHereThereCharacter } from "../lib/here-there-binding";
import { normalizeDocument } from "../lib/theme-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import { lockOrigin } from "./generation-lock-fixture";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const settled = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => "settled", () => "rejected"), sleep(ms).then(() => "PENDING")]);
const goodWeather = async () => Response.json({ current: { temperature_2m: 7, weather_code: 1, time: "2026-10-08T10:00" } });
const noStop = (signal?: AbortSignal | null) => new Promise<Response>((_resolve, reject) =>
  signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

// ---------- Weather and place lookup ----------

test("a weather request that never answers times out, frees the shared entry and later requests can start again", async () => {
  clearWeatherCache();
  const request = { coordinates: { latitude: 11.1, longitude: 22.2 } };
  let signal: AbortSignal | undefined, lateResolve!: (response: Response) => void;
  const hung = ((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => { lateResolve = resolve; }); }) as unknown as typeof fetch;
  const t0 = Date.now(), at = 1_000_000;
  const first = await fetchCurrentWeather(request, hung, at, 40);
  assert.equal(first.status, "error");
  assert.ok(Date.now() - t0 < 1000, "the caller was released by the deadline");
  assert.equal(signal?.aborted, true, "the request was told to stop");
  // The abandoned request answering late changes nothing.
  lateResolve(await goodWeather());
  await sleep(10);
  assert.equal((await fetchCurrentWeather(request, goodWeather as unknown as typeof fetch, at + 1, 40)).status, "error", "still the short-lived error, not the late answer");
  // After the short error cache a healthy request is sent: the hung one no longer owns the entry.
  let sent = 0;
  const healthy = (async () => { sent++; return goodWeather(); }) as unknown as typeof fetch;
  const later = await fetchCurrentWeather(request, healthy, at + WEATHER_ERROR_CACHE_MS + 1, 40);
  assert.equal(later.status, "ready");
  assert.equal(sent, 1);
});

test("a fetcher that ignores its AbortSignal is still released at the deadline; other coordinates are unaffected", async () => {
  clearWeatherCache();
  const stuck = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const pending = fetchCurrentWeather({ coordinates: { latitude: 5.5, longitude: 6.6 } }, stuck, 5_000_000, 40);
  const other = await fetchCurrentWeather({ coordinates: { latitude: 8.8, longitude: 9.9 } }, goodWeather as unknown as typeof fetch, 5_000_000, 40);
  assert.equal(other.status, "ready");
  assert.equal((await pending).status, "error");
});

test("a caller joining a shared request is released at its own deadline without cancelling the request", async () => {
  clearWeatherCache();
  clearPlaceCache();
  let release!: (response: Response) => void, aborted = false;
  const slow = ((_url: string, init?: RequestInit) => { init?.signal?.addEventListener("abort", () => { aborted = true; });
    return new Promise<Response>((resolve) => { release = resolve; }); }) as unknown as typeof fetch;
  const request = { coordinates: { latitude: 31.1, longitude: 32.2 } };
  const owner = fetchCurrentWeather(request, slow, 7_000_000, 400);
  const t0 = Date.now();
  assert.equal((await fetchCurrentWeather(request, slow, 7_000_000, 40)).status, "error");
  assert.ok(Date.now() - t0 < 300, "the joiner left at its own deadline");
  assert.equal(aborted, false, "the shared request kept running");
  release(await goodWeather());
  assert.equal((await owner).status, "ready");
  const place = lookupPlace("Joinville", slow, 7_000_000, 400);
  assert.equal(await lookupPlace("Joinville", slow, 7_000_000, 40), null);
  assert.equal(aborted, false);
  release(Response.json({ results: [{ name: "Joinville", latitude: 1, longitude: 2, country: "X" }] }));
  assert.ok(await place);
});

test("a place lookup that never answers times out and a later lookup starts a new request", async () => {
  clearPlaceCache();
  const stuck = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  assert.equal(await lookupPlace("Nowhere Town", stuck, 7_000_000, 40), null);
  let sent = 0;
  const healthy = (async () => { sent++; return Response.json({ results: [{ name: "Nowhere Town", latitude: 1, longitude: 2 }] }); }) as unknown as typeof fetch;
  const match = await lookupPlace("nowhere town", healthy, 7_000_000 + PLACE_ERROR_CACHE_MS + 1, 40);
  assert.equal(match?.coordinates.latitude, 1);
  assert.equal(sent, 1);
});

test("a named place waits for its lookup and its weather request within one deadline, not two", async () => {
  clearPlaceCache(); clearWeatherCache();
  const stuck = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const t0 = Date.now();
  const state = await loadWeatherState({ label: "Slowville", coordinates: null }, stuck, 9_000_000, 120);
  assert.equal(state.status, "error");
  assert.ok(Date.now() - t0 < 230, `released after about one deadline, took ${Date.now() - t0}ms`);
});

// ---------- Chat generation ----------

async function chatSetup() {
  const factory = new IDBFactory(), origin = lockOrigin();
  const storage = new ChatStorage(() => factory, () => origin.client());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { storage, session, document };
}
const sse = (chunks: string[], stall = false, onCancel?: () => void) => {
  const encoder = new TextEncoder(); let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) { controller.enqueue(encoder.encode(chunks[index++])); return; }
      if (!stall) { controller.close(); return; }
      await new Promise(() => {});
    },
    cancel() { onCancel?.(); },
  }), { headers: { "content-type": "text/event-stream" } });
};
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const finish = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch; globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("a model connection that never answers times out, releases the generation lock and can be regenerated", async () => {
  const { storage, session, document } = await chatSetup();
  const engine = createChatEngine(storage, async () => document, createOpenAITextProvider({ connectMs: 40, idleMs: 1000 }));
  const failed = await withFetch(((_url: string, init?: RequestInit) => noStop(init?.signal)) as unknown as typeof fetch,
    () => engine.requestReply(session.id));
  assert.equal(failed?.outcome, "failed");
  assert.match(failed?.error ?? "", /did not respond in time/);
  assert.equal((await storage.readSession(session.id)).session.generation, undefined, "the lock is free");
  assert.equal(engine.isGenerating(session.id), false);
  const retried = await withFetch((async () => sse([delta("Hello"), finish])) as unknown as typeof fetch,
    () => engine.regenerateMessage(failed!.id, undefined, session.id));
  assert.equal(retried?.content, "Hello");
  assert.equal(retried?.status, "complete");
});

test("a model stream that goes silent mid-reply times out, cancels the stream and frees the lock", async () => {
  const { storage, session, document } = await chatSetup();
  const engine = createChatEngine(storage, async () => document, createOpenAITextProvider({ connectMs: 1000, idleMs: 40 }));
  let cancelled = false;
  const failed = await withFetch((async () => sse([delta("Part")], true, () => { cancelled = true; })) as unknown as typeof fetch,
    () => engine.requestReply(session.id));
  assert.equal(failed?.outcome, "failed");
  assert.match(failed?.error ?? "", /stopped arriving/);
  assert.equal(cancelled, true, "the stalled stream was cancelled");
  assert.equal((await storage.readSession(session.id)).session.generation, undefined);
  const retried = await withFetch((async () => sse([delta("Whole"), finish])) as unknown as typeof fetch,
    () => engine.regenerateMessage(failed!.id, undefined, session.id));
  assert.equal(retried?.content, "Whole");
});

test("a normal stream whose chunks arrive within the idle limit is unchanged", async () => {
  const { storage, session, document } = await chatSetup();
  const engine = createChatEngine(storage, async () => document, createOpenAITextProvider({ connectMs: 200, idleMs: 150 }));
  const slow = (async () => {
    const encoder = new TextEncoder(); const chunks = [delta("One "), delta("two "), delta("three"), finish];
    let index = 0;
    return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
      if (index >= chunks.length) { controller.close(); return; }
      await sleep(40); controller.enqueue(encoder.encode(chunks[index++]));
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const done = await withFetch(slow, () => engine.requestReply(session.id));
  assert.equal(done?.content, "One two three");
  assert.equal(done?.status, "complete");
});

test("Stop still cancels a pending model request at once and the later timeout changes nothing", async () => {
  const { storage, session, document } = await chatSetup();
  const engine = createChatEngine(storage, async () => document, createOpenAITextProvider({ connectMs: 80, idleMs: 1000 }));
  await withFetch(((_url: string, init?: RequestInit) => noStop(init?.signal)) as unknown as typeof fetch, async () => {
    const pending = engine.requestReply(session.id);
    await sleep(20); engine.stop(session.id);
    const stopped = await Promise.race([pending, sleep(1000).then(() => "SLOW" as const)]);
    assert.notEqual(stopped, "SLOW");
    assert.equal((stopped as { outcome?: string } | null)?.outcome, "stopped");
    await sleep(150); // past the connection deadline
    const messages = (await storage.readSession(session.id)).messages;
    assert.equal(messages.filter((m) => m.role === "assistant").length, 1, "no second record from the late timeout");
    assert.equal(messages.find((m) => m.role === "assistant")?.status, "cancelled");
  });
  const cancelled = (await storage.readSession(session.id)).messages.find((m) => m.role === "assistant")!;
  const retried = await withFetch((async () => sse([delta("After stop"), finish])) as unknown as typeof fetch,
    () => engine.regenerateMessage(cancelled.id, undefined, session.id));
  assert.equal(retried?.content, "After stop", "regeneration works after Stop");
});

test("when Weather never answers, Chat gives up on it after the deadline and still replies without weather context", async () => {
  clearWeatherCache(); clearPlaceCache();
  const { storage, session, document } = await chatSetup();
  document.runtime.timeAware = true;
  document.user.location = { label: "Home", coordinates: { latitude: 31.5, longitude: 41.5 } };
  const stuck = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  let prompt = "";
  const engine = createChatEngine(storage, async () => document, async function* (_c, messages) { prompt = JSON.stringify(messages); yield "Still here"; },
    undefined, undefined, async () => emptyWorldBookDocument(), async () => emptyRegexDocument(), async () => ({ global: {}, characters: {} }),
    (target) => loadWeatherState(target, stuck, Date.now(), 60));
  const done = await Promise.race([engine.requestReply(session.id), sleep(3000).then(() => "BLOCKED" as const)]);
  assert.notEqual(done, "BLOCKED", "Chat was not held by the weather request");
  assert.equal((done as { content?: string }).content, "Still here");
  assert.doesNotMatch(prompt, /°C|temperature/i);
  assert.equal((await storage.readSession(session.id)).session.generation, undefined);
});

// ---------- Here & There ----------

function commentFixture(provider: TextProvider) {
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  let theme = normalizeDocument(bindHereThereCharacter(normalizeDocument(null), "here-there-default", "a"));
  const log = { claims: 0, retries: [] as number[], commits: 0, signal: undefined as AbortSignal | undefined };
  const services = { bindings: async () => ({ global: {}, characters: {} }), foundation: async () => foundation, presets: async () => createPresetDocument(),
    api: async (id: string) => ({ id, apiKey: "k", model: "m", baseUrl: "https://example.test/v1" }), settings: async () => ({ hereThereEnabled: true }),
    claimOpportunity: async () => { log.claims++; return 123; },
    scheduleRetry: async (_expected: number, _now: number, delay: number) => { log.retries.push(delay); return true; },
    provider: ((config, messages, signal, ...rest) => { log.signal = signal; return provider(config, messages, signal, ...rest); }) as TextProvider };
  const widget = theme.current.widgets.find((w) => w.type === "here-there")!;
  const commit = async (update: (document: typeof theme) => typeof theme) => { log.commits++; theme = normalizeDocument(update(theme)); };
  const context = (extra: object = {}) => ({ foundation, characterId: "a", now: new Date(),
    hereWeather: { status: "error", message: "x" } as const, thereWeather: { status: "error", message: "x" } as const, ...extra });
  return { services, widget, commit, context, log, theme: () => theme };
}
const abortAware = (onStart?: () => void): TextProvider => async function* (_c, _m, signal) {
  onStart?.();
  await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  yield "never";
};

test("Here & There: when ownership ends the model request is cancelled, nothing is committed and the opportunity is handed back", async () => {
  let started!: () => void; const begun = new Promise<void>((resolve) => { started = resolve; });
  const f = commentFixture(abortAware(() => started()));
  const owner = new HereThereGenerationOwner();
  const run = ensureHereThereComment(f.widget, f.context({ isCurrent: owner.begin(), signal: owner.signal }), f.commit, f.services);
  await begun;
  owner.invalidate(); // unmount, rebind or switching the feature off
  assert.equal(await settled(run, 1000), "settled", "the attempt ends instead of waiting for the model");
  assert.equal(f.log.signal?.aborted, true, "the request itself was cancelled");
  assert.equal(f.log.commits, 0);
  assert.deepEqual(f.log.retries, [5 * 60 * 1000], "the existing short retry, not the 1-5 hour slot");
  assert.equal(f.log.claims, 1);
});

test("Here & There: a failed or timed-out model request keeps the opportunity on the short retry", async () => {
  for (const message of ["provider down", "The API did not respond in time. Try again."]) {
    const f = commentFixture(async function* () { throw new Error(message); });
    await ensureHereThereComment(f.widget, f.context({ isCurrent: () => true }), f.commit, f.services);
    assert.deepEqual(f.log.retries, [5 * 60 * 1000], message);
    assert.equal(f.log.commits, 0);
  }
});

test("Here & There: a remark that finishes after ownership ended is discarded and the opportunity handed back", async () => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = commentFixture(async function* () { await gate; yield "late remark"; }); // a provider that ignores its signal
  let current = true;
  const run = ensureHereThereComment(f.widget, f.context({ isCurrent: () => current }), f.commit, f.services);
  await sleep(10); current = false; release(); await run;
  assert.equal(f.log.commits, 0);
  assert.deepEqual(f.log.retries, [5 * 60 * 1000]);
});

test("Here & There: a normal success commits once and does not touch the 1-5 hour slot", async () => {
  const f = commentFixture(async function* () { yield "Nice weather."; });
  const owner = new HereThereGenerationOwner();
  await ensureHereThereComment(f.widget, f.context({ isCurrent: owner.begin(), signal: owner.signal }), f.commit, f.services);
  assert.equal(f.log.commits, 1);
  assert.deepEqual(f.log.retries, []);
  assert.equal(f.theme().current.widgets.find((w) => w.type === "here-there")?.config.comment?.text, "Nice weather.");
});
