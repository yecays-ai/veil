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

test("MiniMax and ElevenLabs need no Base URL; ElevenLabs takes an override, MiniMax ignores one", () => {
  assert.equal(speechEndpoint(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(speechEndpoint({ ...minimax, baseUrl: "https://evil.test" }), "https://api.minimax.io/v1/t2a_v2", "a saved MiniMax Base URL is never used");
  assert.equal(speechEndpoint({ ...eleven, baseUrl: "https://eleven.test" }), "https://eleven.test/v1/text-to-speech");
  assert.equal(speechEndpoint(eleven), "https://api.elevenlabs.io/v1/text-to-speech");
  assert.equal(ttsConfigProblem(minimax), null);
  assert.equal(ttsConfigProblem({ ...eleven, apiKey: "" }) !== null, true);
  assert.equal(ttsConfigProblem({ ...eleven, baseUrl: "http://evil.test" }) !== null, true, "plain http to a remote host is refused");
});

/** MiniMax as the browser sees it: every request goes to `upstream`, and `calls` records what was sent. */
function minimaxServer(upstream: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return upstream(url, init); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const upstreamAudio = (bytes: number[]) => () => new Response(JSON.stringify({ data: { audio: hex(bytes) }, base_resp: { status_code: 0 } }));
const upstreamBody = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a failure"); }, (error) => error as TtsError);

test("MiniMax: the browser calls the Region's t2a_v2 itself, with the key only in the Authorization header", async () => {
  const { calls, fetchImpl } = minimaxServer(upstreamAudio([1, 2, 3, 255]));
  const blob = await synthesizeSpeech({ ...minimax, region: "cn" }, { text: " hi ", voice: "my-clone" }, never, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.method, "POST");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  assert.equal(String(calls[0].init.body).includes("sk-secret"), false, "the key is in a header, not the body or URL");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual({ model: body.model, text: body.text, stream: body.stream, output_format: body.output_format }, { model: "speech-2.6-hd", text: "hi", stream: false, output_format: "hex" });
  assert.equal(body.voice_setting.voice_id, "my-clone");
  assert.deepEqual(body.audio_setting, { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 });
  assert.equal(blob.type, "audio/mpeg");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 255]);
});

test("MiniMax Region is the only thing that picks the host: International and Mainland China", async () => {
  const hosts = async (config: TtsConfig) => { const { calls, fetchImpl } = minimaxServer(upstreamAudio([1])); await synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl }); return calls[0].url; };
  assert.equal(await hosts(minimax), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(await hosts({ ...minimax, region: "cn" }), "https://api.minimaxi.com/v1/t2a_v2");
  assert.equal(await hosts({ ...minimax, baseUrl: "https://evil.test" }), "https://api.minimax.io/v1/t2a_v2");
  assert.equal(normalizeTtsConfig({ provider: "minimax", region: "cn" }).region, "cn");
  assert.equal("region" in normalizeTtsConfig({ provider: "minimax", region: "global" }), false);
  assert.equal("region" in normalizeTtsConfig({ provider: "elevenlabs", region: "cn" }), false, "region belongs to MiniMax only");
  assert.notEqual(await voiceFingerprint("hi", "v", { ...minimax, region: "cn" }), await voiceFingerprint("hi", "v", minimax), "a clip made on one region is not reused for the other");
});

test("MiniMax: what MiniMax says becomes a category, a status or a number, and never its text", async () => {
  const run = (upstream: () => Response, config = minimax) => failure(synthesizeSpeech(config, { text: "secret words", voice: "v" }, never, { fetchImpl: minimaxServer(upstream).fetchImpl }));
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

test("MiniMax: an unreachable host is network, and one that answers a plain probe is the browser's CORS block", async () => {
  const down = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: minimaxServer(() => { throw new TypeError("Load failed"); }).fetchImpl }));
  assert.equal(down.category, "network");
  assert.match(ttsErrorMessage(down), /^MiniMax could not be reached \(api\.minimax\.io\)/);
  const answers = [() => { throw new TypeError("Load failed"); }, () => new Response(null)];
  const blocked = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: minimaxServer(() => answers.shift()!()).fetchImpl }));
  assert.equal(blocked.category, "cors");
  assert.match(ttsErrorMessage(blocked), /^MiniMax is reachable \(api\.minimax\.io\) but this browser blocked the request \(CORS\)/);
});

test("MiniMax: a slow MiniMax is cut off by the timeout", async () => {
  const hang = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const error = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: minimaxServer(hang).fetchImpl, timeoutMs: 20 }));
  assert.equal(error.category, "timeout");
});

test("MiniMax: audio over the 25 MiB limit is refused", async () => {
  const huge = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024 * 2)); controller.close(); } }));
  const error = await failure(synthesizeSpeech(minimax, { text: "x", voice: "v" }, never, { fetchImpl: minimaxServer(huge).fetchImpl }));
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

test("MiniMax: nothing about a request is written to the console, success or failure", async () => {
  const seen: string[] = [];
  const originals = (["log", "info", "warn", "error", "debug"] as const).map((name) => [name, console[name]] as const);
  for (const [name] of originals) console[name] = ((...args: unknown[]) => { seen.push(args.join(" ")); }) as never;
  try {
    for (const upstream of [upstreamAudio([1]), upstreamBody({ base_resp: { status_code: 1004, status_msg: "sk-secret secret words" } }), () => { throw new TypeError("sk-secret"); }])
      await synthesizeSpeech(minimax, { text: "secret words", voice: "v" }, never, { fetchImpl: minimaxServer(upstream).fetchImpl }).catch(() => {});
  } finally { for (const [name, original] of originals) console[name] = original; }
  assert.deepEqual(seen, []);
});

/**
 * A browser's own `fetch` throws "Illegal invocation" when it is called as a method of another object, which is how a
 * fetch kept on the `Call` object (`call.fetchImpl(...)`) was once called. This stand-in has the same rule, so any
 * provider written that way fails here as it does in a browser; the other tests' plain mocks cannot tell.
 */
function hostBoundFetch(answer: () => Response | Promise<Response>, seen: { url: string; mode?: RequestMode }[] = []) {
  return (async function (this: unknown, url: string, init: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    seen.push({ url, mode: init.mode });
    return answer();
  }) as unknown as typeof fetch;
}

test("every provider sends its request with a fetch that must not be called as a method", async () => {
  const mp3 = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  const openai: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" };
  for (const config of [openai, minimax, eleven]) {
    const seen: { url: string }[] = [];
    const answer = config === minimax ? upstreamAudio([1, 2, 3]) : mp3;
    const blob = await synthesizeSpeech(config, { text: "hi", voice: "v" }, never, { fetchImpl: hostBoundFetch(answer, seen) });
    assert.equal(seen.length, 1, `${config.provider ?? "openai"} made its one request`);
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
  }
});

test("the failure probe also calls fetch as a plain function, so an unreachable-but-live host is told apart from a refusal", async () => {
  const seen: { url: string; mode?: RequestMode }[] = [];
  const answers = [() => { throw new TypeError("Load failed"); }, () => new Response(null)];
  const fetchImpl = hostBoundFetch(() => answers.shift()!(), seen);
  const error = await failure(synthesizeSpeech(eleven, { text: "x", voice: "v" }, never, { fetchImpl }));
  assert.equal(error.category, "cors", "the probe reached the host");
  assert.deepEqual(seen.map((call) => call.mode), [undefined, "no-cors"]);
});

test("the host-bound stand-in does reject a method call, so the two tests above would fail on the old code", async () => {
  const holder = { fetchImpl: hostBoundFetch(() => new Response(null)) };
  await assert.rejects(Promise.resolve().then(() => holder.fetchImpl("https://x.test", {})), /Illegal invocation/);
});

test("every provider is called with credentials omitted: no cookie goes to any speech service", async () => {
  const mp3 = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
  const openai: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" };
  for (const config of [openai, minimax, eleven]) {
    const { calls, fetchImpl } = minimaxServer(config === minimax ? upstreamAudio([1]) : mp3);
    await synthesizeSpeech(config, { text: "hi", voice: "v" }, never, { fetchImpl });
    assert.equal(calls[0].init.credentials, "omit", `${config.provider ?? "openai"} gets no cookies`);
  }
});
