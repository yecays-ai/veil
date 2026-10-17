import { endpointUrl } from "../chat/provider";

/** The speech service of this device. The key stays on the device like a Text API key and is never part of a backup. */
export type TtsConfig = { baseUrl: string; apiKey: string; model: string; voice: string;
  /** Optional speech-to-text model on the same service (`/audio/transcriptions`), used to fill in the words of a recorded voice message. */
  sttModel?: string };
export const EMPTY_TTS_CONFIG: TtsConfig = { baseUrl: "", apiKey: "", model: "", voice: "" };
/** OpenAI's documented limit for one `/audio/speech` input. */
export const TTS_TEXT_LIMIT = 4096;
export const DEFAULT_TTS_VOICE = "alloy";

export function speechUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, "/audio/speech");
}

export function transcriptionUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, "/audio/transcriptions");
}

export function normalizeTtsConfig(value: unknown): TtsConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: keyof TtsConfig) => typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  return { baseUrl: text("baseUrl"), apiKey: text("apiKey"), model: text("model"), voice: text("voice"), ...(text("sttModel") ? { sttModel: text("sttModel") } : {}) };
}

/** Why the config cannot be used yet, or null when it can. */
export function ttsConfigProblem(config: TtsConfig): string | null {
  try { speechUrl(config.baseUrl); } catch (error) { return error instanceof Error ? error.message : "Enter a valid API Base URL."; }
  return config.apiKey.trim() && config.model.trim() ? null : "Enter an API Key and a Model for Voice.";
}

/** Character's own voice, else the global binding, else the config's default voice, else the service default. */
export function resolveVoice(
  slot: { ttsVoice?: string | null }, config: Pick<TtsConfig, "voice">,
): string {
  return slot.ttsVoice?.trim() || config.voice.trim() || DEFAULT_TTS_VOICE;
}
