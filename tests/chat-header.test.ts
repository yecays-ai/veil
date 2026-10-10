import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";

regressionContract("chat.header-keeps-identity", "render-lifecycle",
  "the loading header becomes the loaded header in place, and exposes Conversation settings and Contact Info", async () => {
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
    let releaseFoundation!: () => void;
    const foundationGate = new Promise<void>((resolve) => { releaseFoundation = resolve; });
    browserFoundationStorage.load = async () => {
      await foundationGate;
      return normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }] });
    };
    browserContactStorage.load = async () => ({ version: 1, contacts: [] }) as never;
    browserBindingStorage.load = async () => ({ global: {}, characters: {} }) as never;
    browserRegexStorage.load = async () => ({ groups: [] }) as never;
    await chatStorage.openSession("peter");
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    try {
      await act(async () => { root.render(createElement(FoundationProvider, null,
        createElement(ChatRoom, { characterId: "peter" }))); });

      const loadingHeader = container.querySelector(".chat-room .chat-header");
      assert.ok(loadingHeader, "the loading room already renders its header");
      const loadingButton = loadingHeader.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]');
      assert.ok(loadingButton);
      assert.equal(loadingButton.disabled, true, "Conversation settings is disabled while loading");
      assert.equal(loadingHeader.querySelector(".chat-contact-summary")?.tagName, "STRONG");
      assert.equal(loadingHeader.querySelector(".chat-contact-summary")?.textContent, "Chat");
      assert.equal(loadingHeader.querySelector('a[aria-label="Back to Messages"]')?.getAttribute("href"), "/messages");

      releaseFoundation();
      const deadline = Date.now() + 5000;
      while (!container.querySelector('a[aria-label^="Open Contact Info"]')) {
        assert.ok(Date.now() < deadline, "ChatRoom did not publish the contact header");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }

      const header = container.querySelector(".chat-room .chat-header");
      assert.ok(header);
      assert.equal(header === loadingHeader, true, "the header element is updated in place, not remounted");
      assert.equal(header.isConnected, true);
      const contact = header.querySelector<HTMLAnchorElement>("a.chat-contact-summary.page-title");
      assert.ok(contact);
      assert.equal(contact.getAttribute("href"), "/contacts/peter?from=direct");
      assert.equal(contact.getAttribute("aria-label"), "Open Contact Info for Peter");
      assert.equal(contact.querySelector("strong")?.textContent, "Peter");
      const button = header.querySelector<HTMLButtonElement>('[aria-label="Conversation settings"]');
      assert.ok(button);
      assert.equal(button === loadingButton, true, "the settings button keeps its DOM node");
      assert.equal(button.disabled, false);
      assert.equal(button.title, "Conversation settings");
    } finally {
      releaseFoundation();
      await act(async () => { root.unmount(); });
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
