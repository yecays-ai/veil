import { transcriptionUrl, ttsConfigProblem, type TtsConfig } from "./config";
import { TtsError } from "./speech";

export const STT_TIMEOUT_MS = 60_000;

/**
 * One OpenAI-compatible `/audio/transcriptions` request for a recording the person just made: no retry, no cache.
 * Resolves to the recognised words; a stop (`signal`) rejects with the signal's reason, everything else with a TtsError.
 */
export async function transcribeAudio(
  config: TtsConfig, recording: Blob, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const problem = ttsConfigProblem(config);
  if (problem) throw new TtsError(problem, "config");
  if (!config.sttModel?.trim()) throw new TtsError("Add a Speech-to-text model in your Voice settings.", "config");
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? STT_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("file", recording, `voice.${recording.type.includes("mp4") ? "m4a" : recording.type.includes("ogg") ? "ogg" : "webm"}`);
    form.append("model", config.sttModel!.trim());
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(transcriptionUrl(config.baseUrl), {
        method: "POST", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` }, body: form,
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
