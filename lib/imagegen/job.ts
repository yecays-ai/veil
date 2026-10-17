import { compressChatImage, type ChatImage } from "../chat/image-compress";
import type { ChatMessage } from "../chat/types";
import { browserImageGenConfigStorage, imageGenConfigProblem, type ImageGenConfig } from "./config";
import { generateImage, imageGenErrorMessage, ImageGenError, sniffImageType } from "./generate";

/** What a picture job needs from outside: the service settings, the request, and shrinking the result like any picture. */
export type ImageSource = {
  /** The usable settings on this device, or null when no image service is set up. */
  config: () => Promise<ImageGenConfig | null>;
  generate: typeof generateImage;
  process: (picture: Blob) => Promise<ChatImage>;
};
export const browserImageSource: ImageSource = {
  config: () => typeof window === "undefined" ? Promise.resolve(null)
    : browserImageGenConfigStorage.load().then((config) => imageGenConfigProblem(config) === null ? config : null, () => null),
  generate: generateImage,
  process: compressChatImage,
};

/** The Character as a picture needs it: its written look and, when it is stored on this device, its picture. */
export type PictureSubject = { appearance: string | null; avatar: string | null };

// One job per picture message, alive only while this page is: a closed page leaves the placeholder asking again.
const running = new Map<string, AbortController>();
const failures = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const subscribeImageJobs = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** "running", "error:<what to tell the person>", or "idle" (never started on this page, or stopped). */
export function imageJobStatus(messageId: string): string {
  if (running.has(messageId)) return "running";
  const failure = failures.get(messageId);
  return failure ? `error:${failure}` : "idle";
}
/** Stops every running job and forgets failures: the page is going away or the data is being replaced. */
export function stopImageJobs() { for (const controller of running.values()) controller.abort(); running.clear(); failures.clear(); notify(); }
/** Keeps what went wrong before a job could start (reading the message, saving the new words) where the placeholder shows it. */
export function recordImageFailure(messageId: string, error: unknown) {
  failures.set(messageId, error instanceof Error && !(error instanceof ImageGenError) ? error.message : imageGenErrorMessage(error));
  notify();
}
export function stopImageJob(messageId: string) { running.get(messageId)?.abort(); }

/** A reference picture only from a stored picture (a data URL): nothing is fetched from the network for it. */
export function referencePicture(avatar: string | null): Blob | undefined {
  const match = avatar?.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return undefined;
  try {
    const binary = atob(match[2]), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return sniffImageType(bytes) ? new Blob([bytes], { type: match[1].toLowerCase() }) : undefined;
  } catch { return undefined; }
}

/** What is asked of the service: the Character's look is added only when it is in the picture. */
export function pictureRequest(imageGen: NonNullable<ChatMessage["imageGen"]>, subject: PictureSubject) {
  if (!imageGen.character) return { prompt: imageGen.prompt };
  const look = subject.appearance?.trim();
  return { prompt: look ? `${look}\n\n${imageGen.prompt}` : imageGen.prompt, reference: referencePicture(subject.avatar) };
}

/**
 * Makes the picture of one placeholder message: one request, then the result is stored in place of the placeholder.
 * A job already running for the message is not started twice. Never throws: a failure is kept for the placeholder to show.
 */
export function startImageJob(
  message: Pick<ChatMessage, "id" | "imageGen">, subject: PictureSubject, source: ImageSource,
  store: (messageId: string, picture: ChatImage, prompt: string) => Promise<boolean>,
): Promise<void> {
  const imageGen = message.imageGen;
  if (!imageGen || running.has(message.id)) return Promise.resolve();
  const controller = new AbortController();
  running.set(message.id, controller);
  failures.delete(message.id);
  notify();
  return (async () => {
    try {
      const config = await source.config();
      if (!config) throw new ImageGenError("Set up Images in Settings first.", "config");
      const picture = await source.generate(config, pictureRequest(imageGen, subject), controller.signal);
      const shrunk = await source.process(picture);
      controller.signal.throwIfAborted();
      await store(message.id, shrunk, imageGen.prompt);
    } catch (error) {
      if (!controller.signal.aborted) failures.set(message.id, error instanceof Error && !(error instanceof ImageGenError) ? error.message : imageGenErrorMessage(error));
    } finally {
      running.delete(message.id);
      notify();
    }
  })();
}
