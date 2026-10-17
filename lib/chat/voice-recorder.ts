import { MAX_VOICE_RECORDING_MS } from "./attachment";

export type Recording = { blob: Blob; durationMs: number };
export type VoiceRecorder = { stop(): Promise<Recording>; cancel(): void };
type RecorderDeps = {
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  Recorder?: typeof MediaRecorder;
  now?: () => number;
};

/** Preferred containers in order: webm/ogg on most browsers, mp4 on Safari. */
const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
export const recorderMimeType = (Recorder: Pick<typeof MediaRecorder, "isTypeSupported">) =>
  CANDIDATES.find((type) => Recorder.isTypeSupported(type));

export class VoiceRecordError extends Error {}

/**
 * Starts recording the microphone. `stop` resolves to the recording and its real length (measured from start to stop,
 * never above the limit); `cancel` discards it. Either one releases the microphone. The caller decides when the limit
 * is reached by calling `stop` after `MAX_VOICE_RECORDING_MS`.
 */
export async function startVoiceRecording(deps: RecorderDeps = {}): Promise<VoiceRecorder> {
  const devices = deps.mediaDevices ?? (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  const Recorder = deps.Recorder ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  const now = deps.now ?? (() => performance.now());
  if (!devices?.getUserMedia || !Recorder) throw new VoiceRecordError("This browser cannot record audio.");
  const mimeType = recorderMimeType(Recorder);
  if (!mimeType) throw new VoiceRecordError("This browser cannot record in a supported audio format.");
  let stream: MediaStream;
  try { stream = await devices.getUserMedia({ audio: true }); }
  catch (error) {
    throw new VoiceRecordError(error instanceof DOMException && error.name === "NotAllowedError"
      ? "Microphone access was denied. Allow it in your browser settings." : "Could not open the microphone.");
  }
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let recorder: MediaRecorder;
  try { recorder = new Recorder(stream, { mimeType }); }
  catch { release(); throw new VoiceRecordError("This browser cannot record audio."); }
  const chunks: Blob[] = [];
  let discarded = false;
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const startedAt = now();
  recorder.start();
  return {
    stop: () => new Promise<Recording>((resolve, reject) => {
      const durationMs = Math.min(MAX_VOICE_RECORDING_MS, Math.max(1, Math.round(now() - startedAt)));
      recorder.onerror = () => { release(); reject(new VoiceRecordError("The recording failed.")); };
      recorder.onstop = () => {
        release();
        const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
        if (discarded || !blob.size) reject(new VoiceRecordError("Nothing was recorded."));
        else resolve({ blob, durationMs });
      };
      if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
      else recorder.stop();
    }),
    cancel: () => {
      discarded = true;
      recorder.ondataavailable = null; recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
