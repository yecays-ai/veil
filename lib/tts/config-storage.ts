import { DeviceConfigStorage } from "../device-config-storage";
import { EMPTY_TTS_CONFIG, normalizeTtsConfig, type TtsConfig } from "./config";

export const TTS_DATABASE_NAME = "veil-tts-config-v1";

export class TtsConfigStorage extends DeviceConfigStorage<TtsConfig> {
  constructor(factory?: () => IDBFactory) { super(TTS_DATABASE_NAME, "Voice settings", normalizeTtsConfig, EMPTY_TTS_CONFIG, factory); }
}
export const browserTtsConfigStorage = new TtsConfigStorage();
