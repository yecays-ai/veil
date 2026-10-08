import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { ChatStorage } from "../lib/chat/storage";
import type { ChatSession } from "../lib/chat/types";
import {
  cachedBackgroundUrl, rememberBackgroundBlob, rememberBackgroundSettings,
  cachedBackgroundSettings, resetChatBackgroundCacheForTests,
} from "../lib/chat/background-cache";

async function harness() {
  resetChatBackgroundCacheForTests();
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("self", dom.window);
  install("BroadcastChannel", undefined); // an open channel would keep the test process alive
  const { createRoot } = await import("react-dom/client");
  const { useChatBackground } = await import("../components/chat/use-chat-background");
  const storage = new ChatStorage(() => new IDBFactory());
  const reads = { image: 0, settings: 0 };
  const revoked: string[] = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); revoke.call(URL, url); };
  const readImage = storage.readChatImage.bind(storage), readSettings = storage.readChatBackgroundSettings.bind(storage);
  storage.readChatImage = (id) => { reads.image++; return readImage(id); };
  storage.readChatBackgroundSettings = () => { reads.settings++; return readSettings(); };
  const root = createRoot(dom.window.document.getElementById("root")!);
  function Probe({ session }: { session: ChatSession | null }) {
    const background = useChatBackground(session, { characterId: "a", storage });
    return createElement("div", { id: "probe", "data-url": background.url ?? "", "data-blur": String(background.blur) });
  }
  const url = () => dom.window.document.getElementById("probe")?.getAttribute("data-url") ?? "";
  // Synchronous act: renders and flushes effects but not pending storage promises, i.e. the first frame.
  const mountNow = (session: ChatSession | null) => act(() => { root.render(createElement(Probe, { session })); });
  const leave = () => act(() => { root.render(createElement("div", { id: "elsewhere" })); });
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, "condition timed out");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  };
  const cleanup = async () => {
    await act(() => { root.unmount(); });
    dom.window.close();
    URL.revokeObjectURL = revoke;
    resetChatBackgroundCacheForTests();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { storage, reads, revoked, mountNow, leave, until, url, cleanup };
}

async function sessionWithWallpaper(storage: ChatStorage, content = "wallpaper") {
  const created = await storage.openSession("a");
  const id = await storage.saveChatImage(new Blob([content], { type: "image/png" }));
  await storage.updateSessionSettings(created.id, { backgroundImage: id });
  return { id, session: (await storage.readSession(created.id)).session };
}

test("cold open still loads the wallpaper asynchronously, once", async () => {
  const app = await harness();
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    assert.equal(app.url(), "", "nothing cached yet");
    await app.until(() => app.url() !== "");
    assert.deepEqual(app.reads, { image: 1, settings: 1 });
  } finally { await app.cleanup(); }
});

test("re-entering a chat paints its own wallpaper in the first frame, without re-reading storage", async () => {
  const app = await harness();
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    await app.until(() => app.url() !== "");
    const first = app.url();
    await app.leave();
    assert.equal(app.url(), "");
    assert.deepEqual(app.revoked, [], "leaving a chat keeps the cached wallpaper URL (bounded cache owns it)");
    await app.mountNow(session); // the very first frame of the next visit
    assert.notEqual(app.url(), "", "wallpaper is present in the first frame");
    assert.equal(app.url(), first, "the same object URL is reused so the browser keeps the decoded bitmap");
    assert.deepEqual(app.reads, { image: 1, settings: 1 }, "no repeated blob or settings read");
  } finally { await app.cleanup(); }
});

test("a snapshot stored while the session was still loading is applied once the session arrives", async () => {
  const app = await harness();
  try {
    const created = await app.storage.openSession("a");
    const session = (await app.storage.readSession(created.id)).session;
    await app.mountNow(null); // first render with no session: defaults
    assert.equal(app.url(), "");
    // Another chat read the settings and the wallpaper meanwhile.
    rememberBackgroundBlob("global", new Blob(["g"]));
    rememberBackgroundSettings(app.storage, { id: "chat-background", globalChatBackgroundImage: "global" }, app.storage.backgroundRevision());
    await app.mountNow(session);
    assert.notEqual(app.url(), "", "the cached global wallpaper is applied, not skipped");
    assert.equal(app.reads.settings, 0, "no settings read was needed");
  } finally { await app.cleanup(); }
});

test("a global wallpaper is also in the first frame on re-entry, and a changed one is never shown stale", async () => {
  const app = await harness();
  try {
    const created = await app.storage.openSession("a");
    const oldId = await app.storage.saveChatImage(new Blob(["old"], { type: "image/png" }));
    await app.storage.updateGlobalChatBackground(oldId);
    const session = (await app.storage.readSession(created.id)).session;
    await app.mountNow(session);
    await app.until(() => app.url() !== "");
    const oldUrl = app.url();
    await app.leave();
    await app.mountNow(session);
    assert.notEqual(app.url(), "", "global wallpaper is in the first frame");
    await app.leave();

    // The wallpaper is replaced while no chat is mounted.
    const newId = await app.storage.saveChatImage(new Blob(["new"], { type: "image/png" }));
    await app.storage.updateGlobalChatBackground(newId);
    assert.equal(cachedBackgroundSettings(app.storage, app.storage.backgroundRevision()), null, "the settings snapshot is invalidated by the change");
    await app.mountNow(session);
    assert.equal(app.url(), "", "the replaced wallpaper is never painted from the stale snapshot");
    await app.until(() => app.url() !== "" && app.url() !== oldUrl);
  } finally { await app.cleanup(); }
});

test("the cache is bounded to a few wallpapers, revokes evicted URLs, and never serves a stale settings snapshot", () => {
  resetChatBackgroundCacheForTests();
  const revoked: string[] = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); revoke.call(URL, url); };
  try {
    const a = rememberBackgroundBlob("a", new Blob(["a"])).url, b = rememberBackgroundBlob("b", new Blob(["b"])).url;
    assert.equal(cachedBackgroundUrl("a"), a); // touching "a" makes "b" the oldest
    const c = rememberBackgroundBlob("c", new Blob(["c"])).url;
    assert.equal(cachedBackgroundUrl("b"), null, "the least recently used wallpaper is dropped");
    assert.deepEqual(revoked, [b], "and its object URL is revoked");
    assert.equal(cachedBackgroundUrl("a"), a);
    assert.equal(cachedBackgroundUrl("c"), c);
    assert.equal(rememberBackgroundBlob("a", new Blob(["again"])).url, a, "an id already held is reused");
    resetChatBackgroundCacheForTests();
    assert.deepEqual(revoked.sort(), [a, b, c].sort(), "resetting releases every remaining URL");
  } finally { URL.revokeObjectURL = revoke; }
  // A read that started before a change is stored with its old revision and can never be served.
  const owner = {}, other = {};
  rememberBackgroundSettings(owner, { id: "chat-background", globalChatBackgroundImage: "old" }, 3);
  assert.equal(cachedBackgroundSettings(owner, 4), null);
  assert.deepEqual(cachedBackgroundSettings(owner, 3), { id: "chat-background", globalChatBackgroundImage: "old" });
  // Every storage counts revisions from zero, so equal revisions of another instance must not share a snapshot.
  assert.equal(cachedBackgroundSettings(other, 3), null);
  resetChatBackgroundCacheForTests();
});
