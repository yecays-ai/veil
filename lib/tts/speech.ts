import { providerOf, speechEndpoint, ttsConfigProblem, TTS_TEXT_LIMIT, type TtsConfig } from "./config";

export type TtsErrorCategory = "config" | "network" | "auth" | "rate-limit" | "http" | "timeout" | "invalid-audio";
export class TtsError extends Error {
  constructor(message: string, readonly category: TtsErrorCategory, readonly httpStatus?: number) { super(message); }
}
export const TTS_TIMEOUT_MS = 60_000;
export const TTS_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** What the person is told. Response bodies are never shown or logged: gateways may echo the key. */
export function ttsErrorMessage(error: unknown): string {
  if (!(error instanceof TtsError)) return "Could not make the voice. Try again.";
  switch (error.category) {
    case "auth": return "The voice service rejected the API Key. Check your Voice settings.";
    case "rate-limit": return "The voice service is busy or over its limit. Try again later.";
    case "timeout": return "The voice service did not answer in time. Try again.";
    case "network": return "Could not reach the voice service. Check the Base URL and your provider's browser/CORS support.";
    case "invalid-audio": return "The voice service did not return playable audio.";
    case "http": return error.httpStatus ? `The voice service failed (HTTP ${error.httpStatus}). Check your Voice settings.`
      : "The voice service could not make this voice. Check your Voice settings.";
    default: return error.message;
  }
}

const failedFetch = (signal: AbortSignal, timedOut: boolean) => {
  signal.throwIfAborted();
  return timedOut ? new TtsError("timeout", "timeout") : new TtsError("network", "network");
};
const httpFailure = (status: number) => new TtsError("http", status === 401 || status === 403 ? "auth" : status === 429 ? "rate-limit" : "http", status);

/** The whole body, read in pieces so that one larger than `limit` is dropped without being held whole. */
async function readBounded(response: Response, limit: number, failed: () => Error): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); throw new TtsError("audio", "invalid-audio"); }
  const reader = response.body?.getReader();
  if (!reader) throw new TtsError("audio", "invalid-audio");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { void reader.cancel().catch(() => {}); throw new TtsError("audio", "invalid-audio"); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof TtsError) throw error; throw failed(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

type Call = { config: TtsConfig; text: string; voice: string; signal: AbortSignal; stop: AbortSignal; fetchImpl: typeof fetch; timedOut: () => boolean };
const audioOf = (blob: Blob): Blob => {
  const type = blob.type.toLowerCase();
  if (!blob.size || blob.size > TTS_MAX_AUDIO_BYTES || !(type.startsWith("audio/") || type === "application/octet-stream" || !type))
    throw new TtsError("audio", "invalid-audio");
  return type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
};
const post = (call: Call, url: string, headers: Record<string, string>, body: unknown) =>
  call.fetchImpl(url, { method: "POST", signal: call.signal, credentials: "omit", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

/** OpenAI-compatible `/audio/speech`. */
async function openaiSpeech(call: Call): Promise<Blob> {
  let response: Response;
  try {
    response = await post(call, speechEndpoint(call.config), { Authorization: `Bearer ${call.config.apiKey.trim()}` },
      { model: call.config.model.trim(), input: call.text, voice: call.voice, response_format: "mp3" });
  } catch { throw failedFetch(call.stop, call.timedOut()); }
  if (!response.ok) throw httpFailure(response.status);
  let blob: Blob;
  try { blob = await response.blob(); }
  catch { throw failedFetch(call.stop, call.timedOut()); }
  return audioOf(blob);
}

/** MiniMax `t2a_v2`: a JSON answer whose `data.audio` is the MP3 as hex; `base_resp` says what went wrong. */
async function minimaxSpeech(call: Call): Promise<Blob> {
  let response: Response;
  try {
    response = await post(call, speechEndpoint(call.config), { Authorization: `Bearer ${call.config.apiKey.trim()}` },
      { model: call.config.model.trim(), text: call.text, stream: false, output_format: "hex",
        voice_setting: { voice_id: call.voice }, audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 } });
  } catch { throw failedFetch(call.stop, call.timedOut()); }
  if (!response.ok) throw httpFailure(response.status);
  const bytes = await readBounded(response, TTS_MAX_AUDIO_BYTES * 2 + 64 * 1024, () => failedFetch(call.stop, call.timedOut()));
  let body: { data?: { audio?: unknown } | null; base_resp?: { status_code?: unknown } } | null;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TtsError("audio", "invalid-audio"); }
  const code = body?.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) {
    if (code === 1004) throw new TtsError("auth", "auth");
    if (code === 1002 || code === 1039) throw new TtsError("rate-limit", "rate-limit");
    if (code === 1001) throw new TtsError("timeout", "timeout");
    throw new TtsError("http", "http");
  }
  const hex = body?.data?.audio;
  if (typeof hex !== "string" || !hex || hex.length % 2 || hex.length > TTS_MAX_AUDIO_BYTES * 2 || !/^[0-9a-f]+$/i.test(hex))
    throw new TtsError("audio", "invalid-audio");
  const audio = new Uint8Array(hex.length / 2);
  for (let index = 0; index < audio.length; index++) audio[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return audioOf(new Blob([audio], { type: "audio/mpeg" }));
}

/** ElevenLabs `text-to-speech/{voice_id}`: the answer is the MP3 itself. */
async function elevenlabsSpeech(call: Call): Promise<Blob> {
  let response: Response;
  try {
    response = await post(call, `${speechEndpoint(call.config)}/${encodeURIComponent(call.voice)}?output_format=mp3_44100_128`,
      { "xi-api-key": call.config.apiKey.trim(), Accept: "audio/mpeg" }, { text: call.text, model_id: call.config.model.trim() });
  } catch { throw failedFetch(call.stop, call.timedOut()); }
  if (!response.ok) throw httpFailure(response.status);
  const bytes = await readBounded(response, TTS_MAX_AUDIO_BYTES, () => failedFetch(call.stop, call.timedOut()));
  return audioOf(new Blob([bytes], { type: response.headers.get("content-type")?.split(";")[0].trim() ?? "" }));
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
