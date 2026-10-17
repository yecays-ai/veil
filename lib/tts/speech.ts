import { MINIMAX_RELAY_PATH, providerOf, speechEndpoint, ttsConfigProblem, TTS_PROVIDERS, TTS_TEXT_LIMIT, type TtsConfig, type TtsProvider } from "./config";

/** `cors`: the service answers (a plain probe reached it) but the browser would not let this request through. `network`: it could not be reached at all. */
export type TtsErrorCategory = "config" | "network" | "cors" | "auth" | "rate-limit" | "http" | "timeout" | "invalid-audio";
/** Which provider and host failed, and the provider's own numeric code. Never a body, a key or any of the text. */
export type TtsErrorInfo = { provider: TtsProvider; host: string; code?: number };
export class TtsError extends Error {
  constructor(message: string, readonly category: TtsErrorCategory, readonly httpStatus?: number, readonly info?: TtsErrorInfo) { super(message); }
}
export const TTS_TIMEOUT_MS = 60_000;
export const TTS_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** What the person is told. Response bodies are never shown or logged: gateways may echo the key. */
export function ttsErrorMessage(error: unknown): string {
  if (!(error instanceof TtsError)) return "Could not make the voice. Try again.";
  const info = error.info;
  // MiniMax and ElevenLabs say which service and host failed, so there is no guessing at the Base URL.
  if (info && info.provider !== "openai") {
    const name = TTS_PROVIDERS.find((item) => item.id === info.provider)?.label ?? "The voice service", where = ` (${info.host})`;
    switch (error.category) {
      case "auth": return `${name} authentication failed${where}. Check the API Key${info.provider === "minimax" ? " and that the Region matches your account" : ""}.`;
      case "rate-limit": return `${name} is busy or over its limit${where}. Try again later.`;
      case "timeout": return `${name} did not answer in time${where}. Try again.`;
      case "network": return `${name} could not be reached${where}. Check your connection and try again.`;
      case "cors": return `${name} is reachable${where} but this browser blocked the request (CORS), so VEIL cannot call it directly.`;
      case "invalid-audio": return `${name} returned invalid audio${where}.`;
      case "http": return `${name} request failed${where}: ${error.httpStatus ? `HTTP ${error.httpStatus}` : info.code !== undefined ? `code ${info.code}` : "no detail"}. Check the Model, voice ID and Region.`;
      default: return error.message;
    }
  }
  switch (error.category) {
    case "auth": return "The voice service rejected the API Key. Check your Voice settings.";
    case "rate-limit": return "The voice service is busy or over its limit. Try again later.";
    case "timeout": return "The voice service did not answer in time. Try again.";
    case "network": return "Could not reach the voice service. Check the Base URL and your provider's browser/CORS support.";
    case "cors": return "The voice service is reachable but this browser blocked the request (CORS).";
    case "invalid-audio": return "The voice service did not return playable audio.";
    case "http": return error.httpStatus ? `The voice service failed (HTTP ${error.httpStatus}). Check your Voice settings.`
      : "The voice service could not make this voice. Check your Voice settings.";
    default: return error.message;
  }
}

/**
 * A request that never got an answer. A browser reports "blocked by CORS" and "could not connect" the same way, so one
 * key-less, body-less request in no-cors mode tells them apart: if that reaches the host, the host is up and the
 * browser's cross-origin rule is what stopped the real request. It only runs after a failure, once.
 */
const PROBE_MS = 8000;
async function failedFetch(call: Call): Promise<TtsError> {
  call.stop.throwIfAborted();
  const info = infoOf(call);
  if (call.timedOut()) return new TtsError("timeout", "timeout", undefined, info);
  const probe = new AbortController();
  const stop = () => probe.abort(), timer = setTimeout(stop, PROBE_MS);
  call.stop.addEventListener("abort", stop, { once: true });
  try {
    await call.fetchImpl(`https://${info.host}/`, { method: "GET", mode: "no-cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: probe.signal });
    return new TtsError("cors", "cors", undefined, info);
  } catch {
    call.stop.throwIfAborted();
    return new TtsError("network", "network", undefined, info);
  } finally { clearTimeout(timer); call.stop.removeEventListener("abort", stop); }
}
/** The answer began but its body did not arrive: the host was reached, so there is nothing to probe. */
function readFailed(call: Call): TtsError {
  call.stop.throwIfAborted();
  return new TtsError(call.timedOut() ? "timeout" : "network", call.timedOut() ? "timeout" : "network", undefined, infoOf(call));
}
const hostOf = (config: TtsConfig) => { try { return new URL(speechEndpoint(config)).host; } catch { return "unknown host"; } };
const infoOf = (call: Call, code?: number): TtsErrorInfo => ({ provider: providerOf(call.config), host: hostOf(call.config), ...(code !== undefined ? { code } : {}) });
const httpFailure = (call: Call, status: number) => new TtsError("http", status === 401 || status === 403 ? "auth" : status === 429 ? "rate-limit" : "http", status, infoOf(call));
const invalidAudio = (call: Call, code?: number) => new TtsError("audio", "invalid-audio", undefined, infoOf(call, code));

/** The whole body, read in pieces so that one larger than `limit` is dropped without being held whole. */
async function readBounded(response: Response, limit: number, call: Call): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); throw invalidAudio(call); }
  const reader = response.body?.getReader();
  if (!reader) throw invalidAudio(call);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => {}); throw invalidAudio(call); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof TtsError) throw error; throw readFailed(call); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

type Call = { config: TtsConfig; text: string; voice: string; signal: AbortSignal; stop: AbortSignal; fetchImpl: typeof fetch; timedOut: () => boolean };
const audioOf = (blob: Blob, call: Call): Blob => {
  const type = blob.type.toLowerCase();
  if (!blob.size || blob.size > TTS_MAX_AUDIO_BYTES || !(type.startsWith("audio/") || type === "application/octet-stream" || !type))
    throw invalidAudio(call);
  return type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
};
const post = (call: Call, url: string, headers: Record<string, string>, body: unknown, credentials: RequestCredentials = "omit") =>
  call.fetchImpl(url, { method: "POST", signal: call.signal, credentials, referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

/** OpenAI-compatible `/audio/speech`. */
async function openaiSpeech(call: Call): Promise<Blob> {
  let response: Response;
  try {
    response = await post(call, speechEndpoint(call.config), { Authorization: `Bearer ${call.config.apiKey.trim()}` },
      { model: call.config.model.trim(), input: call.text, voice: call.voice, response_format: "mp3" });
  } catch { throw await failedFetch(call); }
  if (!response.ok) throw httpFailure(call, response.status);
  let blob: Blob;
  try { blob = await response.blob(); }
  catch { throw readFailed(call); }
  return audioOf(blob, call);
}

/**
 * MiniMax goes through VEIL's own server (`minimax-relay.ts`), never straight from the browser. The relay does the
 * `t2a_v2` call and answers with the MP3, or with a category (and MiniMax's status or code) and nothing else.
 * Preview and Character voice messages both end up here.
 */
async function minimaxSpeech(call: Call): Promise<Blob> {
  const relay = { provider: "minimax" as const, host: "VEIL server" };
  let response: Response;
  try {
    response = await post(call, MINIMAX_RELAY_PATH, { Authorization: `Bearer ${call.config.apiKey.trim()}` },
      { region: call.config.region ?? "global", model: call.config.model.trim(), voice: call.voice, text: call.text },
      // VEIL's own origin, so its own cookies may go: a deployment behind a sign-in (a Vercel preview) rejects a request without them by redirecting off-site, which a browser reports as a failed fetch.
      "same-origin");
  } catch { call.stop.throwIfAborted(); throw new TtsError(call.timedOut() ? "timeout" : "network", call.timedOut() ? "timeout" : "network", undefined, relay); }
  if (!response.ok) {
    let failure: { category?: unknown; status?: unknown; code?: unknown } | null = null;
    try { failure = await response.json(); } catch { /* not the relay's answer */ }
    const info = infoOf(call, typeof failure?.code === "number" ? failure.code : undefined);
    const status = typeof failure?.status === "number" ? failure.status : undefined;
    const category = failure?.category;
    if (category === "auth" || category === "rate-limit" || category === "timeout" || category === "network" || category === "invalid-audio") throw new TtsError(category, category, undefined, info);
    if (category === "http") throw new TtsError("http", "http", status, info);
    if (category === "config") throw new TtsError("The voice request was not accepted. Check the Model, voice ID and Region.", "config");
    // Not the relay's own answer (the route missing or the platform refusing): say it was VEIL's server.
    throw new TtsError("http", "http", response.status, { ...info, host: relay.host });
  }
  const bytes = await readBounded(response, TTS_MAX_AUDIO_BYTES, call);
  return audioOf(new Blob([bytes], { type: "audio/mpeg" }), call);
}

/** ElevenLabs `text-to-speech/{voice_id}`: the answer is the MP3 itself. */
async function elevenlabsSpeech(call: Call): Promise<Blob> {
  let response: Response;
  try {
    response = await post(call, `${speechEndpoint(call.config)}/${encodeURIComponent(call.voice)}?output_format=mp3_44100_128`,
      { "xi-api-key": call.config.apiKey.trim(), Accept: "audio/mpeg" }, { text: call.text, model_id: call.config.model.trim() });
  } catch { throw await failedFetch(call); }
  if (!response.ok) throw httpFailure(call, response.status);
  const bytes = await readBounded(response, TTS_MAX_AUDIO_BYTES, call);
  return audioOf(new Blob([bytes], { type: response.headers.get("content-type")?.split(";")[0].trim() ?? "" }), call);
}

/**
 * One speech request to the configured provider: no retry, no cache. MP3 is asked for because every browser plays it.
 * Resolves to an audio Blob; a stop (`signal`) rejects with the signal's reason, everything else with a TtsError.
 */
export async function synthesizeSpeech(
  config: TtsConfig, input: { text: string; voice: string }, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Blob> {
  const problem = ttsConfigProblem(config);
  if (problem) throw new TtsError(problem, "config");
  const text = input.text.trim(), voice = input.voice.trim();
  if (!text) throw new TtsError("There is nothing to say.", "config");
  if (text.length > TTS_TEXT_LIMIT) throw new TtsError(`Voice text is limited to ${TTS_TEXT_LIMIT} characters.`, "config");
  const provider = providerOf(config);
  if (!voice) throw new TtsError(`Enter a ${provider === "openai" ? "voice" : "voice ID"} in your Voice settings.`, "config");
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? TTS_TIMEOUT_MS);
  const call: Call = { config, text, voice, signal: network.signal, stop: signal, fetchImpl: options.fetchImpl ?? fetch, timedOut: () => timedOut };
  try {
    return await (provider === "minimax" ? minimaxSpeech(call) : provider === "elevenlabs" ? elevenlabsSpeech(call) : openaiSpeech(call));
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}
