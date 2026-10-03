import type { ApiConfig } from "../chat/types";
import { completionUrl, validateApiConfig } from "../chat/provider";
import type { BindingDocument } from "../bindings";

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
    throw new Error(
      "Could not reach the API. Check the Base URL, network and browser/CORS support.",
    );
  }
  // Never surface provider bodies, thrown fetch messages or generated content:
  // any of them may echo the credential.
  if (!response.ok)
    throw new Error(
      `API request failed (HTTP ${response.status}). Check credentials and endpoint support.`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error("The API returned an invalid JSON response.");
  }
}
export async function testTextApiConnection(
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<void> {
  validateApiConfig(config);
  const data = await apiRequest(
    config,
    completionUrl(config.baseUrl),
    {
      method: "POST",
      body: JSON.stringify({
        model: config.model.trim(),
        stream: false,
        messages: [{ role: "user", content: "Reply with OK only." }],
        max_tokens: 64,
      }),
    },
    signal,
  );
  if (data?.error || !Array.isArray(data?.choices) || !data.choices.length)
    throw new Error(
      "The API returned no completion. Check the selected model.",
    );
  // A valid completion with reasoning/length finish is still connectivity proof;
  // the small cap intentionally bounds cost rather than validating reply quality.
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
