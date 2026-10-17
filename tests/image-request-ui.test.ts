import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { chatEngine } from "../lib/chat/engine";
import { startImageJob, stopImageJobs, type ImageSource } from "../lib/imagegen/job";
import { ImageGenError } from "../lib/imagegen/generate";
import type { ChatMessage } from "../lib/chat/types";

const message: ChatMessage = { id: "m1", sessionId: "s1", role: "assistant", content: "[你发送了一张照片:a lake]", status: "complete", createdAt: 1, order: 1,
  imageGen: { prompt: "a lake", character: false } };

async function mounted() {
  stopImageJobs();
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const retries: unknown[][] = [], original = chatEngine.retryImage;
  chatEngine.retryImage = async (...args: unknown[]) => { retries.push(args); };
  const { createRoot } = await import("react-dom/client");
  const { ImageRequest } = await import("../components/chat/messages/image-request");
  const container = dom.window.document.getElementById("root")!, root = createRoot(container);
  const render = (multiSelect = false) => act(async () => { root.render(createElement(ImageRequest, { message, multiSelect })); });
  await render();
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name)!;
  const click = (element: HTMLElement) => act(async () => { element.click(); });
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    chatEngine.retryImage = original; loader._load = originalLoad; stopImageJobs(); dom.window.close();
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  };
  return { container, button, click, render, cleanup, retries, dom };
}
const subject = { appearance: null, avatar: null };
const source = (generate: ImageSource["generate"]): ImageSource => ({ config: async () => ({ baseUrl: "https://i.test/v1", apiKey: "k", model: "m" }), generate, process: async (blob) => ({ blob, width: 1, height: 1 }) });

test("Image request: with no job it keeps the asked-for words and offers Try again and Change words", async () => {
  const app = await mounted();
  try {
    assert.match(app.container.textContent ?? "", /Photo not ready/);
    assert.match(app.container.textContent ?? "", /a lake/);
    await app.click(app.button("Try again"));
    assert.deepEqual(app.retries, [["s1", "m1", undefined]]);
  } finally { await app.cleanup(); }
});

test("Image request: new words are sent with the retry, and an empty box cannot be sent", async () => {
  const app = await mounted();
  try {
    await app.click(app.button("Change words"));
    const area = app.container.querySelector("textarea")!;
    assert.equal(area.value, "a lake");
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(area, "");
      area.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(app.button("Try again").disabled, true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(app.dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(area, "a lake at dusk");
      area.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    });
    await app.click(app.button("Try again"));
    assert.deepEqual(app.retries, [["s1", "m1", "a lake at dusk"]]);
  } finally { await app.cleanup(); }
});

test("Image request: while the picture is being made it says so and offers nothing; a failure shows why", async () => {
  const app = await mounted();
  try {
    const gate = Promise.withResolvers<Blob>();
    const job = startImageJob(message, subject, source(() => gate.promise), async () => true);
    await app.render();
    assert.match(app.container.textContent ?? "", /Taking a photo/);
    assert.equal(app.container.querySelectorAll("button").length, 0);
    gate.reject(new ImageGenError("auth", "auth", 401));
    await act(async () => { await job; });
    assert.match(app.container.textContent ?? "", /rejected the API Key/);
    assert.ok(app.button("Try again"));
  } finally { await app.cleanup(); }
});

test("Image request: while messages are being selected a tap does not ask again", async () => {
  const app = await mounted();
  try {
    await app.render(true);
    await app.click(app.button("Try again"));
    await app.click(app.button("Change words"));
    assert.equal(app.retries.length, 0);
    assert.equal(app.container.querySelector("textarea"), null);
  } finally { await app.cleanup(); }
});
