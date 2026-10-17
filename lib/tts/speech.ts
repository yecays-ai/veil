import { speechUrl, ttsConfigProblem, TTS_TEXT_LIMIT, type TtsConfig } from "./config";

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
    case "http": return `The voice service failed (HTTP ${error.httpStatus}). Check your Voice settings.`;
    default: return error.message;
  }
}

/**
 * One OpenAI-compatible `/audio/speech` request: no retry, no cache. MP3 is asked for because every browser plays it.
 * Resolves to an audio Blob; a stop (`signal`) rejects with the signal's reason, everything else with a TtsError.
 */
export async function synthesizeSpeech(
  config: TtsConfig, input: { text: string; voice: string }, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Blob> {
  const problem = ttsConfigProblem(config);
  if (problem) throw new TtsError(problem, "config");
  const text = input.text.trim();
  if (!text) throw new TtsError("There is nothing to say.", "config");
  if (text.length > TTS_TEXT_LIMIT) throw new TtsError(`Voice text is limited to ${TTS_TEXT_LIMIT} characters.`, "config");
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? TTS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(speechUrl(config.baseUrl), {
        method: "POST", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey.trim()}` },
        body: JSON.stringify({ model: config.model.trim(), input: text, voice: input.voice.trim(), response_format: "mp3" }),
      });
    } catch {
      signal.throwIfAborted();
      throw timedOut ? new TtsError("timeout", "timeout") : new TtsError("network", "network");
    }
    if (!response.ok) throw new TtsError("http", response.status === 401 || response.status === 403 ? "auth"
      : response.status === 429 ? "rate-limit" : "http", response.status);
    let blob: Blob;
    try { blob = await response.blob(); }
    catch { signal.throwIfAborted(); throw timedOut ? new TtsError("timeout", "timeout") : new TtsError("network", "network"); }
    const type = blob.type.toLowerCase();
    if (!blob.size || blob.size > TTS_MAX_AUDIO_BYTES || !(type.startsWith("audio/") || type === "application/octet-stream" || !type))
      throw new TtsError("audio", "invalid-audio");
    return type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}
