import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";

regressionContract("chat.multi-select-bar-actions", "render-lifecycle",
  "the multi-select bar reports the selection and its four buttons drive ChatRoom's selection, delete confirmation and exit", async () => {
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
    await chatStorage.send(session.id, "First message.");
    await chatStorage.send(session.id, "Second message.");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const waitFor = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        assert.ok(Date.now() < deadline, "ChatRoom did not reach the expected mounted state");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    const click = async (target: Element) => act(async () => { (target as HTMLElement).click(); });
    const bar = () => container.querySelector<HTMLElement>(".chat-multi-select-bar");
    const barButton = (label: string) => {
      const found = [...bar()!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label);
      assert.ok(found, `the bar has a "${label}" button`);
      return found;
    };
    const selectedText = () => bar()?.querySelector("span")?.textContent;
    try {
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "peter" }))); });
      await waitFor(() => container.querySelectorAll(".chat-bubble-role-user").length === 2);
      assert.equal(bar() === null, true, "no bar outside multi-select");

      // Start the selection on the second message so "from here to latest" differs from "all".
      await click(container.querySelectorAll(".chat-bubble-role-user")[1]);
      await waitFor(() => !!container.querySelector('[role="menu"]'));
      const select = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === "Select");
      assert.ok(select);
      await click(select);
      await waitFor(() => !!bar());
      assert.equal(selectedText(), "1 selected");
      assert.deepEqual([...bar()!.querySelectorAll("button")].map((button) => button.textContent?.trim()),
        ["Select all", "Select from here to latest", "Delete selected", "Cancel"]);
      assert.equal(barButton("Select from here to latest").disabled, false);
      assert.equal(barButton("Delete selected").disabled, false);

      await click(barButton("Select from here to latest"));
      assert.equal(selectedText(), "1 selected", "from the second message to the latest is only the second message");
      await click(barButton("Select all"));
      assert.equal(selectedText(), "2 selected");

      // Toggling the selected messages off disables Delete.
      const turns = container.querySelectorAll(".chat-turn-user");
      await click(turns[0]);
      await click(turns[1]);
      assert.equal(selectedText(), "0 selected");
      assert.equal(barButton("Delete selected").disabled, true);

      await click(barButton("Select all"));
      await click(barButton("Delete selected"));
      const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
      assert.ok(dialog, "Delete selected opens the confirmation dialog");
      assert.match(dialog.textContent ?? "", /Delete 2 messages from this conversation\?/);
      await click(dialog.querySelectorAll<HTMLButtonElement>("button")[0]!);
      assert.equal(container.querySelector('[role="alertdialog"]') === null, true, "Cancel closes the confirmation");
      assert.equal((await chatStorage.readSession(session.id)).messages.length, 2, "cancelling deletes nothing");
      assert.equal(bar() !== null, true, "cancelling the confirmation keeps the selection mode");

      await click(barButton("Cancel"));
      assert.equal(bar() === null, true, "Cancel leaves multi-select");
      assert.equal(container.querySelector(".chat-turn-selected") === null, true, "Cancel clears the selection");
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
