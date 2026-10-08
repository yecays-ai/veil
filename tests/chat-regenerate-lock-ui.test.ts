import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";
import { TEST_API_CONFIG } from "./chat-engine-fixture";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.regenerate-lock-released-without-session", "async-race-safety",
  "a Regenerate that ends while the room has no session releases its locks, so Regenerate works when the session returns", async () => {
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
    const { chatEngine } = await import("../lib/chat/engine");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    document.runtime.timeAware = false;
    const load = browserFoundationStorage.load, api = browserApiConfigStorage.getApiConfig;
    const send = chatStorage.send, fetch = globalThis.fetch;
    const root = createRoot(dom.window.document.getElementById("root")!);
    const pendingResponses: Array<() => void> = [];
    let providerCalls = 0;
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
      const full = document, without = normalizeFoundation({ characters: [{ characterId: "b", name: "B" }] });
      let current = full; browserFoundationStorage.load = async () => current;
      browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
      globalThis.fetch = async () => {
        providerCalls++;
        if (providerCalls === 2) await new Promise<void>((resolve) => { pendingResponses.push(resolve); });
        return Response.json({ choices: [{ message: { content: providerCalls === 1 ? "First answer" : providerCalls === 2 ? "Late" : "Replacement" }, finish_reason: "stop" }] });
      };
      const session = await chatStorage.openSession("a");
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "a" }))); });
      await wait(() => !!input() && !input().disabled);
      await type("Question"); await click(button("Request Reply"));
      await wait(async () => (await chatStorage.readSession(session.id)).messages.some((m) => m.content === "First answer" && m.status === "complete"));
      await wait(() => !button("Stop reply"));
      const reply = (await chatStorage.readSession(session.id)).messages.find((m) => m.content === "First answer")!;
      await wait(() => !!dom.window.document.querySelector(`[data-message-id="${reply.id}"] .chat-bubble`));
      const openActions = () => click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${reply.id}"] .chat-bubble`)!);
      await openActions(); await click(button("Regenerate"));
      await wait(() => pendingResponses.length === 1);
      // The room's Character vanishes from a Foundation refresh while Regenerate is in flight.
      current = without; await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
      await wait(() => !chatEngine.isGenerating(session.id));
      await wait(() => !input() || input().disabled || !button("Stop reply"));
      // The Character returns; the session is the same one and characterId never changed.
      current = full; await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
      await wait(() => !!input() && !input().disabled);
      await act(async () => { pendingResponses.shift()?.(); await new Promise<void>((resolve) => setImmediate(resolve)); });
      await wait(() => !button("Stop reply"));
      await wait(() => !!dom.window.document.querySelector(`[data-message-id="${reply.id}"] .chat-bubble`)
        || !!dom.window.document.querySelector("[data-message-id]"));
      const target = (await chatStorage.readSession(session.id)).messages.filter((m) => m.role === "assistant").at(-1)!;
      await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${target.id}"] .chat-bubble`)!);
      const regenerate = button("Regenerate");
      assert.ok(regenerate, "message actions open");
      assert.equal(regenerate.disabled, false, "a Regenerate that ended while the room had no session must not leave the lock set");
      assert.equal(button("Stop reply"), undefined, "the room is not stuck in a generating state");
    } finally {
      pendingResponses.forEach((resolve) => resolve());
      await act(async () => { root.unmount(); });
      chatStorage.send = send; browserFoundationStorage.load = load; browserApiConfigStorage.getApiConfig = api;
      globalThis.fetch = fetch; dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
