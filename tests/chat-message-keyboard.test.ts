import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { regressionContract } from "./regression-contract";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.message-actions-keyboard-entry", "render-lifecycle",
  "message buttons support keyboard actions without changing pointer, selection or restricted-state behavior", async () => {
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
    const entry = (id: string) => {
      const target = row(id)?.querySelector<HTMLButtonElement>(".chat-message-actions-trigger");
      assert.ok(target, "a message action entry is available");
      return target;
    };
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
      const settings = container.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]')!;
      const firstEntry = entry(first.id);
      const secondEntry = entry(second.id);
      assert.notEqual(firstEntry.getAttribute("aria-label"), secondEntry.getAttribute("aria-label"));
      assert.equal(firstEntry.getAttribute("aria-label"), `Message actions for message ${first.order} from You`);
      assert.equal(secondEntry.getAttribute("aria-label"), `Message actions for message ${second.order} from You`);
      assert.equal(dom.window.document.getElementById(firstEntry.getAttribute("aria-describedby")!)?.textContent, first.content);
      assert.equal(dom.window.document.getElementById(secondEntry.getAttribute("aria-describedby")!)?.textContent, second.content);
      assert.equal(firstEntry.getAttribute("aria-haspopup"), "menu");

      settings.focus();
      await press(settings, "Tab");
      assert.equal(dom.window.document.activeElement === firstEntry, true, "Tab reaches the first message entry");
      await press(firstEntry, "Tab");
      assert.equal(dom.window.document.activeElement === secondEntry, true, "Tab reaches the next message entry");
      await press(secondEntry, "Tab", true);
      assert.equal(dom.window.document.activeElement === firstEntry, true, "Shift+Tab returns to the previous entry");

      await press(firstEntry, "Enter");
      assert.ok(menu(), "Enter opens the existing menu");
      assert.ok(row(first.id).hasAttribute("data-active"));
      assert.equal(dom.window.document.activeElement === item("Copy"), true, "F3 focuses the first menu item");
      await press(item("Copy"), "Tab", true);
      assert.ok(menu()!.contains(dom.window.document.activeElement), "menu Tab navigation stays in the overlay");
      await press(item("Copy"), "Enter");
      assert.equal(copied, first.content, "keyboard Copy acts on the first message");
      assert.equal(dom.window.document.activeElement === firstEntry, true, "Copy closes and restores the opener");

      secondEntry.focus();
      const history = container.querySelector<HTMLElement>(".chat-history")!;
      history.scrollTop = 123;
      const space = await press(secondEntry, " ");
      assert.equal(space.defaultPrevented, true, "Space is consumed instead of scrolling");
      assert.equal(history.scrollTop, 123);
      assert.ok(row(second.id).hasAttribute("data-active"));
      assert.equal(dom.window.document.activeElement === item("Copy"), true, "Space focuses Copy");
      await press(item("Copy"), "Enter");
      assert.equal(copied, second.content, "Space opens actions for the correct second message");
      assert.equal(dom.window.document.activeElement === secondEntry, true, "Space Copy restores its opener");

      await press(secondEntry, "Enter");
      await closeMenu();
      assert.equal(dom.window.document.activeElement === secondEntry, true, "Escape restores the keyboard opener");
      await press(secondEntry, "Enter");
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Close message actions"]')!);
      assert.equal(dom.window.document.activeElement === secondEntry, true, "backdrop close restores the opener");

      const firstBubble = row(first.id).querySelector<HTMLElement>(".chat-bubble")!;
      assert.equal(firstBubble.tagName, "P", "selectable message text retains paragraph semantics");
      await click(firstBubble);
      assert.ok(row(first.id).hasAttribute("data-active"), "ordinary bubble click still opens actions");
      await closeMenu();
      await touchDown(firstBubble);
      await click(firstBubble);
      assert.ok(menu(), "a touch tap still opens actions");
      await closeMenu();

      const selection = dom.window.getSelection()!;
      firstEntry.focus();
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
      await press(firstEntry, "Enter");
      assert.equal(menu() === null, true, "text selection blocks pointer and keyboard menu activation");
      assert.equal(selection.toString(), first.content, "selected text remains selected");
      selection.removeAllRanges();
      await act(async () => { dom.window.document.dispatchEvent(new dom.window.Event("selectionchange")); });
      await press(firstEntry, "Enter");
      await press(item("Quote"), "Enter");
      assert.match(container.querySelector(".chat-quote-bar")!.textContent!, /First keyboard message/,
        "keyboard Quote preserves the existing quote flow");
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Cancel Quote"]')!);

      firstEntry.focus();
      await press(firstEntry, "Enter");
      await press(item("Select"), "Enter");
      assert.equal(container.querySelector(".chat-message-actions-trigger") === null, true, "multi-select omits menu entries");
      await click(row(second.id).querySelector<HTMLElement>(".chat-bubble")!);
      await press(row(second.id).querySelector<HTMLElement>(".chat-bubble")!, "Enter");
      assert.equal(menu() === null, true, "multi-select bubble activation cannot open actions");
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
      assert.equal(row(streamingId).querySelector(".chat-message-actions-trigger") === null, true, "streaming has no action entry");
      const streamBubble = row(streamingId).querySelector<HTMLElement>(".chat-bubble")!;
      await click(streamBubble);
      await press(streamBubble, "Enter");
      await press(streamBubble, " ");
      assert.equal(menu() === null, true, "streaming pointer and keyboard activation cannot open a menu");
      entry(first.id).focus();
      await press(entry(first.id), "Enter");
      assert.equal(item("Edit").disabled, true, "existing generation-time action restrictions remain");
      await closeMenu();
      await act(async () => { await chatStorage.updateReply(streamingId, { content: "Finished reply", status: "complete" }); });
      await waitFor(() => !!row(streamingId).querySelector(".chat-message-actions-trigger"));

      const disappearingEntry = entry(second.id);
      disappearingEntry.focus();
      await press(disappearingEntry, "Enter");
      await act(async () => { await chatStorage.deleteMessages(session.id, [second.id]); });
      await waitFor(() => !row(second.id));
      await closeMenu();
      assert.equal(dom.window.document.activeElement === settings, true, "removed entry uses F3's connected fallback");
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
