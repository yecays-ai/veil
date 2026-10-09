import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Part 5 F9: a mounted ImageCropDialog whose `source` changes must not keep the previous image's
// readiness, size, zoom or position.
async function harness() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const proto = dom.window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  proto.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).setPointerCapture = () => {};
  // React reads the DOM at import time, so it has to be loaded after the jsdom globals exist.
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ImageCropDialog } = await import("../components/image-crop-dialog");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const calls = { original: 0, cancel: 0 };
  const render = (source: string, extra: { title?: string } = {}) => act(() => {
    root.render(createElement(ImageCropDialog, {
      source, title: extra.title, onSave: () => {}, onUseOriginal: () => { calls.original++; }, onCancel: () => { calls.cancel++; },
    }));
  });
  const $ = (selector: string) => dom.window.document.querySelector(selector);
  const img = () => $("img") as HTMLImageElement;
  const button = (label: string) => [...dom.window.document.querySelectorAll("button")].find((b) => b.textContent === label)!;
  const zoom = () => $("input[type=range]") as HTMLInputElement;
  const loadImage = (element: HTMLImageElement, width: number, height: number) => act(() => {
    Object.defineProperty(element, "naturalWidth", { configurable: true, value: width });
    Object.defineProperty(element, "naturalHeight", { configurable: true, value: height });
    element.dispatchEvent(new dom.window.Event("load"));
  });
  const failImage = (element: HTMLImageElement) => act(() => { element.dispatchEvent(new dom.window.Event("error")); });
  const setZoom = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(zoom(), value);
    zoom().dispatchEvent(new dom.window.Event("input", { bubbles: true })); zoom().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const drag = (dx: number, dy: number) => act(() => {
    const area = $(".avatar-crop-area")!;
    const fire = (type: string, x: number, y: number) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, "pointerId", { value: 1 });
      area.dispatchEvent(event);
    };
    fire("pointerdown", 100, 100); fire("pointermove", 100 + dx, 100 + dy); fire("pointerup", 100 + dx, 100 + dy);
  });
  const cleanup = async () => {
    await act(() => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { act, render, $, img, button, zoom, loadImage, failImage, setZoom, drag, calls, cleanup };
}
const transform = (h: Awaited<ReturnType<typeof harness>>) => h.img().style.transform;
const actionsDisabled = (h: Awaited<ReturnType<typeof harness>>) =>
  [h.button("Save crop").disabled, h.button("Use original").disabled];

test("a source that has not loaded yet cannot be saved or used with the previous image's state", async () => {
  const h = await harness();
  try {
    await h.render("image:a");
    await h.loadImage(h.img(), 400, 300);
    await h.setZoom("2");
    await h.drag(50, 30);
    assert.deepEqual(actionsDisabled(h), [false, false], "A is ready");
    assert.equal(h.zoom().value, "2");
    assert.notEqual(transform(h), "translate(-50%, -50%) translate(0px, 0px)", "A was dragged away from the centre");

    await h.render("image:b");
    assert.equal(h.img().getAttribute("src"), "image:b");
    assert.deepEqual(actionsDisabled(h), [true, true], "B is not ready, so A's readiness must not carry over");
    assert.equal(h.zoom().value, "1", "zoom belongs to the previous image");
    assert.equal(transform(h), "translate(-50%, -50%) translate(0px, 0px)", "position belongs to the previous image");
    assert.equal(h.img().style.width, "240px", "back to the unloaded 1x1 placeholder, not A's size");
    await h.act(async () => { h.button("Use original").click(); });
    assert.equal(h.calls.original, 0, "a disabled button never confirms A's state for B");
  } finally { await h.cleanup(); }
});

test("a source that fails to load leaves nothing usable and shows the error", async () => {
  const h = await harness();
  try {
    await h.render("image:a");
    await h.loadImage(h.img(), 400, 300);
    await h.render("image:b");
    await h.failImage(h.img());
    assert.equal(h.$("[role=alert]")?.textContent, "This image could not be loaded.");
    assert.deepEqual(actionsDisabled(h), [true, true], "B failed: A's readiness must not remain");
    assert.equal(h.img().style.width, "240px", "back to the unloaded 1x1 placeholder");
  } finally { await h.cleanup(); }
});

test("an image that errors after it has loaded stops being usable", async () => {
  const h = await harness();
  try {
    await h.render("image:a");
    await h.loadImage(h.img(), 400, 300);
    assert.deepEqual(actionsDisabled(h), [false, false]);
    await h.failImage(h.img());
    assert.equal(h.$("[role=alert]")?.textContent, "This image could not be loaded.");
    assert.deepEqual(actionsDisabled(h), [true, true], "onError must clear readiness");
  } finally { await h.cleanup(); }
});

test("a late event from the previous image cannot make the new source ready", async () => {
  const h = await harness();
  try {
    await h.render("image:a");
    const first = h.img();
    await h.render("image:b");
    await h.render("image:c");
    // The browser may still deliver an event that belongs to an earlier source.
    await h.loadImage(first, 640, 480);
    assert.deepEqual(actionsDisabled(h), [true, true], "only the current source's own load makes it ready");
    await h.loadImage(h.img(), 200, 200);
    assert.deepEqual(actionsDisabled(h), [false, false]);
    assert.equal(h.img().getAttribute("src"), "image:c");
    assert.equal(h.img().style.width, "240px", "C's own size (200x200 covering a 240px viewport) is used");
  } finally { await h.cleanup(); }
});

test("once the new source loads, cropping works again from a clean state", async () => {
  const h = await harness();
  try {
    await h.render("image:a");
    await h.loadImage(h.img(), 400, 300);
    await h.setZoom("3");
    await h.render("image:b");
    await h.loadImage(h.img(), 300, 600);
    assert.deepEqual(actionsDisabled(h), [false, false]);
    assert.equal(h.zoom().value, "1", "B starts unzoomed");
    await h.setZoom("2");
    assert.equal(h.zoom().value, "2", "zoom works on B");
    await h.drag(10, 20);
    await h.act(async () => { h.button("Use original").click(); });
    assert.equal(h.calls.original, 1);
  } finally { await h.cleanup(); }
});

test("re-rendering with the same source keeps the loaded image, zoom and position", async () => {
  const h = await harness();
  try {
    await h.render("image:a", { title: "First" });
    await h.loadImage(h.img(), 400, 300);
    await h.setZoom("2");
    await h.drag(50, 30);
    const before = transform(h);
    const element = h.img();
    await h.render("image:a", { title: "Second" });
    assert.equal(h.$("h2")?.textContent, "Second", "the dialog did re-render");
    assert.equal(h.img(), element, "the same image element is kept");
    assert.deepEqual(actionsDisabled(h), [false, false]);
    assert.equal(h.zoom().value, "2");
    assert.equal(transform(h), before);
  } finally { await h.cleanup(); }
});
