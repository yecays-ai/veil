import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { Recording } from "../lib/chat/voice-recorder";

async function mounted() {
  let holdMic: Promise<void> | null = null;
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>(), trackStops: number[] = [], sent: Recording[] = [];
  const stream = { getTracks: () => [{ stop: () => trackStops.push(1) }] };
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === "audio/webm";
    state = "inactive"; ondataavailable: ((e: { data: Blob }) => void) | null = null; onstop: ((e: Event) => void) | null = null; onerror = null;
    constructor(readonly s: unknown, readonly o: { mimeType: string }) {}
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(64)], { type: "audio/webm" }) }); this.onstop?.(new Event("stop")); }
  }
  Object.defineProperty(dom.window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { if (holdMic) await holdMic; return stream; } } });
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, MediaRecorder: FakeRecorder })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const { createRoot } = await import("react-dom/client");
  const { useVoiceMode } = await import("../components/chat/use-voice-mode");
  let failNext = false;
  function Harness() {
    const voice = useVoiceMode({ disabled: false, onSend: async (recording) => { if (failNext) throw new Error("save failed"); sent.push(recording); } });
    const label = voice.mode === "off" ? "Message..." : voice.mode === "ready" ? "Tap to Record" : `Recording... ${Math.floor(voice.elapsed / 1000)}`;
    return createElement("div", null,
      createElement("button", { id: "mic", onClick: voice.enter }, "mic"),
      createElement("button", { id: "keys", onClick: voice.exit }, "keys"),
      createElement("button", { id: "bar", onClick: voice.tap }, label),
      createElement("button", { id: "cancel", onClick: voice.cancel }, "cancel"),
      createElement("button", { id: "resend", onClick: () => void voice.resend() }, voice.unsent ? "unsent" : "none"),
      createElement("p", { id: "error" }, voice.error));
  }
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  await act(async () => { root.render(createElement(Harness)); });
  const el = (id: string) => container.querySelector<HTMLButtonElement>(`#${id}`)!;
  const click = (id: string) => act(async () => { el(id).click(); });
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) { assert.ok(Date.now() < deadline, "did not settle"); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
  };
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    loader._load = originalLoad; dom.window.close();
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  };
  return { el, click, wait, cleanup, sent, trackStops, fail: (on = true) => { failNext = on; },
    holdMic: () => { let open!: () => void; holdMic = new Promise<void>((resolve) => { open = resolve; }); return () => { holdMic = null; open(); }; } };
}

test("Voice mode: the microphone only enters voice mode; the bar then records, and a second tap sends and stays ready", async () => {
  const app = await mounted();
  try {
    assert.equal(app.el("bar").textContent, "Message...");
    await app.click("mic");
    assert.equal(app.el("bar").textContent, "Tap to Record");
    assert.equal(app.trackStops.length, 0, "nothing is recorded by entering voice mode");
    await app.click("bar");
    await app.wait(() => /^Recording/.test(app.el("bar").textContent!));
    await app.click("bar");
    await app.wait(() => app.sent.length === 1);
    assert.equal(app.el("bar").textContent, "Tap to Record", "back to ready, still in voice mode");
    assert.equal(app.sent[0].blob.type, "audio/webm");
    assert.equal(app.trackStops.length, 1, "the microphone is released");
  } finally { await app.cleanup(); }
});

test("Voice mode: three recordings in a row are three sends, and only the person leaves the mode", async () => {
  const app = await mounted();
  try {
    await app.click("mic");
    for (let index = 1; index <= 3; index += 1) {
      await app.click("bar");
      await app.wait(() => /^Recording/.test(app.el("bar").textContent!));
      await app.click("bar");
      await app.wait(() => app.sent.length === index);
      assert.equal(app.el("bar").textContent, "Tap to Record");
    }
    await app.click("keys");
    assert.equal(app.el("bar").textContent, "Message...");
  } finally { await app.cleanup(); }
});

test("Voice mode: cancel drops the recording without sending and returns to ready", async () => {
  const app = await mounted();
  try {
    await app.click("mic");
    await app.click("bar");
    await app.wait(() => /^Recording/.test(app.el("bar").textContent!));
    await app.click("keys");
    assert.match(app.el("bar").textContent!, /^Recording/, "the mode cannot be left while recording");
    await app.click("cancel");
    assert.equal(app.el("bar").textContent, "Tap to Record");
    assert.equal(app.sent.length, 0);
    assert.equal(app.trackStops.length, 1);
  } finally { await app.cleanup(); }
});

test("Voice mode: a failed save is reported and the bar is ready again", async () => {
  const app = await mounted();
  try {
    app.fail();
    await app.click("mic");
    await app.click("bar");
    await app.wait(() => /^Recording/.test(app.el("bar").textContent!));
    await app.click("bar");
    await app.wait(() => app.el("error").textContent === "save failed");
    assert.equal(app.el("bar").textContent, "Tap to Record");
    assert.equal(app.el("resend").textContent, "unsent", "the recording is kept for another try");
    await app.click("bar");
    assert.equal(app.el("bar").textContent, "Tap to Record", "no new recording replaces the unsent one");
    assert.match(app.el("error").textContent!, /again/);
    app.fail(false);
    await app.click("resend");
    await app.wait(() => app.sent.length === 1);
    assert.equal(app.el("resend").textContent, "none");
    assert.equal(app.el("error").textContent, "");
  } finally { await app.cleanup(); }
});

test("Voice mode: leaving while recording releases the microphone", async () => {
  const app = await mounted();
  await app.click("mic");
  await app.click("bar");
  await app.wait(() => /^Recording/.test(app.el("bar").textContent!));
  await app.cleanup();
  assert.equal(app.trackStops.length, 1);
  assert.equal(app.sent.length, 0);
});

test("Voice mode: leaving voice mode while the microphone is starting releases it when it arrives", async () => {
  const app = await mounted();
  try {
    const release = app.holdMic();
    await app.click("mic");
    await app.click("bar");
    await app.click("keys");
    assert.equal(app.el("bar").textContent, "Message...");
    release();
    await app.wait(() => app.trackStops.length === 1);
    assert.equal(app.el("bar").textContent, "Message...", "no recording starts after the person left");
    assert.equal(app.sent.length, 0);
  } finally { await app.cleanup(); }
});
