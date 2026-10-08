import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { browserBindingStorage } from "../lib/binding-storage";
import { copyPreset } from "../lib/preset-library";
import { createPresetDocument } from "../lib/preset";
import { browserPresetStorage } from "../lib/preset-storage";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Action = "save" | "copy" | "delete" | "prompt-save";

async function fixture() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings/presets/p", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const)
    install(name, dom.window[name]);
  install("self", dom.window);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    return originalLoad.call(this, request, ...rest);
  };
  const originalPresetTransact = browserPresetStorage.transact;
  const originalBindingTransact = browserBindingStorage.transact;
  const document = copyPreset(copyPreset(createPresetDocument(), undefined, "Primary", "p"), undefined, "Secondary", "q");
  dom.window.localStorage.setItem("veil.preset.v1", JSON.stringify(document));
  dom.window.localStorage.setItem("veil.bindings.v1", JSON.stringify({ global: { presetId: "p" }, characters: {} }));

  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PresetDetail } = await import("../components/settings/presets/preset-detail");
  const { NewPromptEditor } = await import("../components/settings/presets/prompt-editor");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const pushes: string[] = [];
  const router = { push: (href: string) => pushes.push(href), replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = async (action: Action, presetId: string, key = presetId) => act(async () => {
    const Page = action === "prompt-save" ? NewPromptEditor : PresetDetail;
    root.render(createElement(AppRouterContext.Provider, { value: router as never }, createElement(Page, { presetId, key })));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const button = (label: string) => {
    const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === label);
    assert.ok(found, `button “${label}” exists`);
    return found;
  };
  const click = async (element: HTMLElement) => act(async () => { element.click(); await Promise.resolve(); });
  const input = (labelText: string, value: string, occurrence = 0) => {
    const labels = [...dom.window.document.querySelectorAll("label")]
      .filter((item) => item.textContent?.trim().startsWith(labelText));
    const field = labels[occurrence]?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    assert.ok(field, `field “${labelText}” exists`);
    const proto = field instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    field.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  const startAction = async (action: Action) => {
    if (action === "save") await act(async () => { input("Name", "Primary edited"); });
    if (action === "prompt-save") {
      await act(async () => { input("Name", "Greeting"); input("Identifier", "greeting"); input("Content", "Say hello."); });
    }
    if (action === "delete") {
      await click(dom.window.document.querySelector<HTMLButtonElement>(".preset-actions .settings-danger")!);
      await click(dom.window.document.querySelector<HTMLButtonElement>("[role=dialog] button.settings-danger")!);
    } else {
      await click(button(action === "copy" ? "Copy" : "Save"));
    }
  };
  const readDocument = () => JSON.parse(dom.window.localStorage.getItem("veil.preset.v1")!) as ReturnType<typeof createPresetDocument>;
  const flush = async () => act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); await Promise.resolve(); });
  const close = async () => {
    await act(async () => { root.unmount(); await new Promise<void>((resolve) => setImmediate(resolve)); });
    browserPresetStorage.transact = originalPresetTransact;
    browserBindingStorage.transact = originalBindingTransact;
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { dom, pushes, render, button, click, input, startAction, readDocument, flush, close };
}

const actions: { action: Action; name: string; expected: (pushes: string[], document: ReturnType<typeof createPresetDocument>) => void }[] = [
  { action: "save", name: "Preset save", expected: (pushes) => assert.deepEqual(pushes, ["/settings/presets"]) },
  { action: "copy", name: "Preset copy", expected: (pushes, document) => {
    assert.equal(pushes.length, 1);
    assert.ok(document.presets.some((item) => `/settings/presets/${encodeURIComponent(item.id)}` === pushes[0] && item.name === "Primary Copy"));
  } },
  { action: "delete", name: "Preset delete", expected: (pushes) => assert.deepEqual(pushes, ["/settings/presets"]) },
  { action: "prompt-save", name: "Prompt save", expected: (pushes) => assert.deepEqual(pushes, ["/settings/presets/p"]) },
];

for (const { action, name, expected } of actions) {
  test(`${name}: a current page navigates after its write completes`, async () => {
    const ui = await fixture(), entered = deferred(), release = deferred();
    const transact = browserPresetStorage.transact;
    browserPresetStorage.transact = async (update) => {
      const result = await transact(update);
      entered.resolve();
      await release.promise;
      return result;
    };
    try {
      await ui.render(action, "p");
      await ui.startAction(action);
      await entered.promise;
      assert.deepEqual(ui.pushes, []);
      release.resolve();
      await ui.flush();
      expected(ui.pushes, ui.readDocument());
    } finally { release.resolve(); await ui.close(); }
  });

  test(`${name}: completion after changing page identity preserves the write without stale navigation`, async () => {
    const ui = await fixture(), entered = deferred(), release = deferred();
    const transact = browserPresetStorage.transact;
    browserPresetStorage.transact = async (update) => {
      const result = await transact(update);
      entered.resolve();
      await release.promise;
      return result;
    };
    try {
      await ui.render(action, "p");
      await ui.startAction(action);
      await entered.promise;
      await ui.render(action, "q", "q");
      release.resolve();
      await ui.flush();
      assert.deepEqual(ui.pushes, []);
      const saved = ui.readDocument();
      if (action === "save") assert.equal(saved.presets.find((item) => item.id === "p")?.name, "Primary edited");
      if (action === "copy") assert.ok(saved.presets.some((item) => item.name === "Primary Copy"));
      if (action === "delete") {
        assert.ok(!saved.presets.some((item) => item.id === "p"));
        assert.equal((await browserBindingStorage.load()).global.presetId, undefined);
      }
      if (action === "prompt-save") assert.ok(saved.presets.find((item) => item.id === "p")?.prompts.some((item) => item.identifier === "greeting"));
    } finally { release.resolve(); await ui.close(); }
  });

  test(`${name}: a current-page write failure stays visible and does not navigate`, async () => {
    const ui = await fixture(), entered = deferred();
    browserPresetStorage.transact = async () => { entered.resolve(); throw new Error("Preset write failed"); };
    try {
      await ui.render(action, "p");
      await ui.startAction(action);
      await entered.promise;
      await ui.flush();
      assert.match(ui.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /Preset write failed/);
      assert.deepEqual(ui.pushes, []);
      if (action === "save") assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>(".settings-editor input")?.value, "Primary edited");
      if (action === "prompt-save") assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>(".settings-editor input")?.value, "Greeting");
    } finally { await ui.close(); }
  });
}
