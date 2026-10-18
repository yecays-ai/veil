import { editsUrl, generationsUrl, imageGenConfigProblem, type ImageGenConfig } from "./config";

export type ImageGenErrorCategory = "config" | "network" | "auth" | "rate-limit" | "http" | "timeout" | "invalid-response" | "invalid-image" | "processing" | "storage";
export type ImageGenStage = "configuration" | "generation" | "response" | "download" | "processing" | "storage";
export type RetryImageDownload = (signal: AbortSignal) => Promise<Blob>;
export class ImageGenError extends Error {
  constructor(
    message: string,
    readonly category: ImageGenErrorCategory,
    readonly httpStatus?: number,
    readonly stage: ImageGenStage = "generation",
    /** An opaque, memory-only retry. It captures the returned URL but never exposes it to UI or logs. */
    readonly retryDownload?: RetryImageDownload,
  ) { super(message); }
}
export const IMAGEGEN_TIMEOUT_MS = 180_000;
export const IMAGEGEN_MAX_BYTES = 25 * 1024 * 1024;
/** The JSON that carries a picture as base64 is about a third larger than the picture. */
const IMAGEGEN_MAX_RESPONSE_BYTES = Math.ceil(IMAGEGEN_MAX_BYTES * 4 / 3) + 1024 * 1024;
class BoundedBodyError extends Error {}

/** What the person is told. Response bodies, keys and signed picture URLs are never shown or logged. */
export function imageGenErrorMessage(error: unknown): string {
  if (!(error instanceof ImageGenError)) return "Could not make the picture. Try again.";
  switch (error.category) {
    case "auth": return "The image service rejected the API Key. Check your Image settings.";
    case "rate-limit": return "The image service is busy or over its limit. Try again later.";
    case "timeout": return error.stage === "download"
      ? "The picture was generated, but its download timed out. Try again to download the same picture."
      : error.stage === "response" ? "The image generation service response timed out. Try again."
        : "The image generation service did not answer in time. Try again.";
    case "network": return error.stage === "download"
      ? "The picture was generated, but VEIL could not download it. Try again to download the same picture."
      : "Could not reach the image generation service. Check the Base URL and your provider's browser/CORS support.";
    case "invalid-response": return "The image generation service returned an unreadable response.";
    case "invalid-image": return error.stage === "download"
      ? "The picture was generated, but the downloaded file was not a usable picture."
      : "The image generation service did not return a usable picture.";
    case "processing": return "The picture was received, but VEIL could not prepare it for chat.";
    case "storage": return "The picture was received, but VEIL could not save it in this chat.";
    case "http": return error.stage === "download"
      ? error.retryDownload
        ? `The picture was generated, but its download failed (HTTP ${error.httpStatus}). Try again to download the same picture.`
        : `The generated picture is no longer available (HTTP ${error.httpStatus}). Try again to make a new picture.`
      : `The image generation service failed (HTTP ${error.httpStatus}). Check your Image settings.`;
    default: return error.message;
  }
}

/** The type a picture says it is by its first bytes, whatever the service's headers claim; null for anything else. */
export function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}
async function typedPicture(source: Blob): Promise<Blob | null> {
  const type = sniffImageType(new Uint8Array(await source.slice(0, 12).arrayBuffer()));
  return type ? new Blob([source], { type }) : null;
}
function bytesFromBase64(value: string): Blob {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes]);
}

/** The body of a response, read in pieces so that one larger than `limit` is dropped without being held whole. */
async function readBounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) { void response.body?.cancel().catch(() => {}); throw new BoundedBodyError("body-too-large"); }
  const reader = response.body?.getReader();
  if (!reader) throw new BoundedBodyError("body-unreadable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { void reader.cancel().catch(() => {}); throw new BoundedBodyError("body-too-large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function downloadImage(url: string, signal: AbortSignal, fetchImpl: typeof fetch, timeoutMs: number): Promise<Blob> {
  const retry: RetryImageDownload = (nextSignal) => downloadImage(url, nextSignal, fetchImpl, timeoutMs);
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch {
      signal.throwIfAborted();
      throw new ImageGenError(timedOut ? "download-timeout" : "download-network", timedOut ? "timeout" : "network", undefined, "download", retry);
    }
    const transient = response.status === 408 || response.status === 429 || (response.status >= 500 && response.status < 600);
    if (!response.ok) throw new ImageGenError("download-http", "http", response.status, "download", transient ? retry : undefined);
    let blob: Blob;
    try { blob = new Blob([await readBounded(response, IMAGEGEN_MAX_BYTES)]); }
    catch (error) {
      signal.throwIfAborted();
      if (timedOut) throw new ImageGenError("download-timeout", "timeout", undefined, "download", retry);
      if (!(error instanceof BoundedBodyError)) throw new ImageGenError("download-network", "network", undefined, "download", retry);
      throw new ImageGenError("download-invalid", "invalid-image", undefined, "download");
    }
    if (!blob.size || blob.size > IMAGEGEN_MAX_BYTES) throw new ImageGenError("download-invalid", "invalid-image", undefined, "download");
    const picture = await typedPicture(blob);
    if (!picture) throw new ImageGenError("download-invalid", "invalid-image", undefined, "download");
    return picture;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}

/**
 * One OpenAI-compatible request: `/images/generations`, or `/images/edits` when a reference picture is given (the
 * Character's own face). `b64_json` is requested so browsers do not need a second cross-origin request. Providers
 * that still return a URL remain supported; a failed URL download carries an opaque retry that never regenerates.
 */
export async function generateImage(
  config: ImageGenConfig, input: { prompt: string; reference?: Blob }, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Blob> {
  const problem = imageGenConfigProblem(config);
  if (problem) throw new ImageGenError(problem, "config", undefined, "configuration");
  const prompt = input.prompt.trim();
  if (!prompt) throw new ImageGenError("There is nothing to draw.", "config", undefined, "configuration");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? IMAGEGEN_TIMEOUT_MS;
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, timeoutMs);
  const failed = () => { signal.throwIfAborted(); return new ImageGenError(timedOut ? "generation-timeout" : "generation-network", timedOut ? "timeout" : "network", undefined, "generation"); };
  try {
    const common = { method: "POST", signal: network.signal, credentials: "omit" as const, referrerPolicy: "no-referrer" as const };
    const auth = { Authorization: `Bearer ${config.apiKey.trim()}` };
    let response: Response;
    try {
      if (input.reference) {
        const form = new FormData();
        form.append("model", config.model.trim());
        form.append("prompt", prompt);
        form.append("n", "1");
        form.append("response_format", "b64_json");
        if (config.size) form.append("size", config.size);
        form.append("image", input.reference, "reference.png");
        response = await fetchImpl(editsUrl(config.baseUrl), { ...common, headers: auth, body: form });
      } else {
        response = await fetchImpl(generationsUrl(config.baseUrl), { ...common, headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model.trim(), prompt, n: 1, response_format: "b64_json", ...(config.size ? { size: config.size } : {}) }) });
      }
    } catch { throw failed(); }
    if (!response.ok) throw new ImageGenError("generation-http", response.status === 401 || response.status === 403 ? "auth"
      : response.status === 429 ? "rate-limit" : "http", response.status, "generation");
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(await readBounded(response, IMAGEGEN_MAX_RESPONSE_BYTES))); }
    catch (error) {
      signal.throwIfAborted();
      if (timedOut) throw new ImageGenError("generation-timeout", "timeout", undefined, "response");
      if (!(error instanceof BoundedBodyError) && !(error instanceof SyntaxError))
        throw new ImageGenError("response-network", "network", undefined, "response");
      throw new ImageGenError("invalid-response", "invalid-response", undefined, "response");
    }
    const first = (body as { data?: { b64_json?: unknown; url?: unknown }[] } | null)?.data?.[0];
    if (typeof first?.b64_json === "string" && first.b64_json) {
      let blob: Blob;
      try { blob = bytesFromBase64(first.b64_json); }
      catch { throw new ImageGenError("invalid-image", "invalid-image", undefined, "response"); }
      if (!blob.size || blob.size > IMAGEGEN_MAX_BYTES) throw new ImageGenError("invalid-image", "invalid-image", undefined, "response");
      const picture = await typedPicture(blob);
      if (!picture) throw new ImageGenError("invalid-image", "invalid-image", undefined, "response");
      return picture;
    }
    if (typeof first?.url === "string" && /^https:\/\//i.test(first.url)) return downloadImage(first.url, signal, fetchImpl, timeoutMs);
    throw new ImageGenError("invalid-response", "invalid-response", undefined, "response");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}

