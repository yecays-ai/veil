export type ApiConfig = {
  id: string;
  name?: string;
  provider?: "OpenAI-compatible" | "Custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  /** The model accepts pictures. Absent means no: such a model answers a picture request with HTTP 400. */
  imageInput?: boolean;
  /** How many of the newest chat pictures one request carries, 1 to MAX_IMAGE_INPUT_LIMIT. */
  imageLimit?: number;
};
export const DEFAULT_IMAGE_INPUT_LIMIT = 1, MAX_IMAGE_INPUT_LIMIT = 4;
/** Pictures a request through this API may carry; 0 unless the API was marked as accepting them. */
export function imageInputLimit(config: Pick<ApiConfig, "imageInput" | "imageLimit">): number {
  if (config.imageInput !== true) return 0;
  const limit = config.imageLimit;
  return Number.isInteger(limit) && limit! >= 1 && limit! <= MAX_IMAGE_INPUT_LIMIT ? limit! : DEFAULT_IMAGE_INPUT_LIMIT;
}

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
