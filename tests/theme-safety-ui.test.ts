import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "../components/theme-provider";
import { FoundationProvider } from "../components/foundation-provider";
import { GlobalProfileSettings } from "../components/settings/global-profile-settings";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { defaultFoundation } from "../lib/foundation-types";
import { browserThemeStorage } from "../lib/theme-storage";
import * as themeStorage from "../lib/theme-storage";
import { browserAppearanceImageStorage } from "../lib/appearance-image-storage";
import { defaultSnapshot, type ThemeDocument } from "../lib/theme-types";
import { chatStorage } from "../lib/chat/storage";
import { DEFAULT_BUBBLE_TIMING } from "../lib/chat/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function mounted(run: (container: HTMLElement, root: ReturnType<typeof CreateRoot>, dom: JSDOM) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://veil.test" });
  const keys = ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLDialogElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : key === "document" ? dom.window.document : dom.window[key as keyof typeof dom.window] });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const container = dom.window.document.getElementById("root")!;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  try { await run(container, root, dom); }
  finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key); });
  }
}
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert(Date.now() < deadline, "mounted UI did not reach the expected state");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

test("mounted ThemeProvider rejects writes after failed hydration and leaves persisted data untouched", async () => {
  const originals = { load: browserThemeStorage.load, transact: browserThemeStorage.transact };
  let writes = 0, failure: unknown;
  function Probe() {
    const theme = useTheme();
    return createElement("button", { "data-ready": String(theme.ready), onClick: () => {
      void theme.updateProfile((profile) => ({ ...profile, icons: {} })).catch((reason) => { failure = reason; });
    } }, "Save");
  }
  try {
    browserThemeStorage.load = async () => { throw new Error("hydration unavailable"); };
    browserThemeStorage.transact = async () => { writes++; throw new Error("unexpected write"); };
    await mounted(async (container, root, dom) => {
      const stored = JSON.stringify({ userConfiguration: "must survive" });
      dom.window.localStorage.setItem("companion-phone.appearance.v1", stored);
      await act(async () => { root.render(createElement(ThemeProvider, null, createElement(Probe))); });
      assert.equal(container.querySelector("button")!.dataset.ready, "false");
      await act(async () => { container.querySelector("button")!.click(); });
      await waitFor(() => !!failure);
      assert.equal(writes, 0);
      assert.equal(dom.window.localStorage.getItem("companion-phone.appearance.v1"), stored);
    });
  } finally { Object.assign(browserThemeStorage, originals); }
});

test("mounted ThemeProvider cleanup prevents late image reads from creating Object URLs", async () => {
  const originalLoad = browserThemeStorage.load, originalRead = browserAppearanceImageStorage.readBlob;
  const originalCreate = URL.createObjectURL;
  const pending = deferred<Blob | null>();
  let reads = 0, creates = 0;
  try {
    const saved: ThemeDocument = { version: 1, current: defaultSnapshot(), presets: [] };
    saved.current.profile.wallpaper.source = `appearance-asset:${"a".repeat(64)}`;
    browserThemeStorage.load = async () => saved;
    browserAppearanceImageStorage.readBlob = () => { reads++; return pending.promise; };
    URL.createObjectURL = () => { creates++; return "blob:late"; };
    await mounted(async (_container, root) => {
      await act(async () => { root.render(createElement(ThemeProvider, null)); });
      await waitFor(() => reads === 1);
      await act(async () => { root.render(null); });
      await act(async () => { pending.resolve(new Blob(["image"])); await pending.promise; });
      assert.equal(creates, 0);
    });
  } finally {
    browserThemeStorage.load = originalLoad; browserAppearanceImageStorage.readBlob = originalRead;
    URL.createObjectURL = originalCreate;
  }
});

test("mounted background chooser keeps the latest file and failed blur writes restore the saved value", async () => {
  const originals = { foundation: browserFoundationStorage.load, readImage: themeStorage.readImage,
    profile: chatStorage.readGlobalProfileSettings, background: chatStorage.readChatBackgroundSettings,
    blur: chatStorage.updateGlobalChatBackgroundBlur, subscribe: chatStorage.subscribe };
  const first = deferred<string>(), second = deferred<string>();
  const failedBlur = deferred<void>();
  let blurCalls = 0;
  try {
    browserFoundationStorage.load = async () => defaultFoundation();
    chatStorage.readGlobalProfileSettings = async () => ({ id: "global-profile-settings", hereThereEnabled: true, nextCommentAt: null, bubbleTiming: DEFAULT_BUBBLE_TIMING });
    chatStorage.readChatBackgroundSettings = async () => ({ id: "chat-background", blur: 3 });
    chatStorage.subscribe = () => () => {};
    chatStorage.updateGlobalChatBackgroundBlur = async () => { blurCalls++; await failedBlur.promise; throw new Error("Could not save blur"); };
    Object.assign(themeStorage, { readImage: (file: File) => file.name === "first.png" ? first.promise : second.promise });
    await mounted(async (container, root, dom) => {
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(GlobalProfileSettings))); });
      await waitFor(() => container.textContent?.includes("Global Chat Background") === true);
      await act(async () => { container.querySelector<HTMLButtonElement>(".global-profile-disclosure-row")!.click(); });
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const choose = async (name: string) => {
        Object.defineProperty(input, "files", { configurable: true, value: [new dom.window.File([name], name, { type: "image/png" })] });
        await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
      };
      await waitFor(() => !input.disabled);
      await choose("first.png"); await choose("second.png");
      await act(async () => { second.resolve("data:image/png;base64,Ag=="); });
      await waitFor(() => !!container.querySelector("dialog img"));
      assert.equal(container.querySelector("dialog img")!.getAttribute("src"), "data:image/png;base64,Ag==");
      await act(async () => { first.resolve("data:image/png;base64,AQ=="); });
      assert.equal(container.querySelector("dialog img")!.getAttribute("src"), "data:image/png;base64,Ag==");
      const range = container.querySelector<HTMLInputElement>('input[type="range"]')!;
      const nativeSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        nativeSet.call(range, "12");
        range.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        range.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      });
      await waitFor(() => blurCalls === 1);
      assert(container.textContent?.includes("Global blur (3px)"), "pending save does not publish an optimistic blur");
      await act(async () => { failedBlur.resolve(); });
      await waitFor(() => container.textContent?.includes("Could not save blur") === true);
      assert.equal(range.value, "3");
      assert.equal((await chatStorage.readChatBackgroundSettings()).blur, 3);
    });
  } finally {
    browserFoundationStorage.load = originals.foundation;
    Object.assign(themeStorage, { readImage: originals.readImage });
    chatStorage.readGlobalProfileSettings = originals.profile; chatStorage.readChatBackgroundSettings = originals.background;
    chatStorage.updateGlobalChatBackgroundBlur = originals.blur; chatStorage.subscribe = originals.subscribe;
  }
});
