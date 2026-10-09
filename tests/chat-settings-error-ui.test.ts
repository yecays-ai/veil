import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

regressionContract("chat.settings-errors-follow-chat-info", "async-race-safety",
  "Chat Info owns setting failures, clears them on success, and drops failures after closing", async () => {
    const dom = new JSDOM('<div id="root"></div>', {
      url: "http://localhost/messages/peter", pretendToBeVisual: true,
    });
    const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement",
      "Event", "MouseEvent", "localStorage"] as const) install(name, dom.window[name]);
    const indexedDB = new IDBFactory();
    install("indexedDB", indexedDB);
    install("self", dom.window);
    install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
    install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
    install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    install("ResizeObserver", class { observe() {} disconnect() {} });
    install("BroadcastChannel", undefined);
    install("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(dom.window, "indexedDB", { configurable: true, value: indexedDB });
    dom.window.HTMLElement.prototype.scrollTo = () => {};

    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { ChatRoom } = await import("../components/chat/chat-room");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserContactStorage } = await import("../lib/contact-storage");
    const { browserBindingStorage } = await import("../lib/binding-storage");
    const { browserRegexStorage } = await import("../lib/regex-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const { chatStorage } = await import("../lib/chat/storage");
    const originals = {
      foundation: browserFoundationStorage.load,
      contacts: browserContactStorage.load,
      bindings: browserBindingStorage.load,
      regex: browserRegexStorage.load,
      update: chatStorage.updateSessionSettings,
    };
    const saves: ReturnType<typeof deferred<void>>[] = [];
    const patches: unknown[] = [];
    browserFoundationStorage.load = async () => normalizeFoundation({
      characters: [{ characterId: "peter", name: "Peter" }],
    });
    browserContactStorage.load = async () => ({ version: 1, contacts: [] }) as never;
    browserBindingStorage.load = async () => ({ global: {}, characters: {} }) as never;
    browserRegexStorage.load = async () => ({ groups: [] }) as never;
    await chatStorage.openSession("peter");
    chatStorage.updateSessionSettings = async (_sessionId, patch) => {
      patches.push(patch);
      const save = saves.shift();
      assert.ok(save, "expected a controlled setting save");
      return save.promise;
    };

    const root = createRoot(dom.window.document.getElementById("root")!);
    const container = dom.window.document.getElementById("root")!;
    const waitFor = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        assert.ok(Date.now() < deadline, "ChatRoom did not reach the expected mounted state");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    const clickSwitch = async (labelText: string) => {
      const label = [...container.querySelectorAll("label")]
        .find((candidate) => candidate.textContent?.includes(labelText));
      const input = label?.querySelector<HTMLInputElement>('[role="switch"]');
      assert.ok(input, `missing switch: ${labelText}`);
      await act(async () => { input.click(); });
    };
    try {
      await act(async () => {
        root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "peter" })));
      });
      await waitFor(() => !!container.querySelector('[aria-label="Conversation settings"]'));
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]')!.click(); });
      await waitFor(() => !!container.querySelector('[aria-label="Chat Info"]'));

      const currentFailure = deferred<void>();
      saves.push(currentFailure);
      await clickSwitch("Pin Conversation");
      assert.deepEqual(patches.at(-1), { pinned: true });
      await act(async () => { currentFailure.reject(new Error("Pin could not be saved")); await currentFailure.promise.catch(() => {}); });
      assert.equal(container.querySelector('[aria-label="Chat Info"] [role="alert"]')?.textContent,
        "Pin could not be saved");
      assert.equal(container.querySelector(".chat-error"), null,
        "setting errors must not be published into the obscured ChatRoom notice");

      const success = deferred<void>();
      saves.push(success);
      await clickSwitch("Streaming Replies");
      assert.deepEqual(patches.at(-1), { streamOnline: true });
      await act(async () => { success.resolve(); await success.promise; });
      assert.equal(container.querySelector('[aria-label="Chat Info"] [role="alert"]'), null);

      const staleFailure = deferred<void>();
      saves.push(staleFailure);
      await clickSwitch("Reply When Keyboard Closes");
      assert.deepEqual(patches.at(-1), { autoReplyOnKeyboardDismiss: true });
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!.click();
      });
      await act(async () => { staleFailure.reject(new Error("late setting failure")); await staleFailure.promise.catch(() => {}); });
      assert.equal(container.querySelector('[role="alert"]'), null,
        "a failure completing after Chat Info closes must not reappear in ChatRoom");
      await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]')!.click(); });
      await waitFor(() => !!container.querySelector('[aria-label="Chat Info"]'));
      assert.equal(container.querySelector('[aria-label="Chat Info"] [role="alert"]'), null);
    } finally {
      await act(async () => { root.unmount(); });
      browserFoundationStorage.load = originals.foundation;
      browserContactStorage.load = originals.contacts;
      browserBindingStorage.load = originals.bindings;
      browserRegexStorage.load = originals.regex;
      chatStorage.updateSessionSettings = originals.update;
      for (const [name, descriptor] of savedGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      dom.window.close();
    }
  });
