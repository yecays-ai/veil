import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { regressionContract } from "./regression-contract";

regressionContract("chat.overlay-focus-boundary", "render-lifecycle",
  "Chat Info, message actions, and confirmation dialogs contain keyboard focus and restore it safely", async () => {
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
    };
    browserFoundationStorage.load = async () => normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }] });
    browserContactStorage.load = async () => ({ version: 1, contacts: [] }) as never;
    browserBindingStorage.load = async () => ({ global: {}, characters: {} }) as never;
    browserRegexStorage.load = async () => ({ groups: [] }) as never;
    const session = await chatStorage.openSession("peter");
    await chatStorage.send(session.id, "Keep this message until confirmation.");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const waitFor = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        assert.ok(Date.now() < deadline, "ChatRoom did not reach the expected mounted state");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    const press = async (target: HTMLElement, key: string, shiftKey = false) => {
      await act(async () => { target.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key, shiftKey, bubbles: true, cancelable: true,
      })); });
    };
    const click = async (target: HTMLElement) => act(async () => { target.click(); });
    const openMessageActions = async () => {
      const bubble = container.querySelector<HTMLElement>(".chat-bubble-role-user");
      assert.ok(bubble);
      await click(bubble);
      await waitFor(() => !!container.querySelector('[role="menu"]'));
      return container.querySelector<HTMLElement>('[role="menu"]')!;
    };
    try {
      await act(async () => { root.render(createElement(StrictMode, null,
        createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "peter" })))); });
      await waitFor(() => !!container.querySelector(".chat-bubble-role-user"));

      const composer = container.querySelector<HTMLTextAreaElement>("#chat-input")!;
      const settings = container.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]')!;
      composer.focus();
      assert.equal(dom.window.document.activeElement === composer, true);
      settings.focus(); // Native button activation transfers focus before React opens Chat Info.
      await click(settings);
      await waitFor(() => !!container.querySelector('[aria-label="Chat Info"]'));
      const info = container.querySelector<HTMLElement>('[aria-label="Chat Info"]')!;
      const back = info.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!;
      assert.equal(dom.window.document.activeElement === back, true, "opening Chat Info moves focus off the composer");
      assert.equal(composer.form?.hasAttribute("inert"), true, "the obscured composer is inert");
      await click(info.querySelector<HTMLButtonElement>(".chat-info-row")!);
      await waitFor(() => !!container.querySelector('[aria-label="Search Chat History"]'));
      const searchBack = container.querySelector<HTMLButtonElement>('[aria-label="Back to Chat Info"]')!;
      assert.equal(dom.window.document.activeElement === searchBack, true,
        "Chat Info subpage switches transfer focus into the current page");
      await click(searchBack);
      await waitFor(() => !!container.querySelector('[aria-label="Chat Info"]'));
      const currentInfo = container.querySelector<HTMLElement>('[aria-label="Chat Info"]')!;
      const currentBack = currentInfo.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!;
      const infoFocusables = [...currentInfo.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )];
      await press(currentBack, "Tab", true);
      assert.equal(dom.window.document.activeElement === infoFocusables.at(-1), true, "Shift+Tab wraps inside Chat Info");
      await press(infoFocusables.at(-1)!, "Tab");
      assert.equal(dom.window.document.activeElement === currentBack, true, "Tab wraps inside Chat Info");
      await click(currentInfo.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!);
      assert.equal(dom.window.document.activeElement === settings, true, "closing Chat Info restores its trigger");

      await click(settings);
      const clearButton = container.querySelector<HTMLButtonElement>(".chat-info-clear")!;
      clearButton.focus();
      await click(clearButton);
      const clearDialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
      assert.ok(clearDialog, "Clear Chat History opens its own confirmation");
      const clearCancel = clearDialog.querySelector<HTMLButtonElement>("button")!;
      assert.equal(dom.window.document.activeElement === clearCancel, true, "clear confirmation receives focus");
      await press(clearCancel, "Escape");
      assert.equal(container.querySelector('[role="alertdialog"]'), null, "Escape cancels clear confirmation");
      assert.equal(dom.window.document.activeElement === clearButton, true,
        "closing a confirmation restores focus to its still-open Chat Info trigger");
      await click(info.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!);

      const menu = await openMessageActions();
      const menuItems = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
      assert.ok(menuItems.length > 1);
      assert.equal(dom.window.document.activeElement === menuItems[0], true, "message menu receives focus");
      assert.equal(composer.form?.hasAttribute("inert"), true, "chat controls are inert while the message menu is open");
      await press(menuItems[0], "Tab", true);
      assert.equal(dom.window.document.activeElement === menuItems.at(-1), true, "Shift+Tab stays in the message menu");
      await press(menuItems.at(-1)!, "Tab");
      assert.equal(dom.window.document.activeElement === menuItems[0], true, "Tab wraps in the message menu");
      await press(menuItems[0], "Escape");
      assert.equal(container.querySelector('[role="menu"]'), null, "Escape closes the message menu");
      assert.equal(dom.window.document.activeElement === settings, true, "closing the menu uses a connected safe focus target");

      const deleteMenu = await openMessageActions();
      const deleteAction = [...deleteMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Delete"));
      assert.ok(deleteAction);
      await click(deleteAction);
      const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
      assert.ok(dialog, "Delete opens its confirmation dialog");
      const cancel = dialog.querySelector<HTMLButtonElement>("button")!;
      const confirm = dialog.querySelectorAll<HTMLButtonElement>("button")[1]!;
      assert.equal(dom.window.document.activeElement === cancel, true, "confirmation starts on safe Cancel");
      assert.equal(container.querySelector(".chat-header")?.hasAttribute("inert"), true,
        "the chat header is inert behind confirmation");
      await press(cancel, "Tab");
      assert.equal(dom.window.document.activeElement === confirm, true, "Tab moves within confirmation");
      await press(confirm, "Tab");
      assert.equal(dom.window.document.activeElement === cancel, true, "Tab cannot escape confirmation");
      await press(cancel, "Escape");
      assert.equal(container.querySelector('[role="alertdialog"]'), null, "Escape cancels confirmation");
      assert.equal((await chatStorage.readSession(session.id))?.messages.some((message) => message.content.includes("Keep this message")),
        true, "Escape never deletes the message");
      assert.equal(dom.window.document.activeElement === settings, true,
        "a dialog opened from a menu restores to a safe connected control after its menu item disappears");

      const nextMenu = await openMessageActions();
      const deleteActionAgain = [...nextMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Delete"));
      assert.ok(deleteActionAgain);
      await click(deleteActionAgain);
      const nextDialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
      await click(nextDialog.querySelectorAll<HTMLButtonElement>("button")[1]!);
      await waitFor(() => !container.querySelector('[role="alertdialog"]'));
      assert.equal((await chatStorage.readSession(session.id)).messages.some((message) => message.content.includes("Keep this message")),
        false, "explicit confirmation still deletes the selected message");

      await click(settings);
      const detachedTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]')!;
      detachedTrigger.remove();
      await click(container.querySelector<HTMLButtonElement>('[aria-label="Back to conversation"]')!);
      assert.equal(dom.window.document.activeElement === composer, true,
        "when the original trigger has been removed, focus falls back to the composer");
    } finally {
      await act(async () => root.unmount());
      browserFoundationStorage.load = originals.foundation;
      browserContactStorage.load = originals.contacts;
      browserBindingStorage.load = originals.bindings;
      browserRegexStorage.load = originals.regex;
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      dom.window.close();
    }
  });

