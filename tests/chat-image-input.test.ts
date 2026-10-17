import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine, TEST_API_CONFIG } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { imageInputLimit, type ApiConfig } from "../lib/api-config";
import { loadPromptImages, newestImageTurns } from "../lib/chat/image-input";
import { createOpenAITextProvider, wireMessages } from "../lib/chat/provider";
import { completionStartSummary, promptSummary } from "../lib/chat/request-diagnostics";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";
import type { PromptTurn } from "../lib/chat/types";

const blobOf = (type: string, size: number) => new Blob([new Uint8Array(size).fill(7)], { type });

test("an API takes pictures only when marked so; the count is 1 to 4 and defaults to the newest one", () => {
  assert.equal(imageInputLimit({}), 0);
  assert.equal(imageInputLimit({ imageInput: false, imageLimit: 3 }), 0);
  assert.equal(imageInputLimit({ imageInput: true }), 1);
  assert.equal(imageInputLimit({ imageInput: true, imageLimit: 4 }), 4);
  assert.equal(imageInputLimit({ imageInput: true, imageLimit: 9 }), 1);
  assert.equal(imageInputLimit({ imageInput: true, imageLimit: 2.5 }), 1);
});

test("only the newest turns that carry a picture keep it; the rest are plain semantic text", () => {
  const turns: PromptTurn[] = [
    { role: "user", content: "a", images: ["1"] }, { role: "assistant", content: "b" },
    { role: "user", content: "c", images: ["2"] }, { role: "user", content: "d", images: ["3"] },
  ];
  assert.deepEqual(newestImageTurns(turns, 2).map((turn) => turn.images), [undefined, undefined, ["2"], ["3"]]);
  assert.deepEqual(newestImageTurns(turns, 1).map((turn) => turn.images), [undefined, undefined, undefined, ["3"]]);
  assert.ok(newestImageTurns(turns, 0).every((turn) => !("images" in turn)));
  assert.deepEqual(turns[0].images, ["1"], "the input is not changed");
});

test("a picture that is gone or not an image is left out and its turn keeps the text; a stop is honoured", async () => {
  const turns: PromptTurn[] = [{ role: "user", content: "x", images: ["ok", "lost", "bad", "boom"] }];
  const read = async (id: string) => id === "ok" ? blobOf("image/png", 3) : id === "bad" ? blobOf("text/html", 3) : id === "boom" ? Promise.reject(new Error("x")) : null;
  const [turn] = await loadPromptImages(turns, read, new AbortController().signal);
  assert.equal(turn.content, "x");
  assert.equal("images" in turn, false);
  assert.deepEqual(turn.imageData, [`data:image/png;base64,${Buffer.from([7, 7, 7]).toString("base64")}`]);
  const [alone] = await loadPromptImages([{ role: "user", content: "y", images: ["lost"] }], read, new AbortController().signal);
  assert.deepEqual(alone, { role: "user", content: "y" });
  const stop = new AbortController(); stop.abort();
  await assert.rejects(loadPromptImages(turns, read, stop.signal));
});

test("the wire form carries only role and content; a picture turn becomes text plus image_url parts", () => {
  const wire = wireMessages([
    { role: "system", content: "s", images: ["leak"] },
    { role: "user", content: "see", imageData: ["data:image/png;base64,AA=="] },
  ]);
  assert.deepEqual(wire, [
    { role: "system", content: "s" },
    { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] },
  ]);
});

test("the provider request body has the image parts and nothing of the engine's own fields", async () => {
  const realFetch = globalThis.fetch; let body = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const provider = createOpenAITextProvider();
    for await (const _ of provider(TEST_API_CONFIG, [{ role: "user", content: "see", images: ["id"], imageData: ["data:image/png;base64,AA=="] }], new AbortController().signal)) void _;
  } finally { globalThis.fetch = realFetch; }
  const sent = JSON.parse(body).messages;
  assert.equal(sent[0].content[1].image_url.url, "data:image/png;base64,AA==");
  assert.equal(body.includes("imageData"), false);
  assert.equal(body.includes('"images"'), false);
});

test("diagnostics count pictures and bytes without carrying the picture", () => {
  const messages: PromptTurn[] = [{ role: "user", content: "see", imageData: ["data:image/png;base64,AAAA"] }];
  const request = { requestId: "r", source: "manual-reply" as const };
  for (const summary of [completionStartSummary(request, "m", messages, true), promptSummary(request, "m", [], messages)]) {
    const record = summary as unknown as Record<string, unknown>;
    assert.equal(record.imageCount, 1);
    assert.equal(record.imageBytes, 3);
    assert.equal(JSON.stringify(summary).includes("AAAA"), false);
  }
  assert.equal("imageCount" in completionStartSummary(request, "m", [{ role: "user", content: "t" }], true), false);
});

function setup(config: ApiConfig) {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }, { characterId: "b", ...normalizeCharacterInput({ name: "B" }) }];
  const prompts: PromptTurn[][] = [];
  const engine = createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push(prompt.map((turn) => ({ ...turn }))); yield "nice"; },
    undefined, undefined, undefined, undefined, undefined, undefined, async () => config, async () => {}, async () => undefined);
  return { storage, engine, prompts };
}
const images = (turns: PromptTurn[]) => turns.filter((turn) => turn.imageData).map((turn) => turn.imageData!.length);

test("the engine sends the newest picture when the API accepts images, and the semantic text stays either way", async () => {
  const { storage, engine, prompts } = setup({ ...TEST_API_CONFIG, imageInput: true });
  const session = await storage.openSession("a");
  await engine.sendImage(session.id, { blob: blobOf("image/png", 20), width: 4, height: 3 });
  await engine.requestReply(session.id);
  await engine.sendImage(session.id, { blob: blobOf("image/webp", 30), width: 4, height: 3 });
  await engine.requestReply(session.id);
  const last = prompts.at(-1)!;
  assert.deepEqual(images(last), [1], "limit 1: only the newest of two pictures");
  assert.match(last.find((turn) => turn.imageData)!.imageData![0], /^data:image\/webp;base64,/);
  assert.equal(last.filter((turn) => turn.content.includes("[用户发送了一张图片]")).length, 2, "the older picture is still described in words");
});

test("a higher limit sends more pictures, still bounded by the setting", async () => {
  const { storage, engine, prompts } = setup({ ...TEST_API_CONFIG, imageInput: true, imageLimit: 2 });
  const session = await storage.openSession("a");
  for (let i = 0; i < 3; i++) await engine.sendImage(session.id, { blob: blobOf("image/png", 10 + i), width: 4, height: 3 });
  await engine.requestReply(session.id);
  assert.equal(images(prompts.at(-1)!).length, 2);
});

test("an API that was not marked as accepting images gets no picture data at all", async () => {
  for (const config of [TEST_API_CONFIG, { ...TEST_API_CONFIG, imageInput: false, imageLimit: 4 }]) {
    const { storage, engine, prompts } = setup(config);
    const session = await storage.openSession("a");
    await engine.sendImage(session.id, { blob: blobOf("image/png", 20), width: 4, height: 3 });
    await engine.requestReply(session.id);
    const last = prompts.at(-1)!;
    assert.equal(last.some((turn) => turn.imageData || turn.images), false);
    assert.ok(last.some((turn) => turn.content.includes("[用户发送了一张图片]")));
  }
});

test("another conversation's picture is never read for this request", async () => {
  const { storage, engine, prompts } = setup({ ...TEST_API_CONFIG, imageInput: true, imageLimit: 4 });
  const other = await storage.openSession("b");
  await engine.sendImage(other.id, { blob: blobOf("image/png", 99), width: 4, height: 3 });
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  await engine.requestReply(session.id);
  assert.equal(images(prompts.at(-1)!).length, 0);
});

test("a recalled picture is not sent", async () => {
  const { storage, engine, prompts } = setup({ ...TEST_API_CONFIG, imageInput: true });
  const session = await storage.openSession("a");
  const image = await engine.sendImage(session.id, { blob: blobOf("image/png", 20), width: 4, height: 3 });
  await storage.send(session.id, "hello");
  await storage.recallMessage(image.id, "user");
  await engine.requestReply(session.id);
  assert.equal(images(prompts.at(-1)!).length, 0);
});

test("backup keeps the image settings of an API, accepts older rows without them and refuses nonsense", async () => {
  const check = async (extra: Record<string, unknown>) => {
    const data = backupData();
    Object.assign(data.apiConfigs[0], extra);
    return validateBackupPackage(...(await (async () => { const f = await packageFixture(data); return [JSON.stringify(f.manifest), f.files] as const; })()));
  };
  assert.deepEqual((await check({})).data.apiConfigs[0].imageInput, undefined);
  const kept = (await check({ imageInput: true, imageLimit: 3 })).data.apiConfigs[0];
  assert.deepEqual([kept.imageInput, kept.imageLimit], [true, 3]);
  await assert.rejects(check({ imageInput: "yes" }));
  await assert.rejects(check({ imageInput: true, imageLimit: 5 }));
  await assert.rejects(check({ apiKey: "secret" }), "a credential is still refused");
});
