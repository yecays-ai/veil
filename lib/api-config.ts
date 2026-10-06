export type ApiConfig = {
  id: string;
  name?: string;
  provider?: "OpenAI-compatible" | "Custom";
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type NamedApiConfig = ApiConfig & {
  name: string;
  provider: "OpenAI-compatible" | "Custom";
};

export function normalizeApiConfig(config: ApiConfig): NamedApiConfig {
  return {
    ...config,
    name: config.name?.trim() || "Imported Text API",
    provider: config.provider === "OpenAI-compatible" ? "OpenAI-compatible" : "Custom",
  };
}

export const DEFAULT_API_CONFIG_ID = "chat-default";
