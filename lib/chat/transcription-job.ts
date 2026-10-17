import { browserTtsConfigStorage } from "../tts/config-storage";
import { sttSettings, type TtsConfig } from "../tts/config";
import { sttErrorMessage, transcribeAudio } from "../tts/transcribe";

/** What writing out a recording needs from outside: the Voice settings and the request. */
export type SpeechSource = {
  /** The Voice settings of this device, or null when they cannot be read. */
  config: () => Promise<TtsConfig | null>;
  transcribe: typeof transcribeAudio;
};
export const browserSpeechSource: SpeechSource = {
  config: () => typeof window === "undefined" ? Promise.resolve(null) : browserTtsConfigStorage.load().catch(() => null),
  transcribe: transcribeAudio,
};

// One job per voice message, alive only while this page is: a closed page leaves the message asking to be tried again.
const running = new Map<string, AbortController>();
const failures = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const subscribeTranscriptions = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** "running", "error:<what to tell the person>", or "idle" (never started on this page, or stopped). */
export function transcriptionStatus(messageId: string): string {
  if (running.has(messageId)) return "running";
  const failure = failures.get(messageId);
  return failure ? `error:${failure}` : "idle";
}
/** Stops every running job and forgets failures: the page is going away or the data is being replaced. */
export function stopTranscriptions() { for (const controller of running.values()) controller.abort(); running.clear(); failures.clear(); notify(); }

/**
 * Writes out one voice message: one request, no retry, then the words are stored in place of the stand-in. A job already
 * running for the message is not started twice. Never throws: a failure is kept for the message to show.
 */
export function startTranscription(
  messageId: string, source: SpeechSource, read: () => Promise<Blob | null>, store: (text: string) => Promise<boolean>,
): Promise<void> {
  if (running.has(messageId)) return Promise.resolve();
  const controller = new AbortController();
  running.set(messageId, controller);
  failures.delete(messageId);
  notify();
  return (async () => {
    try {
      const config = await source.config();
      const stt = config ? sttSettings(config) : { problem: "Voice settings could not be read." };
      if ("problem" in stt) throw Object.assign(new Error(stt.problem), { plain: true });
      const recording = await read();
      if (!recording) throw Object.assign(new Error("This recording is no longer available."), { plain: true });
      const text = await source.transcribe(config!, recording, controller.signal);
      controller.signal.throwIfAborted();
      await store(text);
    } catch (error) {
      if (!controller.signal.aborted)
        failures.set(messageId, error instanceof Error && (error as { plain?: boolean }).plain ? error.message : sttErrorMessage(error));
    } finally {
      running.delete(messageId);
      notify();
    }
  })();
}
