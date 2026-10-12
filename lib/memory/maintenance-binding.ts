import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { resolveBindings, type BindingDocument } from "../bindings";
import { validateApiConfig } from "../chat/provider";

/** Undefined follows the actual Messages chain; null and invalid explicit IDs never fall back. */
export async function resolveMaintenanceModel(bindings: BindingDocument, characterId: string,
  read: (id: string) => Promise<ApiConfig | null | undefined>): Promise<ApiConfig> {
  const binding = resolveBindings(bindings, characterId, "messages");
  const id = binding.memoryApiConfigId === undefined ? binding.apiConfigId : binding.memoryApiConfigId;
  if (id === null) throw new Error("Memory maintenance model is disabled.");
  const selectedId = id ?? DEFAULT_API_CONFIG_ID;
  const config = await read(selectedId);
  if (!config || config.id !== selectedId) throw new Error("The selected Memory maintenance model is missing.");
  validateApiConfig(config);
  return config;
}
