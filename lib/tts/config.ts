import { endpointUrl } from "../chat/provider";

export type TtsProvider = "openai" | "minimax" | "elevenlabs";
export const TTS_PROVIDERS: readonly { id: TtsProvider; label: string }[] = [
  { id: "openai", label: "OpenAI-compatible" }, { id: "minimax", label: "MiniMax" }, { id: "elevenlabs", label: "ElevenLabs" },
];
/** Where MiniMax and ElevenLabs are reached when no Base URL override is given. OpenAI-compatible has no default host. */
export const DEFAULT_TTS_BASE_URL: Record<Exclude<TtsProvider, "openai">, string> = {
  minimax: "https://api.minimax.io", elevenlabs: "https://api.elevenlabs.io",
};

/**
 * The speech service of this device. The key stays on the device like a Text API key and is never part of a backup.
 * A config saved before providers existed has no `provider` and is an OpenAI-compatible service.
 */
export type TtsConfig = { provider?: TtsProvider; baseUrl: string; apiKey: string; model: string; voice: string;
  /** Optional speech-to-text service (`/audio/transcriptions`, OpenAI-compatible), used to write out a recorded voice message. */
  sttModel?: string;
  /** Its own address and key. Empty means the speech service above, which only an OpenAI-compatible provider can be. */
  sttBaseUrl?: string; sttApiKey?: string };
export const EMPTY_TTS_CONFIG: TtsConfig = { baseUrl: "", apiKey: "", model: "", voice: "" };
/** OpenAI's documented limit for one `/audio/speech` input, kept for every provider. */
export const TTS_TEXT_LIMIT = 4096;
export const DEFAULT_TTS_VOICE = "alloy";

export const providerOf = (config: Pick<TtsConfig, "provider">): TtsProvider => config.provider ?? "openai";

export function speechUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, "/audio/speech");
}

export function transcriptionUrl(baseUrl: string): string {
  return endpointUrl(baseUrl, "/audio/transcriptions");
}

/** The address of the service's speech endpoint, without the voice that ElevenLabs puts in the path. */
export function speechEndpoint(config: Pick<TtsConfig, "provider" | "baseUrl">): string {
  const provider = providerOf(config);
  if (provider === "openai") return speechUrl(config.baseUrl);
  const base = config.baseUrl.trim() || DEFAULT_TTS_BASE_URL[provider];
  return endpointUrl(base, provider === "minimax" ? "/v1/t2a_v2" : "/v1/text-to-speech");
}

export function normalizeTtsConfig(value: unknown): TtsConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: keyof TtsConfig) => typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  const provider = TTS_PROVIDERS.find((item) => item.id === raw.provider)?.id ?? "openai";
  return { ...(provider !== "openai" ? { provider } : {}), baseUrl: text("baseUrl"), apiKey: text("apiKey"), model: text("model"), voice: text("voice"),
    ...(text("sttModel") ? { sttModel: text("sttModel") } : {}),
    ...(text("sttBaseUrl") ? { sttBaseUrl: text("sttBaseUrl") } : {}), ...(text("sttApiKey") ? { sttApiKey: text("sttApiKey") } : {}) };
}

/** Why the config cannot be used yet, or null when it can. */
export function ttsConfigProblem(config: TtsConfig): string | null {
  try { speechEndpoint(config); } catch (error) { return error instanceof Error ? error.message : "Enter a valid API Base URL."; }
  return config.apiKey.trim() && config.model.trim() ? null : "Enter an API Key and a Model for Voice.";
}

/**
 * Character's own voice, else the global binding, else the config's default voice, else (OpenAI-compatible only) the
 * service default. MiniMax and ElevenLabs voices are IDs from the person's own account, so there is nothing to guess.
 */
export function resolveVoice(
  slot: { ttsVoice?: string | null }, config: Pick<TtsConfig, "voice" | "provider">,
): string {
  return slot.ttsVoice?.trim() || config.voice.trim() || (providerOf(config) === "openai" ? DEFAULT_TTS_VOICE : "");
}

/** The speech-to-text service as it will be called, or why it cannot be. It is a service of its own, apart from the voice provider. */
export function sttSettings(config: TtsConfig): { baseUrl: string; apiKey: string; model: string } | { problem: string } {
  const model = config.sttModel?.trim() ?? "";
  if (!model) return { problem: "Add a Speech-to-text model in your Voice settings." };
  // The voice settings are reused only when no STT address or key is set; a partial override never borrows the other half.
  const ownUrl = config.sttBaseUrl?.trim() ?? "", ownKey = config.sttApiKey?.trim() ?? "";
  const shared = providerOf(config) === "openai" && !ownUrl && !ownKey;
  const baseUrl = shared ? config.baseUrl.trim() : ownUrl;
  const apiKey = shared ? config.apiKey.trim() : ownKey;
  if (!baseUrl || !apiKey) return { problem: "Add a Speech-to-text Base URL and API Key in your Voice settings." };
  try { transcriptionUrl(baseUrl); } catch (error) { return { problem: error instanceof Error ? error.message : "Enter a valid Speech-to-text Base URL." }; }
  return { baseUrl, apiKey, model };
}
