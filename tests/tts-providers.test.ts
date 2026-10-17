import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTtsConfig, resolveVoice, speechEndpoint, sttSettings, ttsConfigProblem, type TtsConfig } from "../lib/tts/config";
import { synthesizeSpeech, TtsError, ttsErrorMessage } from "../lib/tts/speech";
import { voiceFingerprint } from "../lib/tts/voice-cache";

const never = new AbortController().signal;
type Call = { url: string; init: RequestInit };
function recorder(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const minimax: TtsConfig = { provider: "minimax", baseUrl: "", apiKey: "sk-secret", model: "speech-2.6-hd", voice: "male-qn-qingse" };
const eleven: TtsConfig = { provider: "elevenlabs", baseUrl: "", apiKey: "xi-secret", model: "eleven_multilingual_v2", voice: "VOICEID123" };
const hex = (bytes: number[]) => bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
const category = (promise: Promise<unknown>, expected: string) => assert.rejects(promise, (error) => error instanceof TtsError && error.category === expected);

test("an old config without a provider is OpenAI-compatible and stays exactly as it was", () => {
  const old = normalizeTtsConfig({ baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" });
  assert.deepEqual(old, { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" });
  assert.equal("provider" in old, false);
  assert.equal(normalizeTtsConfig({ provider: "nonsense", baseUrl: "https://x.test/v1" }).provider, undefined);
  assert.equal(normalizeTtsConfig({ provider: "minimax" }).provider, "minimax");
  assert.equal(speechEndpoint(old), "https://tts.test/v1/audio/speech");
});

test("MiniMax and ElevenLabs need no Base URL; an override replaces the default host", () => {
  assert.equal(speechEndpoint(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(speechEndpoint({ ...minimax, baseUrl: "https://api.minimaxi.com" }), "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal(speechEndpoint(eleven), "https://api.elevenlabs.io/v1/text-to-speech");
  assert.equal(ttsConfigProblem(minimax), null);
  assert.equal(ttsConfigProblem({ ...eleven, apiKey: "" }) !== null, true);
  assert.equal(ttsConfigProblem({ ...eleven, baseUrl: "http://evil.test" }) !== null, true, "plain http to a remote host is refused");
});

test("MiniMax: one request with the voice_id and the key in a header, hex audio decoded to an mp3 blob", async () => {
  const { calls, fetchImpl } = recorder(() => new Response(JSON.stringify({ data: { audio: hex([1, 2, 3, 255]) }, base_resp: { status_code: 0 } })));
  const blob = await synthesizeSpeech(minimax, { text: " hi ", voice: "my-clone" }, never, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.minimax.io/v1/t2a_v2");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.text, "hi");
  assert.equal(body.model, "speech-2.6-hd");
  assert.equal(body.stream, false);
  assert.equal(body.voice_setting.voice_id, "my-clone");
  assert.equal(String(calls[0].init.body).includes("sk-secret"), false);
  assert.equal(blob.type, "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 255]);
});

test("MiniMax: business errors in a 200 answer map to the same categories, and bad audio is invalid", async () => {
  const reply = (body: unknown) => recorder(() => new Response(JSON.stringify(body))).fetchImpl;
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: reply({ base_resp: { status_code: 1004, status_msg: "key sk-secret" } }) }), "auth");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: reply({ base_resp: { status_code: 1002 } }) }), "rate-limit");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: reply({ base_resp: { status_code: 2013 } }) }), "http");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: reply({ data: { audio: "zz" }, base_resp: { status_code: 0 } }) }), "invalid-audio");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: reply({ data: {}, base_resp: { status_code: 0 } }) }), "invalid-audio");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: recorder(() => new Response("<html>", { status: 429 })).fetchImpl }), "rate-limit");
  await category(synthesizeSpeech(minimax, { text: "x", voice: "" }, never, { fetchImpl: reply({}) }), "config");
});

test("ElevenLabs: the voice is in the path, the key is xi-api-key, and the body is text and model_id", async () => {
  const { calls, fetchImpl } = recorder(() => new Response(new Uint8Array([9, 9, 9]), { headers: { "content-type": "audio/mpeg" } }));
  const blob = await synthesizeSpeech(eleven, { text: "hello", voice: "a b/c" }, never, { fetchImpl });
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/text-to-speech/a%20b%2Fc?output_format=mp3_44100_128");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], "xi-secret");
  assert.equal(headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { text: "hello", model_id: "eleven_multilingual_v2" });
  assert.equal(blob.type, "audio/mpeg");
  assert.equal(blob.size, 3);
});

test("ElevenLabs: HTTP errors and empty or oversized audio use the shared categories", async () => {
  const run = (response: () => Response) => synthesizeSpeech(eleven, { text: "x", voice: "v" }, never, { fetchImpl: recorder(response).fetchImpl });
  await category(run(() => new Response("{}", { status: 401 })), "auth");
  await category(run(() => new Response("{}", { status: 429 })), "rate-limit");
  await category(run(() => new Response("{}", { status: 500 })), "http");
  await category(run(() => new Response(new Uint8Array(0), { headers: { "content-type": "audio/mpeg" } })), "invalid-audio");
  await category(run(() => new Response("not audio", { headers: { "content-type": "text/html" } })), "invalid-audio");
  await category(synthesizeSpeech(eleven, { text: "x", voice: "" }, never, { fetchImpl: recorder(() => new Response("")).fetchImpl }), "config");
});

test("both providers keep cancellation: a stop rejects with the stop, not as a service error", async () => {
  const fetchImpl = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as unknown as typeof fetch;
  for (const config of [minimax, eleven]) {
    const controller = new AbortController();
    const pending = synthesizeSpeech(config, { text: "x", voice: "v" }, controller.signal, { fetchImpl });
    controller.abort();
    await assert.rejects(pending, (error) => !(error instanceof TtsError));
  }
});

test("a voice is never guessed for MiniMax or ElevenLabs, while OpenAI keeps its fallback", () => {
  assert.equal(resolveVoice({ ttsVoice: "mine" }, minimax), "mine");
  assert.equal(resolveVoice({}, eleven), "VOICEID123");
  assert.equal(resolveVoice({}, { ...eleven, voice: "" }), "");
  assert.equal(resolveVoice({}, { voice: "" }), "alloy");
});

test("the cache fingerprint separates provider, endpoint, model, voice and text, and never the key", async () => {
  const base = await voiceFingerprint("hi", "v", minimax);
  assert.notEqual(base, await voiceFingerprint("hi", "v", { ...minimax, provider: "elevenlabs" }));
  assert.notEqual(base, await voiceFingerprint("hi", "v", { ...minimax, baseUrl: "https://api.minimaxi.com" }));
  assert.notEqual(base, await voiceFingerprint("hi", "v", { ...minimax, model: "other" }));
  assert.notEqual(base, await voiceFingerprint("hi", "w", minimax));
  assert.notEqual(base, await voiceFingerprint("hi!", "v", minimax));
  assert.equal(base, await voiceFingerprint("hi", "v", { ...minimax, apiKey: "different" } as never));
  assert.equal(await voiceFingerprint("hi", "v", { baseUrl: "https://gw.test/v1", model: "m" }),
    await voiceFingerprint("hi", "v", { baseUrl: "https://gw.test/v1", model: "m", provider: "openai" }), "an old clip stays valid");
});

test("speech-to-text is its own service: OpenAI-compatible falls back to the voice settings, the other providers must set it", () => {
  const openai: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "", sttModel: "whisper-1" };
  assert.deepEqual(sttSettings(openai), { baseUrl: "https://tts.test/v1", apiKey: "k", model: "whisper-1" });
  assert.deepEqual(sttSettings({ ...openai, sttBaseUrl: "https://stt.test/v1", sttApiKey: "s" }), { baseUrl: "https://stt.test/v1", apiKey: "s", model: "whisper-1" });
  assert.ok("problem" in sttSettings({ ...openai, sttBaseUrl: "https://stt.test/v1" }), "a URL alone does not borrow the voice key");
  assert.ok("problem" in sttSettings({ ...openai, sttApiKey: "s" }), "a key alone does not go to the voice address");
  assert.ok("problem" in sttSettings({ ...minimax, sttModel: "whisper-1" }), "the MiniMax key is not an STT key");
  assert.deepEqual(sttSettings({ ...eleven, sttModel: "whisper-1", sttBaseUrl: "https://stt.test/v1", sttApiKey: "s" }), { baseUrl: "https://stt.test/v1", apiKey: "s", model: "whisper-1" });
  assert.ok("problem" in sttSettings(openai.baseUrl ? { ...openai, sttModel: "" } : openai));
});

test("MiniMax Region picks the official host; an old config without one stays international; the override still wins", async () => {
  const cn: TtsConfig = { ...minimax, region: "cn" };
  assert.equal(speechEndpoint(cn), "https://api.minimax.cn/v1/t2a_v2");
  assert.equal(speechEndpoint(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(speechEndpoint({ ...cn, baseUrl: "https://api.minimaxi.com" }), "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal(normalizeTtsConfig({ provider: "minimax", region: "cn" }).region, "cn");
  assert.equal("region" in normalizeTtsConfig({ provider: "minimax", region: "global" }), false);
  assert.equal("region" in normalizeTtsConfig({ provider: "elevenlabs", region: "cn" }), false, "region belongs to MiniMax only");
  assert.notEqual(await voiceFingerprint("hi", "v", cn), await voiceFingerprint("hi", "v", minimax), "a clip made on one region is not reused for the other");
  const { calls, fetchImpl } = recorder(() => new Response(JSON.stringify({ data: { audio: hex([1, 2]) }, base_resp: { status_code: 0 } })));
  await synthesizeSpeech(cn, { text: "x", voice: "v" }, never, { fetchImpl });
  assert.equal(calls[0].url, "https://api.minimax.cn/v1/t2a_v2");
});

test("a request that never got an answer is told apart: reachable host means the browser blocked it, unreachable means network", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const build = (probeReaches: boolean) => (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.mode === "no-cors") { if (probeReaches) return new Response(null); throw new TypeError("Failed to fetch"); }
    throw new TypeError("Load failed");
  }) as unknown as typeof fetch;
  const run = (fetchImpl: typeof fetch, config = minimax) => synthesizeSpeech(config, { text: "secret words", voice: "v" }, never, { fetchImpl }).then(() => { throw new Error("expected a failure"); }, (error) => error as TtsError);
  const blocked = await run(build(true));
  assert.equal(blocked.category, "cors");
  const probe = calls.find((call) => call.init.mode === "no-cors")!;
  assert.equal(probe.url, "https://api.minimax.io/");
  assert.equal(probe.init.body, undefined, "the probe carries no text");
  assert.equal(JSON.stringify(probe.init.headers ?? {}).includes("sk-secret"), false, "and no key");
  assert.equal(probe.init.credentials, "omit");
  const unreachable = await run(build(false), { ...minimax, region: "cn" });
  assert.equal(unreachable.category, "network");
  assert.match(ttsErrorMessage(unreachable), /MiniMax could not be reached from this browser \(api\.minimax\.cn\)/);
  assert.match(ttsErrorMessage(blocked), /MiniMax is reachable \(api\.minimax\.io\) but this browser blocked the request \(CORS\)/);
  for (const error of [blocked, unreachable]) for (const secret of ["sk-secret", "secret words"]) assert.equal(ttsErrorMessage(error).includes(secret), false);
});

test("a stop during the probe is a stop, not a network error", async () => {
  const controller = new AbortController();
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    if (init.mode === "no-cors") { controller.abort(new Error("stopped")); throw new TypeError("aborted"); }
    throw new TypeError("Load failed");
  }) as unknown as typeof fetch;
  await assert.rejects(synthesizeSpeech(minimax, { text: "x", voice: "v" }, controller.signal, { fetchImpl }), (error) => !(error instanceof TtsError));
});

test("MiniMax errors name the service, host and the number only; the provider's own text is never shown", async () => {
  const reply = (body: unknown, status = 200) => recorder(() => new Response(JSON.stringify(body), { status })).fetchImpl;
  const fail = (config: TtsConfig, fetchImpl: typeof fetch) => synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl }).then(() => { throw new Error("expected a failure"); }, (error) => error as TtsError);
  const business = await fail({ ...minimax, region: "cn" }, reply({ base_resp: { status_code: 2013, status_msg: "bad param sk-secret" } }));
  assert.equal(business.category, "http");
  assert.equal(ttsErrorMessage(business), "MiniMax request failed (api.minimax.cn): code 2013. Check the Model, voice ID and Region.");
  const auth = await fail(minimax, reply({ base_resp: { status_code: 1004, status_msg: "login fail sk-secret" } }));
  assert.match(ttsErrorMessage(auth), /^MiniMax authentication failed \(api\.minimax\.io\)\..*Region/);
  const notFound = await fail(minimax, reply({}, 404));
  assert.match(ttsErrorMessage(notFound), /^MiniMax request failed \(api\.minimax\.io\): HTTP 404/);
  const bad = await fail(minimax, reply({ data: { audio: "zz" }, base_resp: { status_code: 0 } }));
  assert.equal(ttsErrorMessage(bad), "MiniMax returned invalid audio (api.minimax.io).");
  for (const error of [business, auth, notFound, bad]) assert.equal(ttsErrorMessage(error).includes("sk-secret"), false);
});
