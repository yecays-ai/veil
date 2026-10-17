import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { stopTranscriptions, transcriptionStatus, type SpeechSource } from "../lib/chat/transcription-job";
import { TtsError } from "../lib/tts/speech";

const clip = () => new Blob([new Uint8Array(2048)], { type: "audio/webm" });
const config = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "", sttModel: "whisper-1" };

function setup(transcribe: SpeechSource["transcribe"], cfg: Record<string, unknown> | null = config) {
  stopTranscriptions();
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const prompts: { role: string; content: unknown }[][] = [];
  const speech: SpeechSource = { config: async () => cfg as never, transcribe };
  const engine = createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push([...prompt] as never); yield "ok"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, speech);
  return { storage, engine, prompts };
}
const promptText = (prompts: { content: unknown }[][]) => JSON.stringify(prompts.at(-1));

test("a sent voice message is saved at once; its words arrive in the background and the Character replies from them", async () => {
  let release!: (text: string) => void;
  const { storage, engine, prompts } = setup(() => new Promise<string>((resolve) => { release = resolve; }));
  const session = await storage.openSession("a");
  const sent = await engine.sendVoice(session.id, { blob: clip(), durationMs: 3000 });
  assert.equal((await storage.readSession(session.id)).messages[0].attachment?.kind === "audio", true, "saved before any words exist");
  assert.equal(transcriptionStatus(sent.id), "running");
  const reply = engine.requestReply(session.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prompts.length, 0, "no model request while the words are still being written out");
  release("meet me at six");
  await reply;
  assert.equal(prompts.length, 1);
  assert.match(promptText(prompts), /\[用户发送了一条语音消息：meet me at six\]/);
  assert.equal((await storage.readSession(session.id)).messages[0].content, "meet me at six", "the database keeps the transcript");
  assert.equal(transcriptionStatus(sent.id), "idle");
});

test("a failed transcription keeps the voice message, says why, and Retry writes the words", async () => {
  let fail = true;
  const { storage, engine, prompts } = setup(async () => { if (fail) throw new TtsError("nope", "auth"); return "second try"; });
  const session = await storage.openSession("a");
  const sent = await engine.sendVoice(session.id, { blob: clip(), durationMs: 2000 });
  await engine.requestReply(session.id);
  assert.match(transcriptionStatus(sent.id), /^error:.+/);
  const message = (await storage.readSession(session.id)).messages[0];
  assert.equal(message.attachment?.kind === "audio" && message.attachment.untranscribed, true, "the recording is kept");
  assert.match(promptText(prompts), /还没有转成文字/, "the model is told there are no words yet");
  assert.doesNotMatch(promptText(prompts), /nope/);
  fail = false;
  await engine.retryTranscription(session.id, sent.id);
  for (let index = 0; index < 50 && transcriptionStatus(sent.id) === "running"; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await storage.readSession(session.id)).messages[0].content, "second try");
  assert.equal(transcriptionStatus(sent.id), "idle");
});

test("without a speech-to-text service the message is kept and the failure says what to set up", async () => {
  let calls = 0;
  const { storage, engine } = setup(async () => { calls += 1; return "x"; }, { ...config, sttModel: "" });
  const session = await storage.openSession("a");
  const sent = await engine.sendVoice(session.id, { blob: clip(), durationMs: 2000 });
  for (let index = 0; index < 50 && transcriptionStatus(sent.id) === "running"; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 0, "no request is made");
  assert.match(transcriptionStatus(sent.id), /^error:/);
  assert.equal((await storage.readSession(session.id)).messages.length, 1);
});
