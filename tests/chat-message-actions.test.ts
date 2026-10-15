import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { regressionContract } from "./regression-contract";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.message-actions-bubble-only", "render-lifecycle",
  "tapping a message bubble opens its actions without a separate button, keeping selection, multi-select and restricted-state behavior", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/messages/peter", pretendToBeVisual: true });
    const saved = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Event",
      "MouseEvent", "KeyboardEvent", "localStorage"] as const) install(name, dom.window[name]);
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
    Object.defineProperty(dom.window.navigator, "locks", { value: lockOrigin().client() });
    let copied = "";
    Object.defineProperty(dom.window.navigator, "clipboard", { value: {
      writeText: async (text: string) => { copied = text; },
    } });
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
      foundation: browserFoundationStorage.load, contacts: browserContactStorage.load,
      bindings: browserBindingStorage.load, regex: browserRegexStorage.load,
    };
    browserFoundationStorage.load = async () => normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }] });
    browserContactStorage.load = async () => ({ version: 1, contacts: [] }) as never;
    browserBindingStorage.load = async () => ({ global: {}, characters: {} }) as never;
    browserRegexStorage.load = async () => ({ groups: [] }) as never;
    const session = await chatStorage.openSession("peter");
    const first = await chatStorage.send(session.id, "First keyboard message");
    const second = await chatStorage.send(session.id, "Second keyboard message");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const waitFor = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        assert.ok(Date.now() < deadline, "ChatRoom did not reach the expected state");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    const row = (id: string) => container.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
    const menu = () => container.querySelector<HTMLElement>('[role="menu"]');
    const item = (label: string) => {
      const target = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === label);
      assert.ok(target, `${label} action exists`);
      return target;
    };
    const click = async (target: HTMLElement) => act(async () => { target.click(); });
    const press = async (target: HTMLElement, key: string, shiftKey = false) => {
      const down = new dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
      await act(async () => {
        target.dispatchEvent(down);
        target.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key, shiftKey, bubbles: true, cancelable: true }));
        // JSDOM lacks browser default Tab and button activation. Model those defaults
        // only when the mounted component has not consumed the actual keyboard event.
        if (!down.defaultPrevented && key === "Tab") {
          const stops = [...dom.window.document.querySelectorAll<HTMLElement>(
            "button, a[href], input, textarea, select, [tabindex]",
          )].filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") &&
            !element.closest("[inert], [hidden]"));
          const index = stops.indexOf(target);
          stops[(index + (shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        } else if (!down.defaultPrevented && (key === "Enter" || key === " ") &&
          target instanceof dom.window.HTMLButtonElement && !target.disabled) target.click();
      });
      return down;
    };
    const touchDown = async (target: HTMLElement) => {
      const event = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      await act(async () => { target.dispatchEvent(event); });
    };
    const closeMenu = async () => { await press(item("Copy"), "Escape"); assert.equal(menu() === null, true); };
    try {
      await act(async () => { root.render(createElement(StrictMode, null,
        createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "peter" })))); });
      await waitFor(() => !!row(first.id));
      assert.equal(container.querySelector(".chat-message-actions-trigger"), null, "no separate message action button is rendered");
      assert.equal(container.querySelector('.chat-message button[aria-haspopup="menu"]'), null, "messages carry no menu button");

      const firstBubble = row(first.id).querySelector<HTMLElement>(".chat-bubble")!;
      assert.equal(firstBubble.tagName, "P", "selectable message text retains paragraph semantics");
      await click(firstBubble);
      assert.ok(row(first.id).hasAttribute("data-active"), "ordinary bubble click still opens actions");
      await press(item("Copy"), "Enter");
      assert.equal(copied, first.content, "Copy acts on the tapped message");
      await click(firstBubble);
      await closeMenu();
      await touchDown(firstBubble);
      await click(firstBubble);
      assert.ok(menu(), "a touch tap still opens actions");
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Close message actions"]')!);
      assert.equal(menu() === null, true, "backdrop closes the menu");

      const selection = dom.window.getSelection()!;
      const range = dom.window.document.createRange();
      range.selectNodeContents(firstBubble);
      selection.removeAllRanges();
      selection.addRange(range);
      await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event("selectionchange")); });
      const context = new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      await act(async () => { firstBubble.dispatchEvent(context); });
      assert.equal(context.defaultPrevented, false, "native context menu remains available");
      await touchDown(firstBubble);
      await click(firstBubble);
      assert.equal(menu() === null, true, "text selection blocks menu activation");
      assert.equal(selection.toString(), first.content, "selected text remains selected");
      selection.removeAllRanges();
      await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event("selectionchange")); });
      await click(firstBubble);
      await press(item("Quote"), "Enter");
      assert.match(container.querySelector(".chat-quote-bar")!.textContent!, /First keyboard message/,
        "Quote preserves the existing quote flow");
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Cancel Quote"]')!);

      await click(firstBubble);
      await press(item("Select"), "Enter");
      await click(row(second.id).querySelector<HTMLElement>(".chat-bubble")!);
      assert.equal(menu() === null, true, "multi-select bubble tap cannot open actions");
      assert.ok(row(second.id).classList.contains("chat-turn-selected"), "multi-select still selects the tapped message");
      await click([...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!);

      let streamingId = "";
      await act(async () => {
        await chatStorage.updateSessionSettings(session.id, { streamOnline: true });
        const batch = await chatStorage.beginReply(session.id);
        assert.ok(batch);
        streamingId = batch.assistant.id;
        await chatStorage.updateReply(streamingId, { content: "Streaming reply", status: "streaming" });
      });
      await waitFor(() => !!row(streamingId));
      await click(row(streamingId).querySelector<HTMLElement>(".chat-bubble")!);
      assert.equal(menu() === null, true, "a streaming message cannot open a menu");
      await click(firstBubble);
      assert.equal(item("Edit").disabled, true, "existing generation-time action restrictions remain");
      assert.equal([...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .some((button) => button.textContent === "Recall"), false, "Recall is unavailable during generation");
      await closeMenu();
      await act(async () => { await chatStorage.updateReply(streamingId, { content: "Finished reply", status: "complete" }); });

      const recallDescriptor = Object.getOwnPropertyDescriptor(chatStorage, "recallMessage");
      Object.defineProperty(chatStorage, "recallMessage", { configurable: true, writable: true,
        value: async () => { throw new Error("Recall failed in test"); } });
      try {
        await click(firstBubble);
        await press(item("Recall"), "Enter");
        await waitFor(() => container.querySelector('[role="alert"]')?.textContent?.includes("Recall failed in test") === true);
      } finally {
        if (recallDescriptor) Object.defineProperty(chatStorage, "recallMessage", recallDescriptor);
        else Reflect.deleteProperty(chatStorage, "recallMessage");
      }
      await click(firstBubble);
      await press(item("Recall"), "Enter");
      await waitFor(() => row(first.id).textContent?.includes("You recalled a message.") === true);
      assert.equal(row(first.id).textContent?.includes(first.content), false, "successful Recall removes the original text");

      await click(row(second.id).querySelector<HTMLElement>(".chat-bubble")!);
      assert.ok(menu(), "the menu opens again once the reply finished");
      await act(async () => { await chatStorage.deleteMessages(session.id, [second.id]); });
      await waitFor(() => !row(second.id));
      await closeMenu();
      assert.equal(container.querySelector(".chat-message-actions-trigger"), null, "still no separate message action button");
    } finally {
      await act(async () => root.unmount());
      browserFoundationStorage.load = originals.foundation;
      browserContactStorage.load = originals.contacts;
      browserBindingStorage.load = originals.bindings;
      browserRegexStorage.load = originals.regex;
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
