import { editsUrl, generationsUrl, imageGenConfigProblem, type ImageGenConfig } from "./config";

export type ImageGenErrorCategory = "config" | "network" | "auth" | "rate-limit" | "http" | "timeout" | "invalid-image";
export class ImageGenError extends Error {
  constructor(message: string, readonly category: ImageGenErrorCategory, readonly httpStatus?: number) { super(message); }
}
export const IMAGEGEN_TIMEOUT_MS = 180_000;
export const IMAGEGEN_MAX_BYTES = 25 * 1024 * 1024;

/** What the person is told. Response bodies are never shown or logged: gateways may echo the key. */
export function imageGenErrorMessage(error: unknown): string {
  if (!(error instanceof ImageGenError)) return "Could not make the picture. Try again.";
  switch (error.category) {
    case "auth": return "The image service rejected the API Key. Check your Image settings.";
    case "rate-limit": return "The image service is busy or over its limit. Try again later.";
    case "timeout": return "The image service did not answer in time. Try again.";
    case "network": return "Could not reach the image service. Check the Base URL and your provider's browser/CORS support.";
    case "invalid-image": return "The image service did not return a usable picture.";
    case "http": return `The image service failed (HTTP ${error.httpStatus}). Check your Image settings.`;
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

/**
 * One OpenAI-compatible request: `/images/generations`, or `/images/edits` when a reference picture is given (the
 * Character's own face). No retry and no cache. The picture is taken from `b64_json`; a plain `url` is fetched once
 * without credentials. A stop (`signal`) rejects with the signal's reason, everything else with an ImageGenError.
 */
export async function generateImage(
  config: ImageGenConfig, input: { prompt: string; reference?: Blob }, signal: AbortSignal,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Blob> {
  const problem = imageGenConfigProblem(config);
  if (problem) throw new ImageGenError(problem, "config");
  const prompt = input.prompt.trim();
  if (!prompt) throw new ImageGenError("There is nothing to draw.", "config");
  const fetchImpl = options.fetchImpl ?? fetch;
  const network = new AbortController();
  const forwardStop = () => network.abort(signal.reason);
  if (signal.aborted) forwardStop(); else signal.addEventListener("abort", forwardStop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; network.abort(); }, options.timeoutMs ?? IMAGEGEN_TIMEOUT_MS);
  const failed = () => { signal.throwIfAborted(); return timedOut ? new ImageGenError("timeout", "timeout") : new ImageGenError("network", "network"); };
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
        if (config.size) form.append("size", config.size);
        form.append("image", input.reference, "reference.png");
        response = await fetchImpl(editsUrl(config.baseUrl), { ...common, headers: auth, body: form });
      } else {
        response = await fetchImpl(generationsUrl(config.baseUrl), { ...common, headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ model: config.model.trim(), prompt, n: 1, ...(config.size ? { size: config.size } : {}) }) });
      }
    } catch { throw failed(); }
    if (!response.ok) throw new ImageGenError("http", response.status === 401 || response.status === 403 ? "auth"
      : response.status === 429 ? "rate-limit" : "http", response.status);
    let body: unknown;
    try { body = await response.json(); } catch { throw failed(); }
    const first = (body as { data?: { b64_json?: unknown; url?: unknown }[] } | null)?.data?.[0];
    let blob: Blob | null = null;
    if (typeof first?.b64_json === "string" && first.b64_json) {
      try { blob = bytesFromBase64(first.b64_json); } catch { throw new ImageGenError("invalid-image", "invalid-image"); }
    } else if (typeof first?.url === "string" && /^https:\/\//i.test(first.url)) {
      try {
        const picture = await fetchImpl(first.url, { method: "GET", signal: network.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!picture.ok) throw new ImageGenError("http", "http", picture.status);
        blob = await picture.blob();
      } catch (error) { if (error instanceof ImageGenError) throw error; throw failed(); }
    }
    if (!blob || !blob.size || blob.size > IMAGEGEN_MAX_BYTES) throw new ImageGenError("invalid-image", "invalid-image");
    const picture = await typedPicture(blob);
    if (!picture) throw new ImageGenError("invalid-image", "invalid-image");
    return picture;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", forwardStop);
  }
}
