import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, useState, type ReactElement } from "react";
import { browserFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import { chatLoadingNotice } from "../lib/chat/loading-notice";
import { ChatStorage } from "../lib/chat/storage";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import { regressionContract } from "./regression-contract";

regressionContract("chat.route-keeps-identity-boundary", "render-lifecycle",
  "direct chat has no full-page fallback and still awaits and keys the current route identity", () => {
  assert.equal(existsSync("app/messages/[characterId]/loading.tsx"), false);
  assert.equal(existsSync("app/messages/loading.tsx"), false);
  const page = readFileSync("app/messages/[characterId]/page.tsx", "utf8");
  assert.match(page, /await params/);
  assert.match(page, /<ChatRoom key=\{characterId\} characterId=\{characterId\}/);
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const pending = room.slice(room.indexOf("if (!ready || !character)"), room.indexOf("const pending ="));
  assert.doesNotMatch(pending, /contactName|ChatAvatar|session\?|groupedMessages/);
  for (const key of ["header", "history", "composer"])
    assert.equal(room.split(`key="${key}"`).length - 1, 2, `${key} retains its anchor during identity hydration`);
  for (const ref of ["shell", "history", "composerBar", "composer"])
    assert.match(pending, new RegExp(`ref=\\{${ref}\\}`));
  assert.match(pending, /<textarea[^>]*[\s\S]*?disabled placeholder="Message…"/);
  assert.match(room, /aria-busy=\{!session && !loadError\}/);
});

regressionContract("chat.first-paint-notice", "render-lifecycle",
  "warm validated identity paints without a loading notice; cold absence, invalid identity and failure stay explicit", () => {
  assert.equal(chatLoadingNotice(false, false, ""), "Loading Character…");
  assert.equal(chatLoadingNotice(false, true, ""), "Loading Character…", "default data is not validated identity");
  assert.equal(chatLoadingNotice(true, false, ""), "This Character is no longer available.");
  assert.equal(chatLoadingNotice(true, true, ""), undefined);
  assert.equal(chatLoadingNotice(true, true, "failed"), "Conversation unavailable.");
});

regressionContract("chat.first-paint-remount-budget", "subscription-hygiene",
  "warm navigation presentation adds no hydration or subscriptions and never publishes the previous character", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  for (const id of ["peter", "pep"]) {
    const session = await storage.openSession(id);
    await storage.send(session.id, id);
  }
  const counts = { opens: 0, reads: 0, existing: 0, active: 0, subscriptions: 0 };
  const adapter = {
    openSession: (id: string) => { counts.opens++; return storage.openSession(id); },
    readSession: (id: string) => { counts.reads++; return storage.readSession(id); },
    readExistingSession: (id: string) => { counts.existing++; return storage.readExistingSession(id); },
    subscribe: (listener: Parameters<ChatStorage["subscribe"]>[0]) => {
      counts.subscriptions++; counts.active++;
      const unsubscribe = storage.subscribe(listener);
      return () => { counts.active--; unsubscribe(); };
    },
  };
  for (const id of ["peter", "pep", "peter"]) {
    let publish!: () => void;
    let reject!: (reason: unknown) => void;
    let timeout!: ReturnType<typeof setTimeout>;
    const loaded = new Promise<void>((resolve, fail) => {
      publish = resolve;
      reject = fail;
      timeout = setTimeout(() => fail(new Error(`No expected snapshot for ${id} within 2s`)), 2000);
    });
    const owner = createChatSessionLifecycle(id, adapter, (snapshot, error) => {
      if (error) { reject(new Error(error)); return; }
      if (!snapshot) return;
      try {
        assert.equal(snapshot.session.characterId, id);
        assert.deepEqual(snapshot.messages.map((message) => message.content), [id]);
        publish();
      } catch (reason) { reject(reason); }
    }, () => {});
    try {
      assert.equal(chatLoadingNotice(true, true, ""), undefined);
      owner.mount(true);
      owner.setEnabled(true);
      await loaded;
      for (let render = 0; render < 5; render++)
        assert.equal(chatLoadingNotice(true, true, ""), undefined);
      assert.equal(counts.active, 1);
    } finally {
      clearTimeout(timeout);
      owner.unmount();
    }
    assert.equal(counts.active, 0);
  }
  assert.deepEqual(counts, { opens: 3, reads: 3, existing: 0, active: 0, subscriptions: 3 });
});

regressionContract("chat.mounted-character-navigation", "render-lifecycle",
  "mounted direct-chat navigation keeps destination history and disabled composer visible until its session resolves", async () => {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
    url: "http://localhost/messages/peter", pretendToBeVisual: true,
  });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
    install(name, dom.window[name]);
  install("self", dom.window);
  const indexedDB = new IDBFactory();
  install("indexedDB", indexedDB);
  Object.defineProperty(dom.window, "indexedDB", { value: indexedDB });
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("IS_REACT_ACT_ENVIRONMENT", true);
  // This single-tab DOM fixture has no peer tab; Node's native channel keeps the worker alive.
  install("BroadcastChannel", undefined);
  dom.window.HTMLElement.prototype.scrollTo = () => {};

  // Import after DOM setup so ReactDOM and Next Link detect a mounted client environment.
  const { createRoot } = await import("react-dom/client");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { default: DirectChatPage } = await import("../app/messages/[characterId]/page");
  const { chatStorage } = await import("../lib/chat/storage");
  const foundation = normalizeFoundation({ characters: [
    { characterId: "peter", name: "Peter" }, { characterId: "pep", name: "Pep" },
  ] });
  const originalLoad = browserFoundationStorage.load;
  const originalRead = chatStorage.readSession;
  let releaseDestination!: () => void;
  const destinationPending = new Promise<void>((resolve) => { releaseDestination = resolve; });
  let destinationReads = 0;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    browserFoundationStorage.load = async () => foundation;
    for (const id of ["peter", "pep"]) {
      const session = await chatStorage.openSession(id);
      await chatStorage.send(session.id, `${id} history`);
    }
    const destination = await chatStorage.openSession("pep");
    chatStorage.readSession = async (id) => {
      if (id === destination.id) { destinationReads++; await destinationPending; }
      return originalRead.call(chatStorage, id);
    };
    const initial = await DirectChatPage({ params: Promise.resolve({ characterId: "peter" }) });
    function Navigation() {
      const [page, setPage] = useState<ReactElement>(initial);
      return createElement(FoundationProvider, null,
        createElement("button", { onClick: async () => {
          const next = await DirectChatPage({ params: Promise.resolve({ characterId: "pep" }) });
          setPage(next);
        } }, "Navigate to Pep"), page);
    }
    const waitFor = async (check: () => boolean) => {
      const deadline = Date.now() + 2000;
      while (!check()) {
        assert.ok(Date.now() < deadline, "mounted chat did not reach its expected state within 2s");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    await act(async () => { root.render(createElement(Navigation)); });
    await waitFor(() => container.textContent?.includes("peter history") === true);
    const composer = () => container.querySelector<HTMLTextAreaElement>("#chat-input")!;
    assert.equal(composer().disabled, false);

    await act(async () => { container.querySelector("button")!.click(); });
    await waitFor(() => destinationReads === 1);
    assert.equal(container.querySelector(".chat-contact-summary strong")?.textContent, "Pep");
    assert.ok(container.querySelector(".chat-room .chat-header"));
    const history = container.querySelector<HTMLElement>('[aria-label="Conversation history"]')!;
    assert.ok(history.classList.contains("chat-history"));
    assert.equal(history.hidden, false);
    assert.notEqual(dom.window.getComputedStyle(history).display, "none");
    assert.notEqual(dom.window.getComputedStyle(history).visibility, "hidden");
    assert.equal(history.getAttribute("aria-busy"), "true");
    assert.equal(composer().disabled, true);
    assert.ok(container.querySelector(".chat-composer"));
    assert.doesNotMatch(container.textContent ?? "", /peter history|pep history|Loading/);

    await act(async () => { releaseDestination(); });
    await waitFor(() => container.textContent?.includes("pep history") === true);
    assert.equal(container.querySelector('[aria-label="Conversation history"]'), history);
    assert.equal(history.getAttribute("aria-busy"), "false");
    assert.equal(composer().disabled, false);
    assert.doesNotMatch(container.textContent ?? "", /peter history/);
    assert.equal(destinationReads, 1);
  } finally {
    releaseDestination();
    await act(async () => { root.unmount(); });
    chatStorage.readSession = originalRead;
    browserFoundationStorage.load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
