import type { ApiConfig } from "../api-config";
import { isTruncatedReason, type PromptTurn } from "./types";
import type { GenerationParameters } from "../preset";
import {
  createCompletionRequestContext,
  logCompletionStart,
  logCompletionUsage,
  parseCompletionUsage,
  type CompletionRequestContext,
  type CompletionUsage,
} from "./request-diagnostics";

export function completionUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error("Enter a valid API Base URL.");
  }
  const localDevelopmentHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" && !localDevelopmentHost) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use HTTPS, or HTTP on localhost, without credentials, query parameters or a fragment.",
    );
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions")
    ? path
    : `${path}/chat/completions`;
  return url.href;
}
export function validateApiConfig(config: ApiConfig) {
  completionUrl(config.baseUrl);
  if (!config.apiKey.trim() || !config.model.trim())
    throw new Error("Configure API Key and Model in Settings → Text API.");
}
export type TextProvider = (
  config: ApiConfig,
  messages: PromptTurn[],
  signal: AbortSignal,
  generation?: GenerationParameters,
  request?: CompletionRequestContext,
  terminal?: (finishReason: string) => void,
) => AsyncIterable<string>;

function choice(value: unknown): { text: string; finishReason?: string } {
  const data = value as {
    error?: unknown;
    choices?: {
      delta?: { content?: unknown };
      message?: { content?: unknown };
      finish_reason?: unknown;
    }[];
  };
  if (!data || data.error)
    throw new Error("The API returned an invalid reply.");
  const first = data.choices?.[0];
  const text = first?.delta?.content ?? first?.message?.content;
  return {
    text: typeof text === "string" ? text : "",
    finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : undefined,
  };
}
/** How long the API may take to start answering, and how long an open reply may go silent. */
export const MODEL_CONNECT_TIMEOUT_MS = 30_000;
export const MODEL_IDLE_TIMEOUT_MS = 45_000;
class ModelTimeoutError extends Error {}

/** Races `work` against a deadline; on expiry `abort` cancels the underlying request and the caller gets `message`. */
function withDeadline<T>(ms: number, work: Promise<T>, abort: () => void, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ModelTimeoutError(message)); abort(); }, ms); // reject first: the abort makes `work` fail too
  });
  work.catch(() => {}); // a request abandoned at its deadline may still fail later; that is not a new error
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export function createOpenAITextProvider(
  timeouts: { connectMs: number; idleMs: number } = { connectMs: MODEL_CONNECT_TIMEOUT_MS, idleMs: MODEL_IDLE_TIMEOUT_MS },
): TextProvider {
  return async function* (
  config,
  messages,
  signal,
  generation,
  request,
  terminal,
) {
  validateApiConfig(config);
  const context = request ?? createCompletionRequestContext("unclassified");
  let usage: CompletionUsage | null = null;
  logCompletionStart(context, config.model.trim(), messages, true);
  // The request has its own controller so a timeout can cancel it; the caller's Stop is forwarded to it.
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  const cancelRequest = () => network.abort();
  try {
    let response: Response;
    try {
      response = await withDeadline(timeouts.connectMs, fetch(completionUrl(config.baseUrl), {
        method: "POST",
        signal: network.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model.trim(),
          messages,
          stream: true,
          ...(generation?.temperature !== undefined
            ? { temperature: generation.temperature } : {}),
          ...(generation?.maxTokens !== undefined
            ? { max_tokens: generation.maxTokens } : {}),
        }),
      }), cancelRequest, "The API did not respond in time. Try again.");
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ModelTimeoutError) throw error;
      throw new Error(
        "Could not reach the API. Check the Base URL and your provider's browser/CORS support.",
      );
    }
    // Never display/log response bodies: gateways may echo Authorization keys.
    if (!response.ok)
      throw new Error(
        `API request failed (HTTP ${response.status}). Check your API settings.`,
      );
    if (response.headers.get("content-type")?.includes("application/json")) {
      let data: unknown;
    try {
        data = await withDeadline(timeouts.idleMs, response.json(), cancelRequest, "The API stopped sending its reply. Try again.");
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ModelTimeoutError) throw error;
        throw new Error("The API returned an invalid reply.");
      }
      usage = parseCompletionUsage(data);
      const result = choice(data);
      if (result.text) yield result.text;
      if (result.finishReason) terminal?.(result.finishReason);
      return;
    }
    if (!response.body) throw new Error("The API returned no response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      lines: string[] = [],
      finished = false;
    function event() {
      const payload = lines.join("\n");
      lines = [];
      if (!payload) return { text: "", done: false };
      if (payload.trim() === "[DONE]") return { text: "", done: true };
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch {
        throw new Error("The API returned an invalid stream event.");
      }
      usage = parseCompletionUsage(data) ?? usage;
      const result = choice(data);
      finished ||= !!result.finishReason;
      if (result.finishReason) terminal?.(result.finishReason);
      // The provider has explicitly ended output at its token budget. Do not
      // leave visible truncated text hostage to an optional later [DONE] frame.
      return { text: result.text, done: isTruncatedReason(result.finishReason) };
    }
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await withDeadline(timeouts.idleMs, reader.read(), cancelRequest,
          "The reply stopped arriving. Retry to continue.");
        buffer += decoder.decode(value, { stream: !done });
        if (done) buffer += "\n\n";
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
          else if (!line) {
            const result = event();
            if (result.text) yield result.text;
            if (result.done) return;
          }
        }
        if (done) break;
      }
      if (!finished) throw new Error("The reply stream ended unexpectedly.");
    } finally {
      // A stalled stream may never answer cancel(), so do not wait for it.
      void reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* the stream is already gone */ }
    }
  } finally {
    signal.removeEventListener("abort", forwardStop);
    logCompletionUsage(context, usage);
  }
  };
}
export const openAITextProvider: TextProvider = createOpenAITextProvider();
