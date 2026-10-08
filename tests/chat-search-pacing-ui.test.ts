import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { BubbleRevealQueue } from "../lib/chat/bubble-pacing";
import { regressionContract } from "./regression-contract";
import { TEST_API_CONFIG } from "./chat-engine-fixture";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.search-jump-reveals-only-target", "async-race-safety",
  "a search jump keeps a paced target visible while every other reply bubble follows the existing reveal order", async () => {
    const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
      url: "http://localhost/messages/a", pretendToBeVisual: true,
    });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement",
      "HTMLInputElement", "localStorage"] as const) install(name, dom.window[name]);
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

    const snapshots: ReturnType<BubbleRevealQueue["getSnapshot"]>[] = [];
    const originalComplete = BubbleRevealQueue.prototype.complete;
    const originalReveal = BubbleRevealQueue.prototype.revealMessage;
    BubbleRevealQueue.prototype.complete = function (...args) {
      originalComplete.apply(this, args);
      snapshots.push(this.getSnapshot());
    };
    BubbleRevealQueue.prototype.revealMessage = function (id) {
      originalReveal.call(this, id);
      snapshots.push(this.getSnapshot());
    };
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { ChatRoom } = await import("../components/chat/chat-room");
    const { chatStorage } = await import("../lib/chat/storage");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const foundation = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    foundation.runtime.timeAware = false;
    const load = browserFoundationStorage.load, api = browserApiConfigStorage.getApiConfig;
    const fetch = globalThis.fetch;
    const root = createRoot(dom.window.document.getElementById("root")!);
    const wait = async (condition: () => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 8000;
      while (true) {
        assert.ok(Date.now() < deadline, "mounted search/pacing UI condition timed out");
        let ready = false;
        await act(async () => {
          ready = await condition();
          if (!ready) await new Promise((resolve) => setTimeout(resolve, 10));
        });
        if (ready) return;
      }
    };
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => element.getAttribute("aria-label") === label || element.textContent?.trim() === label);
    const click = async (element: HTMLElement | undefined) => {
      assert.ok(element, "expected control is present");
      await act(async () => { element.click(); });
    };
    const input = () => dom.window.document.querySelector<HTMLInputElement>(
      'input[aria-label="Search messages in this conversation"]');
    const node = (id: string) => dom.window.document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    try {
      browserFoundationStorage.load = async () => foundation;
      browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content:
        "First pacing bubble\n\nJump target phrase\n\nThird pacing bubble" }, finish_reason: "stop" }] });
      const session = await chatStorage.openSession("a");
      await chatStorage.updateBubbleTiming({ shortMs: 1500, mediumMs: 1500, longMs: 1500 });
      await chatStorage.send(session.id, "Question");
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "a" }))); });
      await wait(() => !!button("Request Reply"));
      await click(button("Request Reply"));
      await wait(async () => (await chatStorage.readSession(session.id)).messages
        .filter((message) => message.role === "assistant" && message.status === "complete").length === 3);
      await wait(() => snapshots.length > 0);

      const messages = (await chatStorage.readSession(session.id)).messages;
      const first = messages.find((message) => message.content === "First pacing bubble")!;
      const target = messages.find((message) => message.content === "Jump target phrase")!;
      const third = messages.find((message) => message.content === "Third pacing bubble")!;
      assert.ok(snapshots.at(-1)!.hiddenIds.has(target.id), "the target begins in the reveal queue's hiddenIds");
      assert.equal(node(target.id), null, "the paced Assistant target is initially hidden");

      await click(button("Conversation settings"));
      await click(button("Search Chat History"));
      await wait(() => !!input());
      await act(async () => {
        const field = input()!;
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(field, "Jump target phrase");
        field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await wait(() => !![...dom.window.document.querySelectorAll<HTMLButtonElement>(".chat-history-search-result")]
        .find((element) => element.textContent?.includes("Jump target phrase")));
      await click([...dom.window.document.querySelectorAll<HTMLButtonElement>(".chat-history-search-result")]
        .find((element) => element.textContent?.includes("Jump target phrase")));

      await wait(() => {
        const visibleTarget = node(target.id);
        return !!visibleTarget?.classList.contains("chat-turn-search-highlight")
          && !dom.window.document.querySelector('[aria-label="Search Chat History"]');
      });
      assert.ok(node(target.id)?.querySelector(".chat-bubble"), "the jumped target remains mounted after the next render");
      assert.equal(snapshots.at(-1)!.hiddenIds.has(target.id), false, "the jump removes only its target from hiddenIds");
      assert.equal(snapshots.at(-1)!.hiddenIds.has(first.id), true, "the earlier message remains paced");
      assert.equal(snapshots.at(-1)!.hiddenIds.has(third.id), true, "the later message remains paced");
      assert.equal(node(first.id), null, "an earlier bubble is still hidden immediately after the jump");
      assert.equal(node(third.id), null, "a later bubble is still hidden immediately after the jump");

      await wait(() => !!node(first.id));
      assert.ok(node(target.id), "the jumped target remains visible as the queue advances");
      assert.equal(node(third.id), null, "the later bubble remains hidden until its turn");
      await wait(() => !!node(third.id));
      assert.ok(node(target.id), "the jumped target remains visible after the remaining pacing completes");
    } finally {
      await act(async () => root.unmount());
      browserFoundationStorage.load = load;
      browserApiConfigStorage.getApiConfig = api;
      globalThis.fetch = fetch;
      BubbleRevealQueue.prototype.complete = originalComplete;
      BubbleRevealQueue.prototype.revealMessage = originalReveal;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    }
  });

