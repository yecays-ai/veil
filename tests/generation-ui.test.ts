import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";
import { TEST_API_CONFIG } from "./chat-engine-fixture";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.mounted-generation-safety", "async-race-safety",
  "mounted chat stops post-Send continuation, preserves replacement originals, disables edits, and exposes explicit continuation", async () => {
    const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
      url: "http://localhost/messages/a", pretendToBeVisual: true,
    });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
      install(name, dom.window[name]);
    const factory = new IDBFactory();
    const origin = lockOrigin();
    Object.defineProperty(dom.window.navigator, "locks", { value: origin.client() });
    Object.defineProperty(dom.window, "indexedDB", { value: factory });
    install("indexedDB", factory); install("self", dom.window); install("BroadcastChannel", undefined);
    install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
    install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
    install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    install("ResizeObserver", class { observe() {} disconnect() {} });
    install("IS_REACT_ACT_ENVIRONMENT", true);
    dom.window.HTMLElement.prototype.scrollTo = () => {};
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { ChatRoom } = await import("../components/chat/chat-room");
    const { chatStorage } = await import("../lib/chat/storage");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    document.runtime.timeAware = false;
    const load = browserFoundationStorage.load, api = browserApiConfigStorage.getApiConfig;
    const send = chatStorage.send, fetch = globalThis.fetch;
    const root = createRoot(dom.window.document.getElementById("root")!);
    const pendingResponses: Array<() => void> = [];
    let providerCalls = 0, sending = false, finishSend!: () => void;
    const saved = new Promise<void>((resolve) => { finishSend = resolve; });
    let releaseSend!: () => void;
    const heldSend = new Promise<void>((resolve) => { releaseSend = resolve; });
    const wait = async (condition: () => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 5000;
      while (true) {
        assert.ok(Date.now() < deadline, "mounted UI condition timed out");
        let ready = false;
        await act(async () => { ready = await condition(); if (!ready) await new Promise((resolve) => setTimeout(resolve, 10)); });
        if (ready) return;
      }
    };
    const input = () => dom.window.document.querySelector<HTMLTextAreaElement>("#chat-input")!;
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => element.getAttribute("aria-label") === label || element.textContent?.trim() === label)!;
    const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
    const type = async (text: string) => { await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
      input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    }); };
    try {
      browserFoundationStorage.load = async () => document;
      browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
      globalThis.fetch = async (_url, options) => {
        providerCalls++;
        if (providerCalls === 2) await new Promise<void>((resolve) => { pendingResponses.push(resolve); });
        if (providerCalls === 3) assert.match(String(options?.body), /Original|Tail/);
        return Response.json({ choices: [{ message: { content: providerCalls === 1 ? "Original\n\nTail" :
          providerCalls === 2 ? "Late stopped replacement" : "Continued" }, finish_reason: providerCalls === 1 ? "length" : "stop" }] });
      };
      const session = await chatStorage.openSession("a");
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "a" }))); });
      await wait(() => !!input() && !input().disabled);
      chatStorage.send = async (...args) => {
        const message = await send.apply(chatStorage, args); sending = true; finishSend(); await heldSend; return message;
      };
      await type("Draft before Stop"); await click(button("Request Reply")); await act(async () => { await saved; });
      assert.ok(sending); assert.ok(button("Stop reply"));
      await click(button("Stop reply"));
      // Observe the *whole* late Send continuation, not merely a pre-resolution latch.
      await act(async () => { releaseSend(); await new Promise<void>((resolve) => setImmediate(resolve)); });
      await wait(() => !button("Stop reply"));
      assert.equal(providerCalls, 0);
      await wait(() => !!button("Retry"));
      assert.equal((await chatStorage.readSession(session.id)).messages[0].content, "Draft before Stop");
      chatStorage.send = send;
      await click(button("Retry"));
      await wait(() => !!button("Continue conversation") && !button("Stop reply"));
      const originals = (await chatStorage.readSession(session.id)).messages.filter((m) => m.status === "complete");
      assert.equal(originals.length, 2);
      await wait(() => originals.every((m) => !!dom.window.document.querySelector(`[data-message-id="${m.id}"] .chat-bubble`)));
      for (const original of originals) {
        await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${original.id}"] .chat-bubble`)!);
        assert.equal(button("Regenerate").disabled, false);
        await click(button("Close message actions"));
      }
      await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${originals[0].id}"] .chat-bubble`)!);
      await click(button("Regenerate"));
      await wait(() => pendingResponses.length === 1);
      assert.deepEqual((await chatStorage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
      await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${originals[0].id}"] .chat-bubble`)!);
      assert.equal(button("Edit").disabled, true); assert.equal(button("Regenerate").disabled, true);
      assert.equal(button("Send").disabled, true);
      await click(button("Close message actions")); await click(button("Stop reply"));
      await wait(() => !button("Stop reply"));
      await act(async () => { pendingResponses.shift()!(); await new Promise<void>((resolve) => setImmediate(resolve)); });
      assert.deepEqual((await chatStorage.readSession(session.id)).messages.filter((m) => originals.some((o) => o.id === m.id)), originals);
      await click(button("Continue conversation"));
      await wait(async () => (await chatStorage.readSession(session.id)).messages.some((m) => m.content === "Continued"));
      await wait(() => !button("Stop reply") && !button("Continue conversation"));
      await type("Accepted"); await click(button("Send"));
      await wait(async () => (await chatStorage.readSession(session.id)).messages.at(-1)?.content === "Accepted");
      await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${originals[0].id}"] .chat-bubble`)!);
      assert.equal(button("Regenerate").disabled, true);
    } finally {
      releaseSend(); pendingResponses.forEach((resolve) => resolve());
      await act(async () => { root.unmount(); });
      chatStorage.send = send; browserFoundationStorage.load = load; browserApiConfigStorage.getApiConfig = api;
      globalThis.fetch = fetch; dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
