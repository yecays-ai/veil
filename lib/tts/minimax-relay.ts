import { MINIMAX_REGIONS, TTS_TEXT_LIMIT, type MinimaxRegion } from "./config";

/**
 * The server half of MiniMax speech. The browser sends the key, model, voice and text here; this makes the one
 * `t2a_v2` call to a MiniMax host chosen from the Region (never from the request) and answers with the MP3 itself.
 * Nothing is stored or logged: not the key, not the text, and not MiniMax's own answer, which is reduced to a category.
 */
export const RELAY_TIMEOUT_MS = 55_000;
export const RELAY_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_UPSTREAM_BYTES = RELAY_MAX_AUDIO_BYTES * 2 + 64 * 1024;

/** The only answers a relay failure carries: a category and, when there is one, MiniMax's HTTP status or numeric code. */
export type RelayFailure = { category: "config" | "auth" | "rate-limit" | "http" | "timeout" | "network" | "invalid-audio"; status?: number; code?: number };
const STATUS: Record<RelayFailure["category"], number> = { config: 400, auth: 401, "rate-limit": 429, http: 502, timeout: 504, network: 502, "invalid-audio": 502 };
const fail = (failure: RelayFailure) => Response.json(failure, { status: STATUS[failure.category], headers: { "Cache-Control": "no-store" } });

async function readBounded(response: Pick<Response, "headers" | "body">, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); return null; }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { void reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** The audio in pieces, so a large answer is streamed to the browser instead of being held in one buffered response. */
const streamOf = (audio: Uint8Array) => {
  let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= audio.length) return controller.close();
    controller.enqueue(audio.subarray(offset, offset + 65536));
    offset += 65536;
  } });
};

type Input = { region: MinimaxRegion; model: string; voice: string; text: string; key: string };
async function parse(request: Request): Promise<Input | null> {
  const key = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!key || key.length > 1024) return null;
  let raw: unknown;
  // Read in pieces and stop at the limit, so a body without a length cannot be buffered whole.
  try { const bytes = await readBounded(request, MAX_REQUEST_BYTES); if (!bytes) return null; raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const { region, model, voice, text } = raw as Record<string, unknown>;
  if (region !== "global" && region !== "cn") return null;
  if (typeof model !== "string" || typeof voice !== "string" || typeof text !== "string") return null;
  const clean = { model: model.trim(), voice: voice.trim(), text: text.trim() };
  if (!clean.model || clean.model.length > 100 || !clean.voice || clean.voice.length > 256 || !clean.text || clean.text.length > TTS_TEXT_LIMIT) return null;
  return { region, ...clean, key };
}

export async function relayMinimaxSpeech(request: Request, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<Response> {
  // Only VEIL's own pages may use this: a request from another site's script is refused before anything is read.
  const origin = request.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== new URL(request.url).host) return new Response(null, { status: 403 }); } catch { return new Response(null, { status: 403 }); } }
  const input = await parse(request);
  if (!input) return fail({ category: "config" });
  // The host comes from this table alone, so the relay cannot be pointed at any other address.
  const host = MINIMAX_REGIONS.find((item) => item.id === input.region)!.host;
  const upstream = new AbortController();
  let timedOut = false;
  const stop = () => upstream.abort();
  if (request.signal.aborted) stop(); else request.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs ?? RELAY_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(`${host}/v1/t2a_v2`, { method: "POST", signal: upstream.signal, redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, text: input.text, stream: false, output_format: "hex", voice_setting: { voice_id: input.voice },
          audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 } }) });
    } catch { return fail({ category: timedOut ? "timeout" : "network" }); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const status = response.status;
      return fail({ category: status === 401 || status === 403 ? "auth" : status === 429 ? "rate-limit" : "http", status });
    }
    let bytes: Uint8Array | null;
    try { bytes = await readBounded(response, MAX_UPSTREAM_BYTES); } catch { return fail({ category: timedOut ? "timeout" : "network" }); }
    if (!bytes) return fail({ category: "invalid-audio" });
    let body: { data?: { audio?: unknown } | null; base_resp?: { status_code?: unknown } } | null;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return fail({ category: "invalid-audio" }); }
    const code = body?.base_resp?.status_code;
    if (typeof code === "number" && code !== 0) {
      // Only the number leaves: `status_msg` is MiniMax's own text and is dropped.
      if (code === 1004) return fail({ category: "auth", code });
      if (code === 1002 || code === 1039) return fail({ category: "rate-limit", code });
      if (code === 1001) return fail({ category: "timeout", code });
      return fail({ category: "http", code });
    }
    const hex = body?.data?.audio;
    if (typeof hex !== "string" || !hex || hex.length % 2 || hex.length > RELAY_MAX_AUDIO_BYTES * 2 || !/^[0-9a-f]+$/i.test(hex)) return fail({ category: "invalid-audio" });
    const audio = new Uint8Array(Buffer.from(hex, "hex"));
    return new Response(streamOf(audio), { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", stop);
  }
}
