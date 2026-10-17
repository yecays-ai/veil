import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTtsConfig, resolveVoice, speechEndpoint, sttSettings, ttsConfigProblem, type TtsConfig } from "../lib/tts/config";
import { synthesizeSpeech, TtsError, ttsErrorMessage } from "../lib/tts/speech";
import { relayMinimaxSpeech } from "../lib/tts/minimax-relay";
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

test("MiniMax and ElevenLabs need no Base URL; ElevenLabs takes an override, MiniMax ignores one", () => {
  assert.equal(speechEndpoint(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(speechEndpoint({ ...minimax, baseUrl: "https://evil.test" }), "https://api.minimax.io/v1/t2a_v2", "a saved MiniMax Base URL is never used");
  assert.equal(speechEndpoint({ ...eleven, baseUrl: "https://eleven.test" }), "https://eleven.test/v1/text-to-speech");
  assert.equal(speechEndpoint(eleven), "https://api.elevenlabs.io/v1/text-to-speech");
  assert.equal(ttsConfigProblem(minimax), null);
  assert.equal(ttsConfigProblem({ ...eleven, apiKey: "" }) !== null, true);
  assert.equal(ttsConfigProblem({ ...eleven, baseUrl: "http://evil.test" }) !== null, true, "plain http to a remote host is refused");
});

/** The browser's fetch, answered by the relay itself, whose own upstream call goes to `upstream`. */
function viaRelay(upstream: (url: string, init: RequestInit) => Response | Promise<Response>, options: { timeoutMs?: number } = {}) {
  const browser: Call[] = [], server: Call[] = [];
  const serverFetch = (async (url: string, init: RequestInit) => { server.push({ url, init }); return upstream(url, init); }) as unknown as typeof fetch;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    browser.push({ url, init });
    return relayMinimaxSpeech(new Request(`https://veil.test${url}`, { method: "POST", headers: init.headers as Record<string, string>, body: init.body as string, signal: init.signal ?? undefined }),
      { fetchImpl: serverFetch, ...options });
  }) as unknown as typeof fetch;
  return { browser, server, fetchImpl };
}
const upstreamAudio = (bytes: number[]) => () => new Response(JSON.stringify({ data: { audio: hex(bytes) }, base_resp: { status_code: 0 } }));
const upstreamBody = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a failure"); }, (error) => error as TtsError);

test("MiniMax: the browser only talks to VEIL; the server makes the one MiniMax call with the key in a header", async () => {
  const { browser, server, fetchImpl } = viaRelay(upstreamAudio([1, 2, 3, 255]));
  const blob = await synthesizeSpeech({ ...minimax, region: "cn" }, { text: " hi ", voice: "my-clone" }, never, { fetchImpl });
  assert.equal(browser.length, 1);
  assert.equal(browser[0].url, "/api/tts/minimax", "a same-origin path, not a MiniMax host");
  assert.equal(String(browser[0].init.body).includes("sk-secret"), false, "the key is in a header, not the body or URL");
  assert.equal((browser[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  assert.equal(server.length, 1);
  assert.equal(server[0].url, "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal((server[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  const body = JSON.parse(String(server[0].init.body));
  assert.deepEqual({ model: body.model, text: body.text, stream: body.stream, output_format: body.output_format }, { model: "speech-2.6-hd", text: "hi", stream: false, output_format: "hex" });
  assert.equal(body.voice_setting.voice_id, "my-clone");
  assert.deepEqual(body.audio_setting, { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 });
  assert.equal(blob.type, "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 255]);
});

test("MiniMax Region is the only thing that picks the host: International and Mainland China", async () => {
  const hosts = async (config: TtsConfig) => { const { server, fetchImpl } = viaRelay(upstreamAudio([1])); await synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl }); return server[0].url; };
  assert.equal(await hosts(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(await hosts({ ...minimax, region: "cn" }), "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal(await hosts({ ...minimax, baseUrl: "https://evil.test" }), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(normalizeTtsConfig({ provider: "minimax", region: "cn" }).region, "cn");
  assert.equal("region" in normalizeTtsConfig({ provider: "minimax", region: "global" }), false);
  assert.equal("region" in normalizeTtsConfig({ provider: "elevenlabs", region: "cn" }), false, "region belongs to MiniMax only");
  assert.notEqual(await voiceFingerprint("hi", "v", { ...minimax, region: "cn" }), await voiceFingerprint("hi", "v", minimax), "a clip made on one region is not reused for the other");
});

test("relay: it refuses anything but a well-formed request, another site's page, and an unknown region, without calling MiniMax", async () => {
  const send = async (headers: Record<string, string>, body: unknown) => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return upstreamAudio([1])(); }) as unknown as typeof fetch;
    const response = await relayMinimaxSpeech(new Request("https://veil.test/api/tts/minimax", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), { fetchImpl });
    return { status: response.status, calls };
  };
  const good = { region: "global", model: "m", voice: "v", text: "hi" }, auth = { Authorization: "Bearer k" };
  assert.deepEqual(await send({}, good), { status: 400, calls: 0 }, "no key");
  assert.deepEqual(await send(auth, { ...good, region: "https://evil.test" }), { status: 400, calls: 0 });
  assert.deepEqual(await send(auth, { ...good, text: "" }), { status: 400, calls: 0 });
  assert.deepEqual(await send(auth, { ...good, text: "x".repeat(5000) }), { status: 400, calls: 0 });
  assert.deepEqual(await send(auth, "not json"), { status: 400, calls: 0 });
  assert.deepEqual(await send({ ...auth, Origin: "https://other.test" }, good), { status: 403, calls: 0 });
  assert.equal((await send({ ...auth, Origin: "https://veil.test" }, good)).status, 200);
});

test("MiniMax: what MiniMax says becomes a category, a status or a number, and never its text", async () => {
  const run = (upstream: () => Response, config = minimax) => failure(synthesizeSpeech(config, { text: "secret words", voice: "v" }, never, { fetchImpl: viaRelay(upstream).fetchImpl }));
  const auth = await run(upstreamBody({ base_resp: { status_code: 1004, status_msg: "key sk-secret secret words" } }));
  assert.equal(auth.category, "auth");
  assert.equal((await run(upstreamBody({ base_resp: { status_code: 1002 } }))).category, "rate-limit");
  assert.equal((await run(upstreamBody({ base_resp: { status_code: 1039 } }))).category, "rate-limit");
  assert.equal((await run(upstreamBody({ base_resp: { status_code: 1001 } }))).category, "timeout");
  const business = await run(upstreamBody({ base_resp: { status_code: 2013, status_msg: "bad param sk-secret" } }), { ...minimax, region: "cn" });
  assert.equal(business.category, "http");
  assert.equal(ttsErrorMessage(business), "MiniMax request failed (api.minimaxi.com): code 2013. Check the Model, voice ID and Region.");
  const forbidden = await run(upstreamBody({ error: "sk-secret" }, 403));
  assert.equal(forbidden.category, "auth");
  assert.equal((await run(() => new Response("<html>", { status: 429 }))).category, "rate-limit");
  const notFound = await run(upstreamBody({ msg: "sk-secret" }, 404));
  assert.equal(notFound.category, "http");
  assert.match(ttsErrorMessage(notFound), /^MiniMax request failed \(api\.minimax\.io\): HTTP 404/);
  const bad = await run(upstreamBody({ data: { audio: "zz" }, base_resp: { status_code: 0 } }));
  assert.equal(ttsErrorMessage(bad), "MiniMax returned invalid audio (api.minimax.io).");
  assert.equal((await run(upstreamBody({ data: {}, base_resp: { status_code: 0 } }))).category, "invalid-audio");
  assert.equal((await run(() => new Response("<html>"))).category, "invalid-audio");
  for (const error of [auth, business, forbidden, notFound, bad]) for (const secret of ["sk-secret", "secret words"]) assert.equal(`${ttsErrorMessage(error)} ${error.message}`.includes(secret), false);
  assert.match(ttsErrorMessage(auth), /^MiniMax authentication failed \(api\.minimax\.io\)\..*Region/);
});

test("MiniMax: a failed upstream call is network, and the relay being unreachable says so", async () => {
  const run = (config: Parameters<typeof viaRelay>, fetchImpl?: typeof fetch) =>
    failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: fetchImpl ?? viaRelay(...config).fetchImpl }));
  const down = await run([() => { throw new TypeError("fetch failed"); }]);
  assert.equal(down.category, "network");
  assert.match(ttsErrorMessage(down), /^MiniMax could not be reached \(api\.minimax\.io\)/);
  const noRelay = await run([upstreamAudio([1])], (async () => { throw new TypeError("Load failed"); }) as unknown as typeof fetch);
  assert.equal(noRelay.category, "network");
  assert.match(ttsErrorMessage(noRelay), /^MiniMax could not be reached \(VEIL server\)/);
  const missing = await run([upstreamAudio([1])], (async () => new Response("<html>", { status: 404 })) as unknown as typeof fetch);
  assert.equal(missing.category, "http");
  assert.match(ttsErrorMessage(missing), /\(VEIL server\): HTTP 404/);
});

test("MiniMax: a slow MiniMax is cut off by the relay's timeout", async () => {
  const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const error = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: viaRelay(hang, { timeoutMs: 20 }).fetchImpl }));
  assert.equal(error.category, "timeout");
});

test("MiniMax: audio over the 25 MiB limit is refused by the relay", async () => {
  const huge = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024 * 2)); controller.close(); } }));
  const error = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: viaRelay(huge).fetchImpl }));
  assert.equal(error.category, "invalid-audio");
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
  assert.notEqual(base, await voiceFingerprint("hi", "v", { ...minimax, region: "cn" }));
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

test("relay: nothing about a request is written to the console, success or failure", async () => {
  const seen: string[] = [];
  const originals = (["log", "info", "warn", "error", "debug"] as const).map((name) => [name, console[name]] as const);
  for (const [name] of originals) console[name] = ((...args: unknown[]) => { seen.push(args.join(" ")); }) as never;
  try {
    for (const upstream of [upstreamAudio([1]), upstreamBody({ base_resp: { status_code: 1004, status_msg: "sk-secret secret words" } }), () => { throw new TypeError("sk-secret"); }])
      await synthesizeSpeech(minimax, { text: "secret words", voice: "v" }, never, { fetchImpl: viaRelay(upstream).fetchImpl }).catch(() => {});
  } finally { for (const [name, original] of originals) console[name] = original; }
  assert.deepEqual(seen, []);
});
