import { DEFAULT_API_CONFIG_ID, type ApiConfig } from "../api-config";
import type { BindingDocument } from "../bindings";
import { validateApiConfig } from "../chat/provider";

/**
 * What the Memory model is at the global level of Settings → API, using the same rule Memory Maintenance applies
 * (see resolveMaintenanceModel): an unset choice follows the Default API, null turns Memory off, and a missing or
 * unusable choice is reported, never replaced by another API.
 */
export type MemoryApiState =
  | { kind: "ready"; source: "default" | "custom"; id: string; name: string; model: string }
  | { kind: "off" }
  | { kind: "missing"; source: "default" | "custom" }
  | { kind: "invalid"; source: "default" | "custom"; reason: string };

export const defaultApiId = (bindings: BindingDocument): string | null =>
  bindings.global.apiConfigId === undefined ? DEFAULT_API_CONFIG_ID : bindings.global.apiConfigId;

export function memoryApiState(bindings: BindingDocument, configs: readonly (ApiConfig & { name?: string })[]): MemoryApiState {
  const own = bindings.global.memoryApiConfigId;
  if (own === null) return { kind: "off" };
  const source = own === undefined ? "default" : "custom";
  const id = own === undefined ? defaultApiId(bindings) : own;
  if (id === null) return { kind: "off" };
  const config = configs.find((item) => item.id === id);
  if (!config) return { kind: "missing", source };
  try { validateApiConfig(config); }
  catch (reason) { return { kind: "invalid", source, reason: reason instanceof Error ? reason.message : "This API is not fully set up." }; }
  return { kind: "ready", source, id, name: config.name ?? config.id, model: config.model };
}
