import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import { resolveBindings, type BindingDocument } from "../bindings";
import { validateApiConfig } from "../chat/provider";

/** Why a Character has no usable maintenance model; shown in Settings without any key or URL. */
export class MaintenanceModelError extends Error {
  constructor(readonly code: "disabled" | "missing" | "invalid", message: string) { super(message); }
}

/** Undefined follows the actual Messages chain; null and invalid explicit IDs never fall back. */
export async function resolveMaintenanceModel(bindings: BindingDocument, characterId: string,
  read: (id: string) => Promise<ApiConfig | null | undefined>): Promise<ApiConfig> {
  const binding = resolveBindings(bindings, characterId, "messages");
  const id = binding.memoryApiConfigId === undefined ? binding.apiConfigId : binding.memoryApiConfigId;
  if (id === null) throw new MaintenanceModelError("disabled", "Memory maintenance model is disabled.");
  const selectedId = id ?? DEFAULT_API_CONFIG_ID;
  const config = await read(selectedId);
  if (!config || config.id !== selectedId) throw new MaintenanceModelError("missing", "The selected Memory maintenance model is missing.");
  try { validateApiConfig(config); }
  catch (reason) { throw new MaintenanceModelError("invalid", reason instanceof Error ? reason.message : "The Memory maintenance model is not configured."); }
  return config;
}
