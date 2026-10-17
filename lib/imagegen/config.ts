import { endpointUrl } from "../chat/provider";
import { DeviceConfigStorage } from "../device-config-storage";

/** The image service of this device. The key stays on the device like a Text API key and is never part of a backup. */
export type ImageGenConfig = { baseUrl: string; apiKey: string; model: string; size?: string };
export const EMPTY_IMAGEGEN_CONFIG: ImageGenConfig = { baseUrl: "", apiKey: "", model: "" };
export const IMAGEGEN_PROMPT_MAX = 400;

export const generationsUrl = (baseUrl: string) => endpointUrl(baseUrl, "/images/generations");
export const editsUrl = (baseUrl: string) => endpointUrl(baseUrl, "/images/edits");

export function normalizeImageGenConfig(value: unknown): ImageGenConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: keyof ImageGenConfig) => typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  const size = /^\d{3,4}x\d{3,4}$/.test(text("size")) ? text("size") : "";
  return { baseUrl: text("baseUrl"), apiKey: text("apiKey"), model: text("model"), ...(size ? { size } : {}) };
}

/** Why the config cannot be used yet, or null when it can. */
export function imageGenConfigProblem(config: ImageGenConfig): string | null {
  try { generationsUrl(config.baseUrl); } catch (error) { return error instanceof Error ? error.message : "Enter a valid API Base URL."; }
  return config.apiKey.trim() && config.model.trim() ? null : "Enter an API Key and a Model for Images.";
}

export const IMAGEGEN_DATABASE_NAME = "veil-imagegen-config-v1";
export class ImageGenConfigStorage extends DeviceConfigStorage<ImageGenConfig> {
  constructor(factory?: () => IDBFactory) { super(IMAGEGEN_DATABASE_NAME, "Image settings", normalizeImageGenConfig, EMPTY_IMAGEGEN_CONFIG, factory); }
}
export const browserImageGenConfigStorage = new ImageGenConfigStorage();
