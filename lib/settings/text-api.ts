import type { BindingStorage } from "../binding-storage";
import type { ApiConfig, NamedApiConfig } from "../api-config";
import type { ApiConfigStorage } from "../api-config-storage";
import { completionUrl, validateApiConfig } from "../chat/provider";
import type { BindingDocument } from "../bindings";
import { withoutApiConfigBinding } from "../bindings";
import { browserPersistenceWriteGate, withPersistenceWriteScope, type PersistenceWriteGate, type PersistenceWriteScope } from "../backup/persistence-write-gate";
import { completionTerminalOutcome, createCompletionRequestContext, logCompletionStart, logCompletionUsage,
  parseCompletionUsage, startCompletionTerminal, type CompletionErrorCategory,
  type CompletionTerminal, type CompletionUsage } from "../chat/request-diagnostics";

/** An error with a fixed message; the category is what the terminal diagnostic reports. */
class ApiRequestError extends Error {
  constructor(message: string, readonly category: CompletionErrorCategory, readonly httpStatus?: number) { super(message); }
}

/** The configuration delete, its Binding cleanup and any rollback hold one backup lease, so a snapshot sees none of the steps half-done. */
export function deleteApiConfigAndBindings(
  id: string, storage: ApiConfigStorage, bindings: Pick<BindingStorage, "transact">,
  expected?: NamedApiConfig, writeGate: PersistenceWriteGate = browserPersistenceWriteGate,
): Promise<void> {
  return withPersistenceWriteScope(writeGate, (scope) => deleteWithScope(id, storage, bindings, expected, scope));
}

async function deleteWithScope(id: string, storage: ApiConfigStorage, bindings: Pick<BindingStorage, "transact">,
  expected: NamedApiConfig | undefined, scope: PersistenceWriteScope): Promise<void> {
  const previous = expected ?? await storage.getApiConfig(id, scope);
  if (!previous) return;
  await storage.deleteApiConfig(id, previous, scope);
  try {
    await bindings.transact((current) => withoutApiConfigBinding(current, id), scope);
  } catch (reason) {
    if (!await storage.restoreApiConfigIfAbsent(previous, scope))
      throw new Error("Text API changed while deletion cleanup failed. Newer data was kept.", { cause: reason });
    throw reason;
  }
}

export function apiConfigReferences(
  bindings: BindingDocument,
  id: string,
): string[] {
  const result: string[] = [];
  if (bindings.global.apiConfigId === id) result.push("Global");
  for (const [characterId, value] of Object.entries(bindings.characters)) {
    if (value.defaults.apiConfigId === id)
      result.push(`Character ${characterId}`);
    for (const [app, slot] of Object.entries(value.apps)) {
      if (slot?.apiConfigId === id)
        result.push(`Character ${characterId} / ${app}`);
    }
  }
  return result;
}
export function modelsUrl(baseUrl: string) {
  return completionUrl(baseUrl).replace(/\/chat\/completions$/, "/models");
}
async function apiRequest(
  config: ApiConfig,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: signal ?? AbortSignal.timeout(30000),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
    });
  } catch {
    throw new ApiRequestError(
      "Could not reach the API. Check the Base URL, network and browser/CORS support.", "network",
    );
  }
  // Never surface provider bodies, thrown fetch messages or generated content:
  // any of them may echo the credential.
  if (!response.ok)
    throw new ApiRequestError(
      `API request failed (HTTP ${response.status}). Check credentials and endpoint support.`, "http", response.status,
    );
  try {
    return await response.json();
  } catch {
    throw new ApiRequestError("The API returned an invalid JSON response.", "invalid-reply");
  }
}
export async function testTextApiConnection(
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<void> {
  validateApiConfig(config);
  const messages = [{ role: "user" as const, content: "Reply with OK only." }];
  const request = createCompletionRequestContext("test-connection");
  let usage: CompletionUsage | null = null;
  const finishTerminal = startCompletionTerminal(request, { model: config.model, messages });
  let end: CompletionTerminal = { outcome: "abandoned" };
  logCompletionStart(request, config.model.trim(), messages, false);
  try {
    const data = await apiRequest(
      config,
      completionUrl(config.baseUrl),
      {
        method: "POST",
        body: JSON.stringify({ model: config.model.trim(), stream: false, messages, max_tokens: 64 }),
      },
      signal,
    );
    usage = parseCompletionUsage(data);
    if (data?.error || !Array.isArray(data?.choices) || !data.choices.length)
      throw new ApiRequestError("The API returned no completion. Check the selected model.", "no-completion");
    // A valid completion with reasoning/length finish is still connectivity proof;
    // the small cap intentionally bounds cost rather than validating reply quality.
    const finishReason = data.choices[0]?.finish_reason;
    end = { outcome: completionTerminalOutcome(typeof finishReason === "string" ? finishReason : undefined),
      finishReason: typeof finishReason === "string" ? finishReason : undefined };
  } catch (error) {
    end = signal?.aborted ? { outcome: "cancelled" }
      : error instanceof ApiRequestError ? { outcome: "error", errorCategory: error.category, httpStatus: error.httpStatus }
      : { outcome: "error", errorCategory: "network" };
    throw error;
  } finally {
    logCompletionUsage(request, usage);
    finishTerminal(end, usage);
  }
}
export async function fetchTextApiModels(
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  completionUrl(config.baseUrl);
  if (!config.apiKey.trim())
    throw new Error("Enter an API Key before fetching models.");
  const data = await apiRequest(
    config,
    modelsUrl(config.baseUrl),
    { method: "GET" },
    signal,
  );
  if (!Array.isArray(data?.data))
    throw new Error("Model listing is unavailable. Enter a model manually.");
  return [
    ...new Set<string>(
      data.data
        .map((item: { id?: unknown }) => item?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" &&
            !!id.trim() &&
            !id.includes(config.apiKey.trim()),
        ),
    ),
  ].sort();
}
