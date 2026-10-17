import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";

regressionContract("chat.photos-panel-lifecycle", "render-lifecycle",
  "Photos keeps the + panel up while the system picker is open and closes it when the picker is cancelled or a choice is made", async () => {
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
    const panel = () => container.querySelector(".chat-plus-panel");
    const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Choose photos"]')!;
    const openPlus = () => click(container.querySelector<HTMLElement>('button[aria-label="More message options"]')!);
    const photos = () => [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => /Photos/.test(item.textContent ?? ""))!;
    let pickerOpened = 0;
    dom.window.HTMLInputElement.prototype.click = function () { if (this.type === "file") pickerOpened++; };
    try {
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "peter" }))); });
      await waitFor(() => container.querySelectorAll(".chat-bubble-role-user").length === 1);
      assert.equal(panel(), null);

      await openPlus();
      assert.ok(panel(), "the + panel opens");
      await click(photos());
      assert.equal(pickerOpened, 1, "Photos opens the system picker");
      assert.ok(panel(), "the + panel stays up behind the system picker");

      // The picker is dismissed without a choice: iOS and Chrome fire `cancel` on the input.
      await act(async () => { input().dispatchEvent(new dom.window.Event("cancel")); });
      assert.equal(panel(), null, "cancelling the picker closes the panel");

      await openPlus();
      await click(photos());
      assert.ok(panel());
      await act(async () => { input().dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
      assert.equal(panel(), null, "finishing a choice closes the panel");
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
