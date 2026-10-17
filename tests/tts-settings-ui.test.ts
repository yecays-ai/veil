import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { normalizeBindings, type BindingDocument } from "../lib/bindings";
import { browserTtsConfigStorage } from "../lib/tts/config-storage";
import type { TtsConfig } from "../lib/tts/config";

// The component module is loaded once per process, so its mocked hooks must read the current test's state.
const hooks: { bindings: () => BindingDocument; commit: (update: (current: BindingDocument) => BindingDocument) => Promise<BindingDocument> } = {
  bindings: () => normalizeBindings({}, []), commit: async (update) => update(normalizeBindings({}, [])),
};

async function mounted(reply: () => Response) {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const played: string[] = [], requests: { url: string; body: Record<string, unknown> }[] = [];
  class FakeAudio { onended: (() => void) | null = null; constructor(readonly src: string) {} play() { played.push(this.src); return Promise.resolve(); } pause() {} }
  const fakeFetch = async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return reply(); };
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true,
    Audio: FakeAudio, fetch: fakeFetch, BroadcastChannel: undefined })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const revoked: string[] = [];
  URL.createObjectURL = () => "blob:preview"; URL.revokeObjectURL = (url) => { revoked.push(url); };
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  let document: BindingDocument = normalizeBindings({}, ["a"]);
  const commits: BindingDocument[] = [];
  hooks.bindings = () => document;
  hooks.commit = async (update) => { document = update(document); commits.push(document); return document; };
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("use-bindings")) return { useBindings: () => ({ bindings: hooks.bindings(), ready: true, error: "", commit: hooks.commit }) };
    if (request.endsWith("foundation-provider")) return { useFoundation: () => ({ document: { characters: [{ characterId: "a", name: "Peter" }] }, ready: true }) };
    return originalLoad.call(this, request, ...args);
  };
  let stored: TtsConfig = { baseUrl: "https://tts.test/v1", apiKey: "k", model: "tts-1", voice: "nova" };
  const original = { load: browserTtsConfigStorage.load, save: browserTtsConfigStorage.save };
  browserTtsConfigStorage.load = async () => stored;
  browserTtsConfigStorage.save = async (config) => (stored = config);
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { TtsSettings } = await import("../components/settings/tts-settings");
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  const router = { push() {}, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  await act(async () => { root.render(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(PathnameContext.Provider, { value: "/settings/tts" }, createElement(TtsSettings)))); });
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 2500;
    while (!check()) { assert.ok(Date.now() < deadline, "did not settle"); await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); }
  };
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name)!;
  const type = (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    Object.assign(browserTtsConfigStorage, original);
    URL.createObjectURL = urls.create; URL.revokeObjectURL = urls.revoke;
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  };
  return { container, wait, button, type, cleanup, played, requests, revoked, commits, stored: () => stored, document: () => document,
    click: (element: HTMLElement) => act(async () => { element.click(); }) };
}
const mp3 = () => new Response(new Uint8Array(3), { headers: { "content-type": "audio/mpeg" } });

test("Voice settings: the saved config loads, Preview speaks with the default voice and plays it, then the sound is released", async () => {
  const app = await mounted(mp3);
  try {
    await app.wait(() => app.container.querySelector<HTMLInputElement>('input[placeholder="tts-1"]')?.value === "tts-1");
    await app.click(app.button("Preview voice"));
    await app.wait(() => app.played.length === 1);
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, "https://tts.test/v1/audio/speech");
    assert.equal(app.requests[0].body.voice, "nova");
    assert.equal(app.played[0], "blob:preview");
  } finally { await app.cleanup(); }
  assert.deepEqual(app.revoked, ["blob:preview"], "leaving the page releases the sound");
});

test("Voice settings: a changed config is saved on this device only when Save is pressed", async () => {
  const app = await mounted(mp3);
  try {
    await app.wait(() => !!app.container.querySelector('input[placeholder="tts-1"]'));
    const model = app.container.querySelector<HTMLInputElement>('input[placeholder="tts-1"]')!;
    await app.type(model, "gpt-4o-mini-tts");
    assert.equal(app.stored().model, "tts-1", "typing alone saves nothing");
    await act(async () => { app.container.querySelector("form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); });
    await app.wait(() => app.stored().model === "gpt-4o-mini-tts");
    assert.match(app.container.textContent ?? "", /not included in backups/);
  } finally { await app.cleanup(); }
});

test("Voice settings: a Character's voice is written to its bindings on leaving the field and used by its Preview", async () => {
  const app = await mounted(mp3);
  try {
    await app.wait(() => !!app.container.querySelector('input[placeholder="nova"]'));
    const field = app.container.querySelector<HTMLInputElement>('input[placeholder="nova"]')!;
    await app.type(field, "onyx");
    await act(async () => { field.focus(); field.blur(); });
    await app.wait(() => app.commits.length === 1);
    assert.equal(app.document().characters.a.defaults.ttsVoice, "onyx");
    await app.click(app.button("Preview Peter's voice"));
    await app.wait(() => app.requests.length === 1);
    assert.equal(app.requests[0].body.voice, "onyx");
  } finally { await app.cleanup(); }
});

test("Voice settings: a rejected key shows a plain message without the response body, and nothing plays", async () => {
  const app = await mounted(() => new Response("echo k", { status: 401 }));
  try {
    await app.wait(() => !!app.container.querySelector('input[placeholder="tts-1"]'));
    await app.click(app.button("Preview voice"));
    await app.wait(() => /rejected the API Key/.test(app.container.textContent ?? ""));
    assert.equal(app.played.length, 0);
    assert.equal((app.container.textContent ?? "").includes("echo"), false);
  } finally { await app.cleanup(); }
});
