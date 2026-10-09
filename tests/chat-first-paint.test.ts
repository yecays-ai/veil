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
import { browserRegexStorage } from "../lib/regex-storage";
import { drainContinuation } from "./lifecycle-test-tools";
import { resetChatBackgroundCacheForTests } from "../lib/chat/background-cache";

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
  assert.match(room, /aria-busy=\{!framePublished\}/);
  assert.match(room, /framePublished && groupedMessages\.map/);
  assert.match(readFileSync("components/chat/use-chat-background.ts", "utf8"), /BACKGROUND_PREPARE_LIMIT_MS/);
    assert.match(room, /if \(!bindingsReady\) return/);
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
  const scrollCalls: ScrollToOptions[] = [];
  dom.window.HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions) { scrollCalls.push(options ?? {}); };

  // Import after DOM setup so ReactDOM and Next Link detect a mounted client environment.
  const { createRoot } = await import("react-dom/client");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { default: DirectChatPage } = await import("../app/messages/[characterId]/page");
  const { chatStorage } = await import("../lib/chat/storage");
  const foundation = normalizeFoundation({ characters: [
    { characterId: "peter", name: "Peter" }, { characterId: "pep", name: "Pep" },
  ] });
  const originalLoad = browserFoundationStorage.load;
  const originalReadExisting = chatStorage.readExistingSession;
  const originalSessionRead = chatStorage.readSession;
  const originalBackgroundRead = chatStorage.readChatBackgroundSettings;
  const originalProfileRead = chatStorage.readGlobalProfileSettings;
  const originalImageRead = chatStorage.readChatImage;
  const originalSubscribe = chatStorage.subscribe;
  const originalRegexLoad = browserRegexStorage.load;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let releaseDestination!: () => void;
  const destinationPending = new Promise<void>((resolve) => { releaseDestination = resolve; });
  let releaseSecondary!: () => void;
  const secondaryPending = new Promise<void>((resolve) => { releaseSecondary = resolve; });
  let releasePeterAsset!: () => void;
  const peterAssetPending = new Promise<void>((resolve) => { releasePeterAsset = resolve; });
  let holdBackgroundRefreshes = false;
  const backgroundResponses: Array<(settings: Awaited<ReturnType<typeof chatStorage.readChatBackgroundSettings>>) => void> = [];
  const assetReads: Promise<Blob | null>[] = [];
  let destinationReads = 0, backgroundReads = 0, profileReads = 0, regexReads = 0;
  let destinationReadStarted = false;
  let activeChatSubscriptions = 0;
  const imageReads: string[] = [], createdUrls: string[] = [], revokedUrls: string[] = [];
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let failed = false;
  try {
    browserFoundationStorage.load = async () => foundation;
    chatStorage.readChatBackgroundSettings = async () => {
      backgroundReads++;
      if (holdBackgroundRefreshes)
        return new Promise((resolve) => backgroundResponses.push(resolve));
      await secondaryPending;
      return originalBackgroundRead.call(chatStorage);
    };
    chatStorage.readGlobalProfileSettings = async () => {
      profileReads++;
      await secondaryPending;
      return originalProfileRead.call(chatStorage);
    };
    browserRegexStorage.load = async () => {
      regexReads++;
      await secondaryPending;
      if (regexReads === 2) throw new Error("Display Regex could not be read.");
      return originalRegexLoad.call(browserRegexStorage);
    };
    chatStorage.subscribe = (listener) => {
      activeChatSubscriptions++;
      const unsubscribe = originalSubscribe.call(chatStorage, listener);
      return () => { activeChatSubscriptions--; unsubscribe(); };
    };
    for (const id of ["peter", "pep"]) {
      const session = await chatStorage.openSession(id);
      await chatStorage.send(session.id, `${id} history`);
    }
    const peter = await chatStorage.openSession("peter");
    const destination = await chatStorage.openSession("pep");
    const peterAssetId = await chatStorage.saveChatImage(new Blob(["peter wallpaper"], { type: "image/png" }));
    await chatStorage.updateSessionSettings(peter.id, { backgroundImage: peterAssetId });
    chatStorage.readChatImage = (id) => {
      imageReads.push(id);
      const read = (async () => {
        if (id === peterAssetId) await peterAssetPending;
        return await originalImageRead.call(chatStorage, id);
      })();
      assetReads.push(read);
      return read;
    };
    URL.createObjectURL = (() => {
      const url = `blob:chat-lifecycle-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url) => { revokedUrls.push(url); }) as typeof URL.revokeObjectURL;
    const waitForDestinationRead = async () => {
      if (!destinationReadStarted) {
        destinationReadStarted = true;
        destinationReads++;
        await destinationPending;
      }
    };
    chatStorage.readExistingSession = async (id) => {
      if (id === "pep") await waitForDestinationRead();
      return originalReadExisting.call(chatStorage, id);
    };
    chatStorage.readSession = async (id) => {
      if (id === destination.id) await waitForDestinationRead();
      return originalSessionRead.call(chatStorage, id);
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
        assert.ok(Date.now() < deadline,
          `mounted chat did not reach its expected state within 2s: ${JSON.stringify({
            destinationReads, backgroundReads, profileReads, regexReads, activeChatSubscriptions,
            header: container.querySelector(".chat-contact-summary")?.textContent,
            messages: container.querySelectorAll("[data-message-id]").length,
            historyBusy: container.querySelector<HTMLElement>('[aria-label="Conversation history"]')?.getAttribute("aria-busy"),
            pendingImages: imageReads.length, text: container.textContent?.slice(0, 160),
          })}`);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
    };
    await act(async () => { root.render(createElement(Navigation)); });
    await waitFor(() => imageReads.includes(peterAssetId) && regexReads === 1 && backgroundReads === 1);
    assert.equal(container.querySelectorAll("[data-message-id]").length, 0,
      "current chat messages must stay unpublished until the selected background is prepared");
    assert.equal(container.querySelector(".chat-contact-summary")?.textContent, "Chat",
      "the generic header remains until the current frame can publish");
    assert.deepEqual([backgroundReads, profileReads, regexReads], [1, 1, 1]);
    assert.equal(activeChatSubscriptions, 3, "the validated session, background, and global timing owner each subscribe once");
    const composer = () => container.querySelector<HTMLTextAreaElement>("#chat-input")!;
    assert.equal(composer().disabled, false);

    await act(async () => { container.querySelector("button")!.click(); });
    await waitFor(() => destinationReads === 1);
    await waitFor(() => profileReads === 2 && regexReads === 2);
    assert.equal(backgroundReads, 1, "background settings were prepared once in parallel with the session");
    assert.equal(activeChatSubscriptions, 2, "pending navigation keeps only the destination session and global timing subscriptions");
    assert.equal(container.querySelector(".chat-contact-summary")?.textContent, "Chat",
      "the destination keeps its stable header until its own frame is ready");
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

    assert.ok(scrollCalls.length > 0, "the first published history positions the current session before paint");
    const initiallyPositionedHistory = container.querySelector<HTMLElement>('[aria-label="Conversation history"]')!;
    assert.equal(scrollCalls[0].top, initiallyPositionedHistory.scrollHeight,
      "the initial positioning targets the bottom of the first history");
    const callsBeforeDestinationPublish = scrollCalls.length;
    await act(async () => { releaseDestination(); releaseSecondary(); });
    await waitFor(() => container.textContent?.includes("pep history") === true &&
      container.querySelector<HTMLElement>('[aria-label="Conversation history"]')?.getAttribute("aria-busy") === "false");
    assert.ok(scrollCalls.length > callsBeforeDestinationPublish,
      "the first history publication executes its layout-effect bottom positioning");
    const publishedHistory = container.querySelector<HTMLElement>('[aria-label="Conversation history"]')!;
    assert.equal(scrollCalls.at(-1)?.top, publishedHistory.scrollHeight,
      "the initial positioning targets the bottom of the published history");
    assert.equal(container.querySelector(".chat-bubble")?.textContent, "pep history",
      "a failed destination Regex read publishes the original message text");
    assert.equal(container.querySelector(".chat-room")?.getAttribute("data-chat-background"), "default",
      "the session contract uses the Theme background without a selected chat wallpaper");
    // Background settings are global, not per Character: the destination reuses the valid snapshot the
    // first chat already read instead of reading them again.
    assert.equal(backgroundReads, 1);
    assert.equal(container.querySelector('[aria-label="Conversation history"]'), history);
    assert.equal(history.getAttribute("aria-busy"), "false");
    assert.equal(composer().disabled, false);
    assert.doesNotMatch(container.textContent ?? "", /peter history/);
    assert.equal(destinationReads, 1);
    assert.equal(activeChatSubscriptions, 3);

    // The blur checks below only apply to a chat with a wallpaper: give the destination one now.
    const pepAssetId = await chatStorage.saveChatImage(new Blob(["pep wallpaper"], { type: "image/png" }));
    await act(async () => { await chatStorage.updateSessionSettings(destination.id, { backgroundImage: pepAssetId }); });
    await waitFor(() => imageReads.includes(pepAssetId) && container.querySelector<HTMLElement>(".chat-room")?.dataset.chatBackground === "custom");

    const readsBeforeBackgroundChange = backgroundReads;
    await act(async () => { await chatStorage.updateSessionSettings(destination.id, { backgroundBlur: 3 }); });
    await waitFor(() => backgroundReads === readsBeforeBackgroundChange + 1);
    await act(async () => { await chatStorage.updateSessionSettings(peter.id, { streamOnline: true }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(backgroundReads, readsBeforeBackgroundChange + 1,
      "background refreshes on its own session's scoped change, not another setting change");

    await act(async () => { await chatStorage.updateSessionSettings(destination.id, { backgroundBlur: null }); });
    holdBackgroundRefreshes = true;
    await act(async () => { await chatStorage.updateGlobalChatBackgroundBlur(4); });
    await waitFor(() => backgroundResponses.length === 1);
    await act(async () => { await chatStorage.updateGlobalChatBackgroundBlur(8); });
    await waitFor(() => backgroundResponses.length === 2);
    backgroundResponses[1]({ id: "chat-background", blur: 8 });
    await waitFor(() => container.querySelector<HTMLElement>(".chat-room")?.style.getPropertyValue("--chat-background-blur") === "8px");
    backgroundResponses[0]({ id: "chat-background", blur: 2 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(container.querySelector<HTMLElement>(".chat-room")?.style.getPropertyValue("--chat-background-blur"), "8px",
      "a late scoped read cannot restore an older background setting");
    holdBackgroundRefreshes = false;

    await act(async () => {
      releasePeterAsset();
      await drainContinuation(Promise.all(assetReads), "late chat background reads");
    });
    assert.deepEqual(createdUrls, ["blob:chat-lifecycle-1"], "a late asset from the unmounted route never creates an object URL");
  } catch (reason) {
    failed = true;
    throw reason;
  } finally {
    releaseDestination();
    releaseSecondary();
    releasePeterAsset();
    let cleanupError: unknown;
    await act(async () => {
      root.unmount();
      try { await drainContinuation(Promise.allSettled(assetReads), "chat background cleanup"); }
      catch (reason) { cleanupError = reason; }
    });
    const subscriptionsAtUnmount = activeChatSubscriptions;
    // Wallpaper object URLs belong to a bounded cache, not to the mounted chat; releasing the cache revokes them all.
    resetChatBackgroundCacheForTests();
    const revokedAtUnmount = [...revokedUrls];
    chatStorage.readExistingSession = originalReadExisting;
    chatStorage.readSession = originalSessionRead;
    chatStorage.readChatBackgroundSettings = originalBackgroundRead;
    chatStorage.readGlobalProfileSettings = originalProfileRead;
    chatStorage.readChatImage = originalImageRead;
    chatStorage.subscribe = originalSubscribe;
    browserFoundationStorage.load = originalLoad;
    browserRegexStorage.load = originalRegexLoad;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    if (!failed) {
      assert.equal(subscriptionsAtUnmount, 0, "the ChatRoom releases its session, timing and background subscriptions on unmount");
      assert.equal(cleanupError, undefined, "asset continuations settle before test globals are restored");
      if (createdUrls.length) assert.deepEqual(revokedAtUnmount, createdUrls, "every wallpaper object URL is revoked when the bounded cache is released");
    }
  }
});
