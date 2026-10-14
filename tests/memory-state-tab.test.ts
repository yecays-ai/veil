import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { StateDetail } from "../lib/memory/state-runtime";
import { chatStorage } from "../lib/chat/storage";

const character = { characterId: "c", backstory: "Background", name: "Peter" };
const detail: StateDetail = {
  view: { characterId: "c", background: "Background", entries: [{ id: "2", key: "home", value: "Peter owns his home.", status: "active" }] },
  changes: [
    { id: "1", key: "home", value: "Peter lives in Queens.", version: 1, createdAt: 1000, current: false },
    { id: "2", key: "home", value: "Peter owns his home.", version: 2, createdAt: 2000, current: true },
  ],
};

async function mount(load: () => Promise<StateDetail>, run: (root: HTMLElement) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const names = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT", "BroadcastChannel"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "BroadcastChannel" ? undefined : dom.window[name as keyof typeof dom.window] }));
  const originalSubscribe = chatStorage.subscribe;
  chatStorage.subscribe = () => () => undefined;
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const { createRoot } = await import("react-dom/client");
  const { MemoryState } = await import("../components/memory-state");
  const root = dom.window.document.getElementById("root")!, react = createRoot(root);
  try {
    await act(async () => react.render(createElement(MemoryState, { character, load })));
    await run(root);
  } finally {
    await act(async () => react.unmount());
    loader._load = originalLoad; chatStorage.subscribe = originalSubscribe;
    names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : delete (globalThis as Record<string, unknown>)[name]);
    dom.window.close();
  }
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

test("State tab shows the current value and how it changed, read-only", async () => {
  await mount(async () => detail, async (root) => {
    await settle();
    const text = root.textContent!;
    assert.match(text, /Peter owns his home\./);
    assert.match(text, /Peter lives in Queens\./, "the earlier value appears in the change record");
    assert.ok(text.includes("now"), "the current version is marked");
    assert.equal(root.querySelectorAll("button, input, textarea").length, 0, "State is read-only for the user");
  });
});

test("a failed State read is reported, never shown as no State", async () => {
  await mount(async () => { throw new Error("boom"); }, async (root) => {
    await settle();
    assert.match(root.textContent!, /Could not load Character State\./);
    assert.doesNotMatch(root.textContent!, /No lasting changes recorded/);
  });
});

test("a State with a single version has no change record", async () => {
  const single: StateDetail = { view: detail.view, changes: [detail.changes[1]] };
  await mount(async () => single, async (root) => {
    await settle();
    assert.doesNotMatch(root.textContent!, /Changes/);
  });
});
