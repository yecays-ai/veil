import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createPresetDocument } from "../lib/preset";
import { copyPreset } from "../lib/preset-library";

// The Preset import file input must not carry an `accept` filter (iPhone compatibility experiment), and
// everything it used to filter out by file type must still be rejected by the import itself.
async function fixture() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings/presets", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const) install(name, dom.window[name]);
  install("self", dom.window); install("IS_REACT_ACT_ENVIRONMENT", true);
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...rest); };
  dom.window.localStorage.setItem("veil.preset.v1", JSON.stringify(copyPreset(createPresetDocument(), undefined, "Existing", "existing")));
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PresetList } = await import("../components/settings/presets/preset-list");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  await act(async () => {
    root.render(createElement(AppRouterContext.Provider, { value: router as never }, createElement(PresetList)));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  const input = () => dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const stored = () => dom.window.localStorage.getItem("veil.preset.v1");
  const text = () => dom.window.document.body.textContent ?? "";
  const alert = () => dom.window.document.querySelector('[role="alert"]')?.textContent ?? "";
  const choose = async (name: string, content: string) => {
    await act(async () => {
      Object.defineProperty(input(), "files", { configurable: true, value: [{ name, text: async () => content }] });
      input().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  };
  const close = async () => {
    await act(async () => { root.unmount(); await new Promise<void>((resolve) => setImmediate(resolve)); });
    loader._load = originalLoad; dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { input, stored, text, alert, choose, close };
}
const sample = (name: string) => readFileSync(`docs/fixtures/d6/preset-${name}-id-test.json`, "utf8");

test("the Preset import input has no accept filter, so no file type is greyed out by the picker", async () => {
  const ui = await fixture();
  try {
    assert.ok(ui.input(), "the file input exists");
    assert.equal(ui.input().hasAttribute("accept"), false);
  } finally { await ui.close(); }
});

test("a valid Preset JSON file is still imported", async () => {
  const ui = await fixture();
  try {
    await ui.choose("preset-normal-id-test.json", sample("normal"));
    assert.match(ui.text(), /Preset imported\./);
    assert.ok(JSON.parse(ui.stored()!).presets.some((preset: { id: string }) => preset.id === "d6-phone-contract"));
  } finally { await ui.close(); }
});

const rejected: [string, string, RegExp][] = [
  ["a non-JSON text file", "this is just a note", /not valid Preset JSON/],
  ["valid JSON that is not a Preset", JSON.stringify({ hello: "world" }), /\S/],
  ["a JSON array", "[]", /\S/],
  ["an over-long Preset ID (D6)", sample("long"), /Preset ID must be 1–200 characters/],
  ["a Preset ID with surrounding whitespace (D6)", sample("whitespace"), /Preset ID must be 1–200 characters/],
];
for (const [name, content, message] of rejected) {
  test(`${name} is rejected and the existing library is untouched`, async () => {
    const ui = await fixture();
    try {
      const before = ui.stored();
      await ui.choose("picked.json", content);
      assert.doesNotMatch(ui.text(), /Preset imported\./);
      assert.match(ui.alert(), message, "the existing import UI shows an error");
      assert.equal(ui.stored(), before, "nothing was written");
    } finally { await ui.close(); }
  });
}
