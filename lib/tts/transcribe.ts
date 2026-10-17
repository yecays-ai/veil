import { sttSettings, transcriptionUrl, type TtsConfig } from "./config";
import { TtsError, ttsErrorMessage } from "./speech";

export const STT_TIMEOUT_MS = 60_000;
const PROBE_MS = 8000;

/**
 * A request that never got an answer: a browser reports "blocked by CORS" and "could not connect" the same way, so one key-less,
 * body-less no-cors request to the service's origin tells them apart. It runs once, only after a failure.
 */
async function unreachable(baseUrl: string, fetchImpl: typeof fetch, stop: AbortSignal): Promise<TtsError> {
  const url = new URL(transcriptionUrl(baseUrl)), info = { provider: "openai" as const, host: url.host };
  const probe = new AbortController(), abort = () => probe.abort(), timer = setTimeout(abort, PROBE_MS);
  stop.addEventListener("abort", abort, { once: true });
  try {
    await fetchImpl(`${url.origin}/`, { method: "GET", mode: "no-cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: probe.signal });
    return new TtsError("cors", "cors", undefined, info);
  } catch {
    stop.throwIfAborted();
    return new TtsError("network", "network", undefined, info);
  } finally { clearTimeout(timer); stop.removeEventListener("abort", abort); }
}

/**
 * One OpenAI-compatible `/audio/transcriptions` request for a recording the person just made: no retry, no cache.
 * Resolves to the recognised words; a stop (`signal`) rejects with the signal's reason, everything else with a TtsError.
 */
export async function transcribeAudio(
  config: TtsConfig, recording: Blob, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const stt = sttSettings(config);
  if ("problem" in stt) throw new TtsError(stt.problem, "config");
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? STT_TIMEOUT_MS);
  try {
    // A recording read back from IndexedDB is a file-backed blob; iOS Safari can fail a request that uploads one, so the upload is an in-memory copy.
    let bytes: ArrayBuffer;
    try { bytes = await recording.arrayBuffer(); }
    catch { signal.throwIfAborted(); throw new TtsError("invalid-audio", "invalid-audio"); }
    const upload = new Blob([bytes], { type: recording.type });
    const form = new FormData();
    form.append("file", upload, `voice.${recording.type.includes("mp4") ? "m4a" : recording.type.includes("ogg") ? "ogg" : "webm"}`);
    form.append("model", stt.model);
    let response: Response;
    try {
      response = await fetchImpl(transcriptionUrl(stt.baseUrl), {
        method: "POST", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${stt.apiKey}` }, body: form,
      });
    } catch {
      signal.throwIfAborted();
      throw timedOut ? new TtsError("timeout", "timeout") : await unreachable(stt.baseUrl, fetchImpl, signal);
    }
    if (!response.ok) throw new TtsError("http", response.status === 401 || response.status === 403 ? "auth"
      : response.status === 429 ? "rate-limit" : "http", response.status);
    let body: unknown;
    try { body = await response.json(); }
    catch { signal.throwIfAborted(); throw new TtsError("invalid-audio", "invalid-audio"); }
    const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text.trim() : "";
    if (!text) throw new TtsError("invalid-audio", "invalid-audio");
    return text;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}

/** What the person is told when the words of a recording could not be written out; response bodies are never shown. */
export function sttErrorMessage(error: unknown): string {
  if (!(error instanceof TtsError)) return "Could not write out the words. Try again.";
  if (error.category === "config") return error.message;
  const host = error.info?.host;
  if (host && error.category === "network") return `The speech-to-text request failed and the service (${host}) did not answer a plain check either. Check your connection and the Speech-to-text Base URL.`;
  if (host && error.category === "cors") return `The speech-to-text request failed although the service (${host}) answered a plain check, most likely because this browser blocked it (CORS).`;
  return ttsErrorMessage(error).replace("voice service", "speech-to-text service").replace("Voice settings", "Voice settings (Speech-to-text)")
    .replace("make the voice", "write out the words").replace("playable audio", "any words");
}
