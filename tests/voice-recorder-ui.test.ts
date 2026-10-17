import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { browserTtsConfigStorage } from "../lib/tts/config-storage";
import type { Recording } from "../lib/chat/voice-recorder";

async function mounted(config: Record<string, string>, transcribe?: () => Response) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>(), trackStops: number[] = [], sent: { recording: Recording; transcript: string }[] = [];
  const stream = { getTracks: () => [{ stop: () => trackStops.push(1) }] };
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === "audio/webm";
    state = "inactive"; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: ((e: Event) => void) | null = null; onerror = null;
    constructor(readonly s: unknown, readonly o: { mimeType: string }) {}
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: "audio/webm" }) }); this.onstop?.(new Event("stop")); }
  }
  Object.defineProperty(dom.window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  const requests: FormData[] = [];
  const fakeFetch = async (_url: string, init: RequestInit) => { requests.push(init.body as FormData); return transcribe!(); };
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, MediaRecorder: FakeRecorder, fetch: fakeFetch })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }, revoked: string[] = [];
  URL.createObjectURL = () => "blob:rec-1"; URL.revokeObjectURL = (url) => { revoked.push(url); };
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const originalLoadConfig = browserTtsConfigStorage.load;
  browserTtsConfigStorage.load = async () => ({ baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "", ...config });
  const { createRoot } = await import("react-dom/client");
  const { VoiceRecorderPanel } = await import("../components/chat/voice-recorder-panel");
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  let closed = 0;
  await act(async () => {
    root.render(createElement(VoiceRecorderPanel, { disabled: false, onClose: () => { closed += 1; },
      onSend: async (recording: Recording, transcript: string) => { sent.push({ recording, transcript }); } }));
  });
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes(name))!;
  const click = (element: HTMLElement) => act(async () => { element.click(); });
  const type = (text: string) => act(async () => {
    const area = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) { assert.ok(Date.now() < deadline, "did not settle"); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
  };
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    browserTtsConfigStorage.load = originalLoadConfig;
    URL.createObjectURL = urls.create; URL.revokeObjectURL = urls.revoke; loader._load = originalLoad; dom.window.close();
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  };
  return { container, button, click, type, wait, cleanup, sent, trackStops, requests, revoked, closed: () => closed };
}

test("Voice recorder: record, listen, write the words, send; Send waits for the words and the microphone is released", async () => {
  const app = await mounted({});
  try {
    await app.click(app.button("Tap to record"));
    await app.wait(() => !!app.button("Stop"));
    await app.click(app.button("Stop"));
    assert.equal(app.trackStops.length, 1, "the microphone is released when recording stops");
    assert.ok(app.container.querySelector("audio"), "the recording can be listened to");
    assert.equal(app.button("Send").disabled, true, "no words yet");
    await app.type("  on my way  ");
    assert.equal(app.button("Send").disabled, false);
    await app.click(app.button("Send"));
    assert.equal(app.sent.length, 1);
    assert.equal(app.sent[0].transcript, "  on my way  ");
    assert.equal(app.sent[0].recording.blob.type, "audio/webm");
    assert.ok(app.sent[0].recording.durationMs >= 1);
    assert.equal(app.closed(), 1);
    assert.equal(app.requests.length, 0, "no speech-to-text request without a model");
  } finally { await app.cleanup(); }
});

test("Voice recorder: with a speech-to-text model one request fills in the words, and typed words are kept", async () => {
  const app = await mounted({ sttModel: "whisper-1" }, () => new Response(JSON.stringify({ text: "recognised words" })));
  try {
    await app.click(app.button("Tap to record"));
    await app.wait(() => !!app.button("Stop"));
    await app.click(app.button("Stop"));
    await app.wait(() => app.container.querySelector("textarea")?.value === "recognised words");
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].get("model"), "whisper-1");
    await app.click(app.button("Discard"));
    assert.ok(app.button("Tap to record"));
    assert.deepEqual(app.revoked, ["blob:rec-1"]);
  } finally { await app.cleanup(); }
});

test("Voice recorder: a failed speech-to-text request says so, sends nothing, and the words can be typed", async () => {
  const app = await mounted({ sttModel: "whisper-1" }, () => new Response("echo k", { status: 401 }));
  try {
    await app.click(app.button("Tap to record"));
    await app.wait(() => !!app.button("Stop"));
    await app.click(app.button("Stop"));
    await app.wait(() => /rejected the API Key/.test(app.container.textContent ?? ""));
    assert.equal((app.container.textContent ?? "").includes("echo"), false);
    assert.equal(app.sent.length, 0);
    await app.type("typed");
    assert.equal(app.button("Send").disabled, false);
  } finally { await app.cleanup(); }
});

test("Voice recorder: leaving while recording releases the microphone", async () => {
  const app = await mounted({});
  await app.click(app.button("Tap to record"));
  await app.wait(() => !!app.button("Stop"));
  await app.cleanup();
  assert.equal(app.trackStops.length, 1);
  assert.equal(app.sent.length, 0);
});
