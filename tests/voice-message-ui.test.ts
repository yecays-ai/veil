import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { normalizeBindings, setBindingField, type BindingDocument } from "../lib/bindings";
import { browserTtsConfigStorage } from "../lib/tts/config-storage";
import { browserVoiceCache, resetVoiceSweepForTests } from "../lib/tts/voice-cache";
import { chatStorage } from "../lib/chat/storage";
import type { ChatMessage } from "../lib/chat/types";

// The component module is loaded once per process, so its mocked hook reads the current test's bindings.
const hooks = { bindings: (): BindingDocument => normalizeBindings({}, []) };
const message = (extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: "m1", sessionId: "character:a", role: "assistant", content: "早安，今天也要加油。",
  status: "complete", createdAt: 1, order: 1, voice: true, ...extra });

async function mounted(reply: () => Response, bindings = normalizeBindings({}, [])) {
  resetVoiceSweepForTests();
  hooks.bindings = () => bindings;
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>(), played: string[] = [], paused: string[] = [], requests: Record<string, unknown>[] = [];
  class FakeAudio {
    onloadedmetadata: (() => void) | null = null; onended: (() => void) | null = null; duration = 7; currentTime = 0;
    constructor(readonly src: string) { queueMicrotask(() => this.onloadedmetadata?.()); }
    play() { played.push(this.src); return Promise.resolve(); } pause() { paused.push(this.src); }
  }
  const fakeFetch = async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); return reply(); };
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, Audio: FakeAudio, fetch: fakeFetch })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }, revoked: string[] = [];
  let urlCount = 0;
  URL.createObjectURL = () => `blob:clip-${++urlCount}`; URL.revokeObjectURL = (url) => { revoked.push(url); };
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("use-bindings")) return { useBindings: () => ({ bindings: hooks.bindings(), ready: true, error: "", commit: async () => hooks.bindings() }) };
    return originalLoad.call(this, request, ...args);
  };
  const stored = new Map<string, Blob>();
  const original = { load: browserTtsConfigStorage.load, ids: chatStorage.listVoiceMessageIds, get: browserVoiceCache.get, put: browserVoiceCache.put, keys: browserVoiceCache.keys, remove: browserVoiceCache.remove };
  browserTtsConfigStorage.load = async () => ({ baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" });
  chatStorage.listVoiceMessageIds = async (ids) => new Set(ids);
  browserVoiceCache.get = async (id) => stored.get(id) ?? null;
  browserVoiceCache.put = async (id, _fp, blob) => { stored.set(id, blob); };
  browserVoiceCache.keys = async () => [...stored.keys()];
  browserVoiceCache.remove = async () => {};
  const { createRoot } = await import("react-dom/client");
  const { VoiceMessage } = await import("../components/chat/messages/voice-message");
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  const render = (props: Partial<{ message: ChatMessage; text: string; multiSelect: boolean }> = {}) => act(async () => {
    root.render(createElement(VoiceMessage, { message: message(), text: "早安，今天也要加油。", characterId: "a", multiSelect: false, ...props }));
  });
  await render();
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name)!;
  const click = (element: HTMLElement) => act(async () => { element.click(); });
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) { assert.ok(Date.now() < deadline, "did not settle"); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
  };
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    Object.assign(browserTtsConfigStorage, { load: original.load }); chatStorage.listVoiceMessageIds = original.ids;
    Object.assign(browserVoiceCache, { get: original.get, put: original.put, keys: original.keys, remove: original.remove });
    URL.createObjectURL = urls.create; URL.revokeObjectURL = urls.revoke;
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  };
  return { container, button, click, wait, render, cleanup, played, paused, requests, revoked, stored };
}
const mp3 = () => new Response(new Uint8Array(3), { headers: { "content-type": "audio/mpeg" } });

test("Voice bubble: the first tap makes the sound with the default voice and plays it; later taps pause and resume without another request", async () => {
  const app = await mounted(mp3);
  try {
    await app.click(app.button("Play voice message"));
    await app.wait(() => app.played.length === 1);
    assert.deepEqual(app.requests, [{ model: "tts-1", input: "早安，今天也要加油。", voice: "nova", response_format: "mp3" }]);
    assert.equal(app.stored.size, 1, "the clip is kept for later");
    await app.wait(() => !!app.button("Pause voice message"));
    assert.match(app.container.textContent ?? "", /0:07/);
    await app.click(app.button("Pause voice message"));
    assert.equal(app.paused.length, 1);
    await app.click(app.button("Play voice message"));
    assert.equal(app.played.length, 2);
    assert.equal(app.requests.length, 1);
  } finally { await app.cleanup(); }
  assert.deepEqual(app.revoked, ["blob:clip-1"], "leaving the chat releases the sound");
});

test("Voice bubble: the Character's own voice is used, and the words show and hide on request", async () => {
  const bindings = setBindingField(normalizeBindings({}, ["a"]), { characterId: "a" }, "ttsVoice", "onyx");
  const app = await mounted(mp3, bindings);
  try {
    assert.equal(app.container.querySelector(".chat-voice-text"), null);
    await app.click(app.button("Text"));
    assert.equal(app.container.querySelector(".chat-voice-text")?.textContent, "早安，今天也要加油。");
    await app.click(app.button("Hide text"));
    assert.equal(app.container.querySelector(".chat-voice-text"), null);
    await app.click(app.button("Play voice message"));
    await app.wait(() => app.requests.length === 1);
    assert.equal(app.requests[0].voice, "onyx");
  } finally { await app.cleanup(); }
});

test("Voice bubble: a failed request says why, makes no sound, and the next tap tries again", async () => {
  let status = 429;
  const app = await mounted(() => status === 200 ? mp3() : new Response("echo k", { status }));
  try {
    await app.click(app.button("Play voice message"));
    await app.wait(() => /busy or over its limit/.test(app.container.textContent ?? ""));
    assert.equal(app.played.length, 0);
    assert.equal((app.container.textContent ?? "").includes("echo"), false);
    status = 200;
    await app.click(app.button("Play voice message"));
    await app.wait(() => app.played.length === 1);
    assert.equal(app.container.textContent?.includes("busy"), false);
  } finally { await app.cleanup(); }
});

test("Voice bubble: while messages are being selected a tap does not play or open the words", async () => {
  const app = await mounted(mp3);
  try {
    await app.render({ multiSelect: true });
    await app.click(app.button("Play voice message"));
    await app.click(app.button("Text"));
    assert.equal(app.requests.length, 0);
    assert.equal(app.container.querySelector(".chat-voice-text"), null);
  } finally { await app.cleanup(); }
});
