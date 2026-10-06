import { createChatEngine as createEngine } from "../lib/chat/engine";
import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../lib/api-config";

export const TEST_API_CONFIG: ApiConfig = {
  id: DEFAULT_API_CONFIG_ID,
  baseUrl: "https://example.test/v1",
  apiKey: "test",
  model: "test",
};

export function createChatEngine(...args: Parameters<typeof createEngine>) {
  args[9] ??= async (id) => id === TEST_API_CONFIG.id ? TEST_API_CONFIG : undefined;
  return createEngine(...args);
}
