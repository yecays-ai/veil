import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { resetVoiceSweepForTests, sweepVoiceCache, VoiceCache, voiceAudio, voiceFingerprint } from "../lib/tts/voice-cache";
import type { TtsConfig } from "../lib/tts/config";

const config: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" };
const clip = (size: number, fill = 1) => new Blob([new Uint8Array(size).fill(fill)], { type: "audio/mpeg" });
const fresh = (limit?: number) => new VoiceCache(() => new IDBFactory(), limit);

test("a clip is reused only for the same words, voice, model and service; the key is not part of it", async () => {
  const base = await voiceFingerprint("hello", "nova", config);
  assert.equal(base, await voiceFingerprint("hello", " nova ", config));
  assert.equal(base, await voiceFingerprint("hello", "nova", { ...config, baseUrl: `${config.baseUrl}/` }), "a trailing slash is the same endpoint");
  for (const other of [await voiceFingerprint("hello!", "nova", config), await voiceFingerprint("hello", "echo", config),
    await voiceFingerprint("hello", "nova", { ...config, model: "tts-2" }), await voiceFingerprint("hello", "nova", { ...config, baseUrl: "https://other.test/v1" }),
    await voiceFingerprint("hello", "nova", { ...config, baseUrl: "https://tts.test/other/path" })])
    assert.notEqual(other, base);
});

test("the cache returns a clip for its fingerprint and deletes a stale one", async () => {
  const cache = fresh();
  await cache.put("m1", "fp1", clip(10, 5));
  assert.equal((await cache.get("m1", "fp1"))?.size, 10);
  assert.equal(await cache.get("m1", "fp2"), null, "the words changed");
  assert.equal(await cache.get("m1", "fp1"), null, "and the old clip is gone");
  assert.deepEqual(await cache.keys(), []);
});

test("the cache stays under its size cap by dropping the least recently played clip", async () => {
  const cache = fresh(100);
  await cache.put("a", "f", clip(40)); await new Promise((r) => setTimeout(r, 3));
  await cache.put("b", "f", clip(40)); await new Promise((r) => setTimeout(r, 3));
  await cache.get("a", "f"); await new Promise((r) => setTimeout(r, 3)); // a was played after b
  await cache.put("c", "f", clip(40));
  assert.deepEqual((await cache.keys()).sort(), ["a", "c"]);
  await cache.put("a", "f2", clip(50));
  assert.ok((await cache.keys()).includes("a"), "replacing a clip never evicts itself");
});

test("clips of messages that no longer exist are dropped once per page load", async () => {
  resetVoiceSweepForTests();
  const cache = fresh();
  for (const id of ["keep", "gone", "also-gone"]) await cache.put(id, "f", clip(5));
  let asked = 0;
  const existing = async () => { asked++; return new Set(["keep"]); };
  await sweepVoiceCache(existing, cache);
  assert.deepEqual(await cache.keys(), ["keep"]);
  await sweepVoiceCache(existing, cache);
  assert.equal(asked, 1);
});

test("two taps at once make one request, the clip is then saved and reused, and a failure saves nothing", async () => {
  resetVoiceSweepForTests();
  const cache = fresh();
  let calls = 0, fail = false;
  const synthesize = (async () => { calls++; await new Promise((r) => setTimeout(r, 5)); if (fail) throw new Error("boom"); return clip(8, 9); }) as never;
  const source = { messageId: "m", text: "hello", voice: "nova", config };
  const [a, b] = await Promise.all([voiceAudio(source, cache, { synthesize, locks: undefined }), voiceAudio(source, cache, { synthesize, locks: undefined })]);
  assert.equal(calls, 1);
  assert.equal(a.size, 8); assert.equal(b.size, 8);
  assert.equal((await voiceAudio(source, cache, { synthesize, locks: undefined })).size, 8);
  assert.equal(calls, 1, "a saved clip is reused without another paid request");
  assert.equal((await cache.get("m", await voiceFingerprint("hello", "nova", config)))?.size, 8);
  fail = true;
  await assert.rejects(voiceAudio({ ...source, messageId: "n" }, cache, { synthesize, locks: undefined }), /boom/);
  assert.deepEqual((await cache.keys()).sort(), ["m"]);
  fail = false;
  assert.equal((await voiceAudio({ ...source, messageId: "n" }, cache, { synthesize, locks: undefined })).size, 8, "the next tap tries again");
});

test("another tab's request is awaited through a lock and its saved clip is used instead of asking again", async () => {
  resetVoiceSweepForTests();
  const cache = fresh();
  let calls = 0;
  const synthesize = (async () => { calls++; return clip(7); }) as never;
  const held: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  // A lock manager that serialises requests per name, like navigator.locks does across tabs.
  const locks = { request: (name: string, callback: () => Promise<unknown>) => { held.push(name); const run = chain.then(callback); chain = run.catch(() => {}); return run; } } as unknown as LockManager;
  const source = { messageId: "m", text: "hi", voice: "v", config };
  await voiceAudio(source, cache, { synthesize, locks });
  resetVoiceSweepForTests(); // a second tab has no pending promise of its own
  await voiceAudio(source, cache, { synthesize, locks });
  assert.equal(calls, 1);
  assert.equal(held.length, 2);
  assert.match(held[0], /^veil-voice:m:/);
});

test("an unusable config is refused before anything is made", async () => {
  await assert.rejects(voiceAudio({ messageId: "m", text: "x", voice: "v", config: { ...config, apiKey: "" } }, fresh()), /API Key/);
});

test("a MiniMax Character voice is requested once; the second play comes from the local cache", async () => {
  resetVoiceSweepForTests();
  const { synthesizeSpeech } = await import("../lib/tts/speech");
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ data: { audio: "010203" }, base_resp: { status_code: 0 } })); }) as unknown as typeof fetch;
  const synthesize = ((c: TtsConfig, i: { text: string; voice: string }, s: AbortSignal) => synthesizeSpeech(c, i, s, { fetchImpl })) as never;
  const minimax: TtsConfig = { provider: "minimax", region: "cn", baseUrl: "", apiKey: "k", model: "speech-2.8-hd", voice: "peter" };
  const source = { messageId: "m", text: "hi", voice: "peter", config: minimax };
  const cache = fresh();
  assert.equal((await voiceAudio(source, cache, { synthesize, locks: undefined })).size, 3);
  assert.equal((await voiceAudio(source, cache, { synthesize, locks: undefined })).size, 3);
  assert.deepEqual(urls, ["https://api.minimaxi.com/v1/t2a_v2"], "one request to MiniMax, none for the replay");
});

test("a cached clip comes back as an in-memory copy with the same bytes and an audio type", async () => {
  const cache = fresh();
  await cache.put("m1", "fp", new Blob([new Uint8Array([1, 2, 3])]));
  const saved = await cache.get("m1", "fp");
  assert.deepEqual([...new Uint8Array(await saved!.arrayBuffer())], [1, 2, 3]);
  assert.equal(saved!.type, "audio/mpeg", "an untyped stored clip is played as mp3");
  await cache.put("m2", "fp", clip(4, 9));
  assert.equal((await cache.get("m2", "fp"))?.type, "audio/mpeg");
});
