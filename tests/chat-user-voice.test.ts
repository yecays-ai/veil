import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { isMessageAttachment, MAX_VOICE_RECORDING_MS, modelFacingContent, UNTRANSCRIBED_VOICE_CONTENT } from "../lib/chat/attachment";
import { hasGeneratedContent, isFixedMessage, listPreview } from "../lib/chat/message-kind";
import { startVoiceRecording, VoiceRecordError } from "../lib/chat/voice-recorder";
import { transcribeAudio } from "../lib/tts/transcribe";
import { TtsError } from "../lib/tts/speech";
import { normalizeTtsConfig } from "../lib/tts/config";

const clip = (type = "audio/webm;codecs=opus", size = 2048) => new Blob([new Uint8Array(size)], { type });

test("an audio attachment is exactly five valid fields; images keep their six", () => {
  const ok = { kind: "audio", assetId: "a-1", mime: "audio/mp4", durationMs: 4200, bytes: 100 };
  assert.equal(isMessageAttachment(ok), true);
  assert.equal(isMessageAttachment({ ...ok, width: 1 }), false);
  assert.equal(isMessageAttachment({ ...ok, mime: "audio/mpeg" }), false);
  assert.equal(isMessageAttachment({ ...ok, durationMs: 0 }), false);
  assert.equal(isMessageAttachment({ ...ok, durationMs: MAX_VOICE_RECORDING_MS + 1 }), false);
  assert.equal(isMessageAttachment({ ...ok, bytes: 11 * 1024 * 1024 }), false);
});

test("a recorded voice message is saved at once with a stand-in, and the words are written in place later", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  const sent = await storage.sendVoice(session.id, clip(), 4321.6);
  assert.equal(sent.role, "user");
  assert.equal(sent.content, UNTRANSCRIBED_VOICE_CONTENT);
  assert.deepEqual(sent.attachment && { ...sent.attachment, assetId: "x" }, { kind: "audio", assetId: "x", mime: "audio/webm", durationMs: 4322, bytes: 2048, untranscribed: true });
  assert.equal((await storage.readMessageAttachment(session.id, sent.id))?.size, 2048);
  assert.equal(await storage.completeVoiceTranscript(sent.id, "  see you at six  "), true);
  const done = (await storage.readSession(session.id)).messages[0];
  assert.equal(done.content, "see you at six");
  assert.deepEqual(done.attachment && { ...done.attachment, assetId: "x" }, { kind: "audio", assetId: "x", mime: "audio/webm", durationMs: 4322, bytes: 2048 });
  assert.equal(listPreview(done), "[语音] see you at six");
  assert.equal(hasGeneratedContent(done), false, "the words are real text");
  assert.equal(isFixedMessage(done), true, "but the message is not edited");
  assert.equal(await storage.completeVoiceTranscript(sent.id, "again"), false, "words are written once");
  await assert.rejects(storage.editMessage(sent.id, "other"), /Media messages cannot be edited/);
  await storage.deleteMessages(session.id, [sent.id]);
  assert.equal(await storage.readMessageAttachment(session.id, sent.id), null, "deleting the message deletes its recording");
  assert.equal(await storage.completeVoiceTranscript(sent.id, "late"), false, "a deleted message gets no words");
});

test("a recording in an unknown format, too big or with no real length is refused and leaves nothing", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await assert.rejects(storage.sendVoice(session.id, clip("audio/mpeg"), 1000), /format/);
  await assert.rejects(storage.sendVoice(session.id, clip("audio/webm", 11 * 1024 * 1024), 1000), /10 MiB/);
  await assert.rejects(storage.sendVoice(session.id, clip(), 0), /length/);
  await assert.rejects(storage.sendVoice(session.id, clip(), MAX_VOICE_RECORDING_MS + 1), /length/);
  assert.equal((await storage.readSession(session.id)).messages.length, 0);
});

test("the model is told a user message is a voice message, in the current turn and in history", () => {
  const voice = { role: "user", attachment: { kind: "audio" } } as const;
  assert.equal(modelFacingContent(voice, "see you at six"), "[用户发送了一条语音消息：see you at six]");
  assert.equal(modelFacingContent({ role: "user", attachment: { kind: "audio", untranscribed: true } }, UNTRANSCRIBED_VOICE_CONTENT).includes("还没有转成文字"), true);
  assert.equal(modelFacingContent({ role: "user" }, "typed"), "typed");
  assert.equal(modelFacingContent({ role: "assistant", attachment: { kind: "audio" } }, "spoken by the character"), "spoken by the character");
  assert.equal(modelFacingContent({ role: "assistant", voice: true }, "早安"), "[你发送了一条语音消息：早安]", "the Character's own voice is marked the same way");
  assert.equal(modelFacingContent({ role: "assistant" }, "typed"), "typed");
  assert.equal(modelFacingContent({ role: "user", voice: true }, "typed"), "typed", "only the Character's voice flag counts");
  assert.equal(modelFacingContent({ role: "user", attachment: { kind: "image" } }, "a photo"), "a photo");
});

test("the Photos list never includes a voice recording", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.sendVoice(session.id, clip(), 1000);
  const listed = await storage.listSessionImages("a", 10);
  assert.deepEqual(listed?.images, []);
});

class FakeRecorder {
  static types = new Set(["audio/webm"]);
  static isTypeSupported = (type: string) => FakeRecorder.types.has(type);
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly stream: unknown, readonly options: { mimeType: string }) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: clip(this.options.mimeType, 500) }); this.onstop?.(new Event("stop")); }
}

function microphone() {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] } as unknown as MediaStream;
  return { devices: { getUserMedia: async () => stream }, stopped: () => stopped };
}

test("recording reports its real length, picks a supported container and releases the microphone", async () => {
  const mic = microphone();
  let clock = 1000;
  const recorder = await startVoiceRecording({ mediaDevices: mic.devices, Recorder: FakeRecorder as never, now: () => clock });
  clock = 4500;
  const made = await recorder.stop();
  assert.equal(made.durationMs, 3500);
  assert.equal(made.blob.type, "audio/webm");
  assert.equal(mic.stopped(), 1);
  const cancelled = await startVoiceRecording({ mediaDevices: mic.devices, Recorder: FakeRecorder as never, now: () => clock });
  cancelled.cancel();
  assert.equal(mic.stopped(), 2);
});

test("a length above the limit is capped and unsupported or denied microphones give a clear error", async () => {
  const mic = microphone();
  let clock = 0;
  const recorder = await startVoiceRecording({ mediaDevices: mic.devices, Recorder: FakeRecorder as never, now: () => clock });
  clock = MAX_VOICE_RECORDING_MS * 3;
  assert.equal((await recorder.stop()).durationMs, MAX_VOICE_RECORDING_MS);
  await assert.rejects(startVoiceRecording({ mediaDevices: undefined, Recorder: undefined }), VoiceRecordError);
  FakeRecorder.types = new Set();
  await assert.rejects(startVoiceRecording({ mediaDevices: mic.devices, Recorder: FakeRecorder as never }), /supported audio format/);
  FakeRecorder.types = new Set(["audio/webm"]);
  const denied = { getUserMedia: async () => { throw new DOMException("no", "NotAllowedError"); } };
  await assert.rejects(startVoiceRecording({ mediaDevices: denied, Recorder: FakeRecorder as never }), /denied/);
});

const config = normalizeTtsConfig({ baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "tts-1", sttModel: "whisper-1" });

test("transcription makes one multipart request with the model, and returns the words", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ text: " hello there " })); }) as typeof fetch;
  const text = await transcribeAudio(config, clip(), new AbortController().signal, { fetchImpl });
  assert.equal(text, "hello there");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.example.com/v1/audio/transcriptions");
  const form = seen[0].init.body as FormData;
  assert.equal(form.get("model"), "whisper-1");
  assert.ok(form.get("file") instanceof Blob);
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
});

test("transcription fails without a speech-to-text model, on a rejected key, on empty text and on a stop", async () => {
  const never = (async () => { throw new Error("must not be called"); }) as typeof fetch;
  await assert.rejects(transcribeAudio({ ...config, sttModel: "" }, clip(), new AbortController().signal, { fetchImpl: never }), (e) => e instanceof TtsError && e.category === "config");
  const rejected = (async () => new Response("secret sk-test", { status: 401 })) as typeof fetch;
  await assert.rejects(transcribeAudio(config, clip(), new AbortController().signal, { fetchImpl: rejected }), (e) => e instanceof TtsError && e.category === "auth" && !e.message.includes("sk-test"));
  const empty = (async () => new Response(JSON.stringify({ text: "  " }))) as typeof fetch;
  await assert.rejects(transcribeAudio(config, clip(), new AbortController().signal, { fetchImpl: empty }), (e) => e instanceof TtsError && e.category === "invalid-audio");
  const stop = new AbortController(); stop.abort(new Error("stopped"));
  const hang = ((_u: string, init: RequestInit) => new Promise((_r, reject) => { if (init.signal?.aborted) reject(new Error("x")); init.signal?.addEventListener("abort", () => reject(new Error("x"))); })) as typeof fetch;
  await assert.rejects(transcribeAudio(config, clip(), stop.signal, { fetchImpl: hang }), /stopped/);
});

test("the speech-to-text model is optional and saved with the Voice settings only when set", () => {
  assert.deepEqual(normalizeTtsConfig({ baseUrl: "b", apiKey: "k", model: "m" }), { baseUrl: "b", apiKey: "k", model: "m", voice: "" });
  assert.equal(normalizeTtsConfig({ sttModel: " whisper-1 " }).sttModel, "whisper-1");
});
