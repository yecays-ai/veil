import { sttSettings, transcriptionUrl, type TtsConfig } from "./config";
import { TtsError, ttsErrorMessage } from "./speech";

export const STT_TIMEOUT_MS = 60_000;

/**
 * One OpenAI-compatible `/audio/transcriptions` request for a recording the person just made: no retry, no cache.
 * Resolves to the recognised words; a stop (`signal`) rejects with the signal's reason, everything else with a TtsError.
 */
export async function transcribeAudio(
  config: TtsConfig, recording: Blob, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const stt = sttSettings(config);
  if ("problem" in stt) throw new TtsError(stt.problem, "config");
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? STT_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("file", recording, `voice.${recording.type.includes("mp4") ? "m4a" : recording.type.includes("ogg") ? "ogg" : "webm"}`);
    form.append("model", stt.model);
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(transcriptionUrl(stt.baseUrl), {
        method: "POST", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${stt.apiKey}` }, body: form,
      });
    } catch {
      signal.throwIfAborted();
      throw timedOut ? new TtsError("timeout", "timeout") : new TtsError("network", "network");
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
  return ttsErrorMessage(error).replace("voice service", "speech-to-text service").replace("Voice settings", "Voice settings (Speech-to-text)")
    .replace("make the voice", "write out the words").replace("playable audio", "any words");
}
