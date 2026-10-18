import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { selfState } from "../lib/chat/self-context";
import { IMAGE_PROMPT_MAX, splitActions } from "../lib/presence/actions";
import { listPreview, hasGeneratedContent } from "../lib/chat/message-kind";
import { validateBackupPackage } from "../lib/backup/validation";
import { BackupValidationError } from "../lib/backup/format";
import { createChatEngine } from "./chat-engine-fixture";
import { backupData, packageFixture } from "./backup-fixture";
import { ImageGenConfigStorage, imageGenConfigProblem, normalizeImageGenConfig } from "../lib/imagegen/config";
import { generateImage, IMAGEGEN_MAX_BYTES, imageGenErrorMessage, ImageGenError, sniffImageType } from "../lib/imagegen/generate";
import { imageJobStatus, pictureRequest, referencePicture, startImageJob, stopImageJobs, type ImageSource } from "../lib/imagegen/job";
import type { TextProvider } from "../lib/chat/provider";
import type { ChatMessage } from "../lib/chat/types";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const NOW = 1_700_000_000_000;
const tag = (json: string) => `<veil-action>${json}</veil-action>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const png = () => new Blob([PNG], { type: "image/png" });
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const config = normalizeImageGenConfig({ baseUrl: "https://img.test/v1", apiKey: "sk-img", model: "gpt-image-1", size: "1024x1024" });
const never = new AbortController().signal;

test("the settings are validated, normalised and kept on the device only", async () => {
  assert.equal(imageGenConfigProblem(config), null);
  assert.match(imageGenConfigProblem({ ...config, apiKey: "" }) ?? "", /API Key/);
  assert.equal(normalizeImageGenConfig({ ...config, size: "huge" }).size, undefined);
  const storage = new ImageGenConfigStorage(() => new IDBFactory());
  assert.deepEqual(await storage.load(), { baseUrl: "", apiKey: "", model: "" });
  await storage.save(config);
  assert.deepEqual(await storage.load(), config);
  await storage.clear();
  assert.equal((await storage.load()).apiKey, "");
});

test("a picture is asked for with one JSON request and read from base64 by its first bytes", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ data: [{ b64_json: b64(PNG) }] })); }) as typeof fetch;
  const picture = await generateImage(config, { prompt: " a bowl of noodles " }, never, { fetchImpl });
  assert.equal(picture.type, "image/png");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://img.test/v1/images/generations");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { model: "gpt-image-1", prompt: "a bowl of noodles", n: 1, response_format: "b64_json", size: "1024x1024" });
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, "Bearer sk-img");
  assert.equal(seen[0].init.credentials, "omit");
});

test("with a reference picture the request goes to /images/edits as a multipart form", async () => {
  const seen: { url: string; body: FormData }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, body: init.body as FormData }); return new Response(JSON.stringify({ data: [{ b64_json: b64(PNG) }] })); }) as typeof fetch;
  await generateImage(config, { prompt: "selfie", reference: png() }, never, { fetchImpl });
  assert.equal(seen[0].url, "https://img.test/v1/images/edits");
  assert.equal(seen[0].body.get("prompt"), "selfie");
  assert.equal(seen[0].body.get("model"), "gpt-image-1");
  assert.equal(seen[0].body.get("response_format"), "b64_json");
  assert.ok(seen[0].body.get("image") instanceof Blob);
});

test("a url result is fetched once without credentials; anything that is not a picture is refused", async () => {
  const calls: string[] = [];
  const viaUrl = (async (url: string) => {
    calls.push(url);
    return url.endsWith("/images/generations") ? new Response(JSON.stringify({ data: [{ url: "https://cdn.test/a.png" }] })) : new Response(PNG);
  }) as typeof fetch;
  assert.equal((await generateImage(config, { prompt: "x" }, never, { fetchImpl: viaUrl })).type, "image/png");
  assert.equal(calls.length, 2);
  const html = (async () => new Response(JSON.stringify({ data: [{ b64_json: b64(new TextEncoder().encode("<html>nope</html>")) }] }))) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: html }), (e) => e instanceof ImageGenError && e.category === "invalid-image");
  const none = (async () => new Response(JSON.stringify({ data: [] }))) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: none }), (e) => e instanceof ImageGenError && e.category === "invalid-response" && e.stage === "response");
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0])), "image/jpeg");
});

test("errors are classified without the response body or key, and a stop is not an error", async () => {
  const status = (code: number) => (async () => new Response("echo sk-img", { status: code })) as typeof fetch;
  for (const [code, category] of [[401, "auth"], [429, "rate-limit"], [500, "http"]] as const)
    await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: status(code) }),
      (e) => e instanceof ImageGenError && e.category === category && !e.message.includes("sk-img"));
  await assert.rejects(generateImage({ ...config, apiKey: "" }, { prompt: "x" }, never, { fetchImpl: status(200) }), (e) => e instanceof ImageGenError && e.category === "config");
  const stop = new AbortController(); stop.abort(new Error("stopped"));
  const hang = ((_u: string, init: RequestInit) => new Promise((_r, reject) => { if (init.signal?.aborted) reject(new Error("x")); })) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, stop.signal, { fetchImpl: hang }), /stopped/);
  const slow = ((_u: string, init: RequestInit) => new Promise((_r, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("x"))); })) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: slow, timeoutMs: 5 }), (e) => e instanceof ImageGenError && e.category === "timeout");
});

test("generation network, response parsing and URL download failures report distinct safe stages", async () => {
  const generationNetwork = (async () => { throw new TypeError("Failed to fetch https://secret.test/?token=hidden"); }) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: generationNetwork }), (error) => {
    assert.ok(error instanceof ImageGenError);
    assert.deepEqual([error.category, error.stage], ["network", "generation"]);
    const visible = imageGenErrorMessage(error);
    assert.match(visible, /generation service/);
    assert.doesNotMatch(visible, /sk-img|secret|token/i);
    return true;
  });
  const malformed = (async () => new Response("not json")) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: malformed }), (error) => {
    assert.ok(error instanceof ImageGenError);
    assert.deepEqual([error.category, error.stage], ["invalid-response", "response"]);
    return true;
  });
  const downloadNetwork = (async (url: string) => url.endsWith("/images/generations")
    ? new Response(JSON.stringify({ data: [{ url: "https://signed.test/a.png?token=hidden" }] }))
    : Promise.reject(new TypeError("blocked https://signed.test/a.png?token=hidden"))) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: downloadNetwork }), (error) => {
    assert.ok(error instanceof ImageGenError);
    assert.deepEqual([error.category, error.stage], ["network", "download"]);
    assert.equal(typeof error.retryDownload, "function");
    const visible = imageGenErrorMessage(error);
    assert.match(visible, /picture was generated/);
    assert.doesNotMatch(visible, /signed|token|hidden|sk-img/i);
    return true;
  });
});

test("the image action keeps a short prompt and defaults to a picture without the Character in it", () => {
  assert.deepEqual(splitActions(`ok\n${tag('{"image":{"prompt":" my desk ","character":false}}')}`).actions?.image, { prompt: "my desk", character: false });
  assert.deepEqual(splitActions(tag('{"image":{"prompt":"selfie","character":true}}')).actions?.image, { prompt: "selfie", character: true });
  assert.equal(splitActions(tag('{"image":{"prompt":"selfie"}}')).actions?.image?.character, false, "not showing the Character is the default");
  assert.equal(splitActions(tag('{"image":{"prompt":"  "}}')).actions?.image, undefined);
  assert.equal(splitActions(tag(JSON.stringify({ image: { prompt: "a".repeat(IMAGE_PROMPT_MAX + 1) } }))).actions?.image, undefined);
  assert.equal(splitActions(tag('{"image":"a picture"}')).actions?.image, undefined);
});

const avatar = `data:image/png;base64,${b64(PNG)}`;
test("the Character's look and avatar are used only for a picture that shows the Character", () => {
  const subject = { appearance: "short black hair, round glasses", avatar };
  assert.deepEqual(pictureRequest({ prompt: "my noodles", character: false }, subject), { prompt: "my noodles" });
  const selfie = pictureRequest({ prompt: "selfie at the window", character: true }, subject);
  assert.equal(selfie.prompt, "short black hair, round glasses\n\nselfie at the window");
  assert.equal(selfie.reference?.type, "image/png");
  assert.equal(referencePicture("https://example.test/a.png"), undefined, "nothing is fetched for a reference");
  assert.equal(referencePicture(`data:image/png;base64,${b64(new TextEncoder().encode("not a png"))}`), undefined);
  assert.equal(pictureRequest({ prompt: "selfie", character: true }, { appearance: null, avatar: null }).prompt, "selfie");
});

function setupStorage() { return new ChatStorage(() => new IDBFactory()); }
async function placeholder(storage: ChatStorage) {
  const session = await storage.openSession("a");
  const draft = await storage.send(session.id, "hi");
  const batch = await storage.beginReply(session.id);
  const done = await storage.finalizeReply(batch!.assistant.id, "Look!", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { prompt: "my noodles", character: false });
  return { session, draft, done };
}

test("a reply with a picture saves the text and a placeholder that holds what was asked for", async () => {
  const storage = setupStorage();
  const { done } = await placeholder(storage);
  assert.equal(done.length, 2);
  assert.equal(done[1].imageGen?.prompt, "my noodles");
  assert.equal(done[1].content, "[你发送了一张照片:my noodles]");
  assert.equal(listPreview(done[1]), "[图片]");
  assert.equal(hasGeneratedContent(done[1]), true);
});

test("the finished picture replaces the placeholder in one write; a deleted or settled message stores nothing", async () => {
  const storage = setupStorage();
  const { session, done } = await placeholder(storage);
  const id = done[1].id;
  assert.equal(await storage.completeGeneratedImage(id, png(), 30, 20), true);
  const stored = (await storage.readSession(session.id)).messages.find((m) => m.id === id)!;
  assert.equal(stored.imageGen, undefined);
  assert.deepEqual(stored.attachment && [stored.attachment.kind, (stored.attachment as { width: number }).width], ["image", 30]);
  assert.equal((await storage.readMessageAttachment(session.id, id))?.size, PNG.length);
  assert.equal(await storage.completeGeneratedImage(id, png(), 30, 20), false, "a second result is ignored");
  const second = await placeholder(setupStorage());
  const other = second.done[1].id;
  const lone = setupStorage();
  const made = await placeholder(lone);
  await lone.deleteMessages(made.session.id, [made.done[1].id]);
  assert.equal(await lone.completeGeneratedImage(made.done[1].id, png(), 30, 20), false);
  assert.equal(other.length > 0, true);
});

test("asking again can change the words of a picture that is not made yet, and only then", async () => {
  const storage = setupStorage();
  const { session, done } = await placeholder(storage);
  await assert.rejects(storage.setImagePrompt(done[1].id, "  "), /Describe/);
  assert.equal(await storage.setImagePrompt(done[1].id, " ramen with an egg "), true);
  const changed = (await storage.readSession(session.id)).messages.find((m) => m.id === done[1].id)!;
  assert.deepEqual([changed.imageGen?.prompt, changed.content], ["ramen with an egg", "[你发送了一张照片:ramen with an egg]"]);
  await storage.completeGeneratedImage(done[1].id, png(), 3, 3);
  assert.equal(await storage.setImagePrompt(done[1].id, "other"), false);
  await assert.rejects(storage.editMessage(done[1].id, "edited"), /Media messages cannot be edited/);
});

const message = (id: string): Pick<ChatMessage, "id" | "imageGen"> => ({ id, imageGen: { prompt: "p", character: false } });
const shrunk = async (blob: Blob) => ({ blob, width: 4, height: 3 });
function source(over: Partial<ImageSource> = {}): ImageSource {
  return { config: async () => config, generate: async () => png(), process: shrunk, ...over };
}

test("a job makes one request, stores the result, and is not started twice for the same picture", async () => {
  stopImageJobs();
  let requests = 0, stored = 0;
  const gate = Promise.withResolvers<void>();
  const slow = source({ generate: async () => { requests += 1; await gate.promise; return png(); } });
  const store = async () => { stored += 1; return true; };
  const first = startImageJob(message("m1"), { appearance: null, avatar: null }, slow, store);
  const again = startImageJob(message("m1"), { appearance: null, avatar: null }, slow, store);
  await flush();
  assert.equal(imageJobStatus("m1"), "running");
  gate.resolve();
  await Promise.all([first, again]);
  assert.deepEqual([requests, stored, imageJobStatus("m1")], [1, 1, "idle"]);
});

test("a failed job stores nothing and tells why; a stop leaves no failure; no settings means no request", async () => {
  stopImageJobs();
  let stored = 0;
  const store = async () => { stored += 1; return true; };
  const subject = { appearance: null, avatar: null };
  await startImageJob(message("m2"), subject, source({ generate: async () => { throw new ImageGenError("rate", "rate-limit"); } }), store);
  assert.match(imageJobStatus("m2"), /^error:The image service is busy/);
  await startImageJob(message("m3"), subject, source({ config: async () => null }), store);
  assert.match(imageJobStatus("m3"), /^error:Set up Images/);
  const running = startImageJob(message("m4"), subject, source({ generate: (_c, _i, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(signal.reason))) }), store);
  await flush();
  stopImageJobs();
  await running;
  assert.deepEqual([stored, imageJobStatus("m4")], [0, "idle"]);
  await startImageJob(message("m2"), subject, source(), store);
  assert.equal(imageJobStatus("m2"), "idle", "asking again clears the old failure");
  assert.equal(stored, 1);
});

test("retry after a generated URL download failure downloads the same picture without another paid generation", async () => {
  stopImageJobs();
  let generations = 0, downloads = 0, stored = 0;
  const fetchImpl = (async (url: string) => {
    if (url.endsWith("/images/generations")) {
      generations += 1;
      return new Response(JSON.stringify({ data: [{ url: "https://signed.test/result.png?token=private" }] }));
    }
    downloads += 1;
    if (downloads === 1) throw new TypeError("Safari blocked the download");
    return new Response(PNG);
  }) as typeof fetch;
  const actual = source({ generate: (c, input, signal) => generateImage(c, input, signal, { fetchImpl }) });
  const request = message("same-picture");
  const store = async () => { stored += 1; return true; };
  await startImageJob(request, { appearance: null, avatar: null }, actual, store);
  assert.match(imageJobStatus("same-picture"), /picture was generated.*could not download/i);
  await startImageJob(request, { appearance: null, avatar: null }, actual, store);
  assert.deepEqual({ generations, downloads, stored, status: imageJobStatus("same-picture") }, { generations: 1, downloads: 2, stored: 1, status: "idle" });
});

async function engineApp(configured: boolean, requests: { prompt: string; reference: boolean }[]) {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("simulated-character");
  const foundation = defaultFoundation(); foundation.runtime.timeAware = false;
  foundation.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated", appearance: "tall, green coat" }) }];
  foundation.characters[0].avatar = avatar;
  const prompts: string[] = [];
  let reply = "";
  const provider: TextProvider = async function* (_config, messages) { prompts.push(messages.map((m) => m.content).join("\n")); yield reply; };
  const images: ImageSource = {
    config: async () => configured ? config : null,
    generate: async (_c, input) => { requests.push({ prompt: input.prompt, reference: !!input.reference }); return png(); },
    process: shrunk,
  };
  const engine = createChatEngine(storage, async () => foundation, provider, undefined, () => new Date(NOW),
    undefined, undefined, undefined, undefined, undefined, async () => {},
    async (character, now, state) => selfState(character, undefined, undefined, now, state.lastReplyAt, state.announceChange, state.allowActions, state.reactions),
    async () => {}, undefined, undefined, undefined, async () => false, images);
  const ask = async (text: string, answer: string) => {
    reply = answer;
    await storage.send(session.id, text);
    await engine.requestReply(session.id);
    await flush();
    return (await storage.readSession(session.id)).messages;
  };
  return { storage, session, engine, prompts, ask };
}

test("the Character is told about pictures only when an image service is set up, and both kinds are described", async () => {
  stopImageJobs();
  const on = await engineApp(true, []), off = await engineApp(false, []);
  await on.ask("hi", "Hello."); await off.ask("hi", "Hello.");
  assert.match(on.prompts[0], /send one picture/);
  assert.match(on.prompts[0], /"image": \{"prompt"/);
  assert.match(on.prompts[0], /do not default to showing yourself/);
  assert.doesNotMatch(off.prompts[0], /send one picture|"image"/);
});

test("a picture of the surroundings uses no Character look or reference; a selfie uses both; the result lands in the same message", async () => {
  stopImageJobs();
  const requests: { prompt: string; reference: boolean }[] = [];
  const app = await engineApp(true, requests);
  let messages = await app.ask("what are you eating?", `Noodles!\n${tag('{"image":{"prompt":"a bowl of noodles on a desk","character":false}}')}`);
  assert.deepEqual(requests, [{ prompt: "a bowl of noodles on a desk", reference: false }]);
  const photo = messages.findLast((m) => m.role === "assistant")!;
  assert.equal(photo.attachment?.kind, "image", "the placeholder became the picture");
  assert.equal(photo.imageGen, undefined);
  await app.ask("nice", "Thanks.");
  messages = await app.ask("show me you", `Sure.\n${tag('{"image":{"prompt":"selfie by the window","character":true}}')}`);
  assert.deepEqual(requests[1], { prompt: "tall, green coat\n\nselfie by the window", reference: true });
  assert.equal(messages.filter((m) => m.attachment?.kind === "image").length, 2);
});

test("an image action is ignored without settings, and never twice in a row", async () => {
  stopImageJobs();
  const requests: { prompt: string; reference: boolean }[] = [];
  const off = await engineApp(false, requests);
  const messages = await off.ask("hi", `Hi.\n${tag('{"image":{"prompt":"a cat","character":false}}')}`);
  assert.equal(messages.some((m) => m.imageGen || m.attachment), false);
  assert.equal(requests.length, 0);
  const on = await engineApp(true, requests);
  await on.ask("one", `A.\n${tag('{"image":{"prompt":"first","character":false}}')}`);
  const again = await on.ask("two", `B.\n${tag('{"image":{"prompt":"second","character":false}}')}`);
  assert.equal(requests.length, 1);
  assert.equal(again.filter((m) => m.attachment || m.imageGen).length, 1);
});

test("a failed picture can be asked again with new words through the engine", async () => {
  stopImageJobs();
  const requests: { prompt: string; reference: boolean }[] = [];
  const app = await engineApp(true, requests);
  // The first attempt fails: swap in a failing service for the first request only.
  let fail = true;
  const original = requests.push.bind(requests);
  requests.push = (...items) => { if (fail) { fail = false; throw new ImageGenError("down", "http", 500); } return original(...items); };
  const messages = await app.ask("hi", `Look.\n${tag('{"image":{"prompt":"a lake","character":false}}')}`);
  const waiting = messages.find((m) => m.imageGen)!;
  assert.ok(waiting, "still a placeholder after the failure");
  assert.match(imageJobStatus(waiting.id), /^error:/);
  await app.engine.retryImage(app.session.id, waiting.id, "a lake at dusk");
  await flush();
  const done = (await app.storage.readSession(app.session.id)).messages.find((m) => m.id === waiting.id)!;
  assert.equal(done.attachment?.kind, "image");
  assert.equal(requests.at(-1)?.prompt, "a lake at dusk");
});

test("a backup keeps a waiting picture request and refuses a malformed one", async () => {
  const check = async (request: unknown) => {
    const data = backupData();
    (data.chat.messages.find((m) => m.role === "assistant") as unknown as Record<string, unknown>).imageGen = request;
    const fixture = await packageFixture(data);
    return validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files);
  };
  const ok = await check({ prompt: "a lake", character: false });
  assert.equal(ok.data.chat.messages.find((m) => m.imageGen)?.imageGen?.prompt, "a lake");
  for (const bad of [{ prompt: "", character: false }, { prompt: "x", character: "yes" }, { prompt: "x", character: false, extra: 1 }, { prompt: "a".repeat(401), character: true }, "a lake"])
    await assert.rejects(check(bad), (error) => error instanceof BackupValidationError && error.detail === "image-request-invalid");
});

test("a response or a downloaded picture larger than the limit is dropped while it is read", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const endless = () => { let sent = 0, cancelled = false; return { cancelled: () => cancelled, response: new Response(new ReadableStream<Uint8Array>({
    pull(controller) { sent += 1; controller.enqueue(chunk); if (sent > 80) controller.close(); }, cancel() { cancelled = true; } })) }; };
  const big = endless();
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: (async () => big.response) as typeof fetch }),
    (e) => e instanceof ImageGenError && e.category === "invalid-response" && e.stage === "response");
  assert.equal(big.cancelled(), true, "the rest is not downloaded");
  const picture = endless();
  const viaUrl = (async (url: string) => url.endsWith("/images/generations")
    ? new Response(JSON.stringify({ data: [{ url: "https://cdn.test/a.png" }] })) : picture.response) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: viaUrl }), (e) => e instanceof ImageGenError && e.category === "invalid-image");
  assert.equal(picture.cancelled(), true);
  const declared = (async () => new Response("{}", { headers: { "content-length": String(IMAGEGEN_MAX_BYTES * 3) } })) as typeof fetch;
  await assert.rejects(generateImage(config, { prompt: "x" }, never, { fetchImpl: declared }), (e) => e instanceof ImageGenError && e.category === "invalid-response" && e.stage === "response");
});

test("asking again with words that cannot be saved shows the reason on the placeholder", async () => {
  stopImageJobs();
  const app = await engineApp(true, []);
  const fresh = await placeholder(app.storage);
  await app.engine.retryImage(fresh.session.id, fresh.done[1].id, "x".repeat(IMAGE_PROMPT_MAX + 5));
  assert.match(imageJobStatus(fresh.done[1].id), /^error:Describe the picture/);
});

test("new words for a picture also discard a summary that covered the old ones", async () => {
  const storage = setupStorage();
  const { session, done } = await placeholder(storage);
  const raw = storage as unknown as { transaction: (mode: string, work: (tx: IDBTransaction) => Promise<unknown>) => Promise<unknown> };
  await raw.transaction("readwrite", async (tx) => {
    const row = await new Promise<Record<string, unknown>>((resolve) => { const r = tx.objectStore("sessions").get(session.id); r.onsuccess = () => resolve(r.result); });
    tx.objectStore("sessions").put({ ...row, summary: { text: "old", throughOrder: 99, digest: "d", updatedAt: 1 } });
  });
  assert.equal((await storage.readSession(session.id)).session.summary?.text, "old");
  assert.equal(await storage.setImagePrompt(done[1].id, "new words"), true);
  assert.equal((await storage.readSession(session.id)).session.summary, undefined);
});

test("a picture made from the old words is not stored once the words were changed", async () => {
  const storage = setupStorage();
  const { done } = await placeholder(storage);
  await storage.setImagePrompt(done[1].id, "new words");
  assert.equal(await storage.completeGeneratedImage(done[1].id, png(), 3, 3, "my noodles"), false);
  assert.equal((await storage.readSession(done[1].sessionId)).messages.find((m) => m.id === done[1].id)?.attachment, undefined);
  assert.equal(await storage.completeGeneratedImage(done[1].id, png(), 3, 3, "new words"), true);
});

