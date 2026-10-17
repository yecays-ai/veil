import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { DEFAULT_TTS_VOICE, resolveVoice, speechUrl, ttsConfigProblem, TTS_TEXT_LIMIT, type TtsConfig } from "../lib/tts/config";
import { TtsConfigStorage } from "../lib/tts/config-storage";
import { synthesizeSpeech, TtsError, ttsErrorMessage } from "../lib/tts/speech";
import { normalizeBindings, resolveScopeBindings, setBindingField } from "../lib/bindings";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";

const config: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "sk-secret", model: "tts-1", voice: "nova" };
const audio = (type = "audio/mpeg", bytes = 4) => new Response(new Uint8Array(bytes).fill(1), { headers: { "content-type": type } });
const never = new AbortController().signal;
type Call = { url: string; init: RequestInit };
function recorder(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("the speech endpoint is added once and follows the same URL safety rules as the Text API", () => {
  assert.equal(speechUrl("https://tts.test/v1"), "https://tts.test/v1/audio/speech");
  assert.equal(speechUrl("https://tts.test/v1/audio/speech/"), "https://tts.test/v1/audio/speech");
  assert.throws(() => speechUrl("http://tts.test/v1"));
  assert.throws(() => speechUrl("https://u:p@tts.test/v1"));
  assert.equal(speechUrl("http://localhost:8000/v1"), "http://localhost:8000/v1/audio/speech");
});

test("one request goes out with the key, model, voice and text, and nothing else is sent", async () => {
  const { calls, fetchImpl } = recorder(() => audio());
  const blob = await synthesizeSpeech(config, { text: "  hello  ", voice: "shimmer" }, never, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://tts.test/v1/audio/speech");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  assert.equal(calls[0].init.credentials, "omit");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { model: "tts-1", input: "hello", voice: "shimmer", response_format: "mp3" });
  assert.equal(blob.type, "audio/mpeg");
  assert.equal(blob.size, 4);
});

test("a generic binary answer is treated as mp3; an empty, oversized or non-audio answer is refused", async () => {
  const run = (reply: () => Response) => synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl: recorder(reply).fetchImpl });
  assert.equal((await run(() => audio("application/octet-stream"))).type, "audio/mpeg");
  for (const reply of [() => audio("audio/mpeg", 0), () => new Response('{"error":"x"}', { headers: { "content-type": "application/json" } })])
    await assert.rejects(run(reply), (error) => error instanceof TtsError && error.category === "invalid-audio");
});

test("errors are classified and never carry the response body or the key", async () => {
  const cases: [number, string][] = [[401, "auth"], [403, "auth"], [429, "rate-limit"], [500, "http"], [400, "http"]];
  for (const [status, category] of cases) {
    const { fetchImpl } = recorder(() => new Response("echo sk-secret", { status }));
    await assert.rejects(synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl }), (error) => {
      assert.ok(error instanceof TtsError);
      assert.equal(error.category, category);
      assert.equal(error.httpStatus, status);
      assert.equal(ttsErrorMessage(error).includes("sk-secret"), false);
      assert.equal(error.message.includes("sk-secret"), false);
      return true;
    });
  }
  await assert.rejects(synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl: (async () => { throw new TypeError("fail"); }) as unknown as typeof fetch }),
    (error) => error instanceof TtsError && error.category === "network");
});

test("a slow service times out, and a stop is a plain abort that is not reported as a failure", async () => {
  const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as unknown as typeof fetch;
  await assert.rejects(synthesizeSpeech(config, { text: "x", voice: "v" }, never, { fetchImpl: hanging, timeoutMs: 10 }),
    (error) => error instanceof TtsError && error.category === "timeout");
  const stop = new AbortController(), pending = synthesizeSpeech(config, { text: "x", voice: "v" }, stop.signal, { fetchImpl: hanging });
  stop.abort(new Error("stopped"));
  await assert.rejects(pending, (error) => !(error instanceof TtsError) && (error as Error).message === "stopped");
});

test("a missing setting or bad text is refused before any request is made", async () => {
  const { calls, fetchImpl } = recorder(() => audio());
  const refused = (c: TtsConfig, text: string) => assert.rejects(synthesizeSpeech(c, { text, voice: "v" }, never, { fetchImpl }),
    (error) => error instanceof TtsError && error.category === "config");
  await refused({ ...config, apiKey: " " }, "x");
  await refused({ ...config, model: "" }, "x");
  await refused({ ...config, baseUrl: "nope" }, "x");
  await refused(config, "   ");
  await refused(config, "a".repeat(TTS_TEXT_LIMIT + 1));
  assert.equal(calls.length, 0);
  assert.equal(ttsConfigProblem(config), null);
});

test("a Character's voice beats the global one, which beats the config's, which beats the service default", () => {
  assert.equal(resolveVoice({ ttsVoice: "echo" }, config), "echo");
  assert.equal(resolveVoice({}, config), "nova");
  assert.equal(resolveVoice({ ttsVoice: null }, config), "nova");
  assert.equal(resolveVoice({ ttsVoice: "  " }, { voice: "" }), DEFAULT_TTS_VOICE);
  let document = normalizeBindings({}, ["a", "b"]);
  document = setBindingField(document, {}, "ttsVoice", "fable");
  document = setBindingField(document, { characterId: "a" }, "ttsVoice", " onyx ");
  assert.equal(resolveScopeBindings(document, { characterId: "a" }).ttsVoice, "onyx");
  assert.equal(resolveScopeBindings(document, { characterId: "b" }).ttsVoice, "fable");
  document = setBindingField(document, { characterId: "a" }, "ttsVoice", undefined);
  assert.equal(resolveScopeBindings(document, { characterId: "a" }).ttsVoice, "fable");
  assert.deepEqual(document.characters, {}, "clearing the only override leaves no empty Character entry");
});

test("the speech settings are kept on this device, trimmed, and can be cleared", async () => {
  const storage = new TtsConfigStorage(() => new IDBFactory());
  assert.deepEqual(await storage.load(), { baseUrl: "", apiKey: "", model: "", voice: "" });
  await storage.save({ baseUrl: " https://tts.test/v1 ", apiKey: " k ", model: "m", voice: " v " });
  assert.deepEqual(await storage.load(), { baseUrl: "https://tts.test/v1", apiKey: "k", model: "m", voice: "v" });
  await storage.clear();
  assert.equal((await storage.load()).apiKey, "");
});

test("a Character voice survives a backup round trip, and the speech key has no place in the backup", async () => {
  const data = backupData();
  data.bindings!.global.ttsVoice = "fable";
  const result = await validateBackupPackage(...(await (async () => { const f = await packageFixture(data); return [JSON.stringify(f.manifest), f.files] as const; })()));
  assert.equal(result.data.bindings!.global.ttsVoice, "fable");
  const leaked = backupData();
  (leaked.bindings!.global as Record<string, unknown>).ttsApiKey = "sk-secret";
  await assert.rejects(async () => { const f = await packageFixture(leaked); return validateBackupPackage(JSON.stringify(f.manifest), f.files); });
});
