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

async function harness(options: { fakeImage?: boolean } = {}) {
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
  const decodes: Array<() => void> = [];
  if (options.fakeImage) // a browser image whose decode finishes only when the test says so
    install("Image", class { src = ""; decode() { return new Promise<void>((resolve) => { decodes.push(resolve); }); } });
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
  function Probe({ session, characterId }: { session: ChatSession | null; characterId: string }) {
    const background = useChatBackground(session, { characterId, storage });
    const frame = background as typeof background & { readyForFrame?: boolean };
    return createElement("div", { id: "probe", "data-url": background.url ?? "", "data-blur": String(background.blur),
      "data-late": String(background.late), "data-frame-ready": String(frame.readyForFrame) });
  }
  const url = () => dom.window.document.getElementById("probe")?.getAttribute("data-url") ?? "";
  const blur = () => dom.window.document.getElementById("probe")?.getAttribute("data-blur") ?? "";
  const late = () => dom.window.document.getElementById("probe")?.getAttribute("data-late");
  const frameReady = () => dom.window.document.getElementById("probe")?.getAttribute("data-frame-ready");
  // Synchronous act: renders and flushes effects but not pending storage promises, i.e. the first frame.
  const mountNow = (session: ChatSession | null, characterId = "a") => act(() => { root.render(createElement(Probe, { session, characterId })); });
  const settleDecodes = () => act(async () => { decodes.splice(0).forEach((resolve) => resolve()); });
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
  return { storage, reads, revoked, mountNow, leave, until, url, blur, late, frameReady, settleDecodes, pendingDecodes: () => decodes.length, cleanup };
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

test("the wallpaper is chosen before the session is read, from what that chat last resolved to", async () => {
  const app = await harness();
  try {
    const { id, session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    await app.until(() => app.url() !== "");
    assert.equal(app.late(), "true", "a cold wallpaper arrives after the first frame, so it may fade in");
    await app.leave();
    await app.mountNow(null); // re-entry: the session itself is still being read from storage
    assert.notEqual(app.url(), "", "the wallpaper is in the first frame even before the session exists");
    assert.equal(app.late(), "false", "a wallpaper that was already there is never faded");
    assert.deepEqual(app.reads, { image: 1, settings: 1 });

    // Another tab (or this one) changes the chat's wallpaper: the hint must never paint the old one.
    await app.leave();
    const next = await app.storage.saveChatImage(new Blob(["next"], { type: "image/png" }));
    await app.storage.updateSessionSettings(session.id, { backgroundImage: next });
    assert.notEqual(next, id);
    await app.mountNow(null);
    assert.equal(app.url(), "", "a changed chat is not painted from the stale hint");
  } finally { await app.cleanup(); }
});

test("each character keeps its own wallpaper hint", async () => {
  const app = await harness();
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    await app.until(() => app.url() !== "");
    await app.leave();
    // A different character (or a storage instance that never saw this chat) has no hint to paint.
    await app.mountNow(null, "someone-else");
    assert.equal(app.url(), "", "another character does not inherit this wallpaper");
    await app.leave();
    await app.mountNow(null, "a");
    assert.notEqual(app.url(), "", "the character that resolved it still has it");
  } finally { await app.cleanup(); }
});

test("a wallpaper is not exposed before it has decoded, and re-entering while it decodes waits instead of re-reading", async () => {
  const app = await harness({ fakeImage: true });
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    await app.until(() => app.pendingDecodes() === 1); // the Blob is read; decode() is still pending
    assert.equal(app.url(), "", "an undecoded wallpaper is not treated as ready");
    assert.equal(app.frameReady(), "false", "the chat frame must wait for its selected wallpaper");
    await app.leave();
    await app.mountNow(session); // re-entry while the decode is pending
    assert.equal(app.url(), "");
    await app.settleDecodes();
    await app.until(() => app.url() !== "");
    assert.equal(app.late(), "true", "it arrived after the first frame, decoded");
    assert.equal(app.frameReady(), "true", "frame readiness follows the wallpaper preparation result");
    assert.equal(app.reads.image, 1, "the pending entry was awaited, not read again");
  } finally { await app.cleanup(); }
});

test("a settings read timeout releases the frame and a late result still applies", async () => {
  const app = await harness();
  try {
    const created = await app.storage.openSession("a");
    const session = (await app.storage.readSession(created.id)).session;
    const image = await app.storage.saveChatImage(new Blob(["global"], { type: "image/png" }));
    await app.storage.updateGlobalChatBackground(image);
    const readSettings = app.storage.readChatBackgroundSettings.bind(app.storage);
    let release!: (value: Awaited<ReturnType<typeof app.storage.readChatBackgroundSettings>>) => void;
    app.storage.readChatBackgroundSettings = () => new Promise((resolve) => { release = resolve; });
    await app.mountNow(session);
    await app.until(() => app.frameReady() === "true");
    assert.equal(app.url(), "", "timed-out settings publish with the Theme background fallback");
    release(await readSettings());
    await app.until(() => app.url() !== "");
    assert.equal(app.frameReady(), "true", "the late settings result updates the selected wallpaper");
  } finally { await app.cleanup(); }
});

test("a superseding settings refresh completes readiness before the fallback timeout", async () => {
  const app = await harness();
  try {
    const created = await app.storage.openSession("a");
    const session = (await app.storage.readSession(created.id)).session;
    const readSettings = app.storage.readChatBackgroundSettings.bind(app.storage);
    let release!: (value: Awaited<ReturnType<typeof app.storage.readChatBackgroundSettings>>) => void;
    let pendingReads = 0;
    app.storage.readChatBackgroundSettings = () => {
      app.reads.settings++;
      pendingReads++;
      return new Promise((resolve) => { release = resolve; });
    };
    await app.mountNow(session);
    await app.until(() => pendingReads === 1 && app.frameReady() === "false");
    await act(async () => {
      await app.storage.updateSessionSettings(session.id, { backgroundBlur: 4 });
    });
    release(await readSettings());
    await app.until(() => app.frameReady() === "true");
    assert.equal(app.url(), "", "the frame is ready with the existing Theme background");
    assert.equal(app.blur(), "4");
  } finally { await app.cleanup(); }
});

test("a wallpaper read that never settles releases the frame to the theme background", async () => {
  const app = await harness();
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    app.storage.readChatImage = () => new Promise<Blob | null>(() => {});
    await app.mountNow(session);
    await app.until(() => app.frameReady() === "true");
    assert.equal(app.url(), "", "a stalled image is not exposed");
    assert.equal(app.frameReady(), "true", "the bounded fallback prevents a permanently blocked frame");
  } finally { await app.cleanup(); }
});

test("a wallpaper selected after the chat opened is faded in even though the first one was cached", async () => {
  const app = await harness();
  try {
    const { session } = await sessionWithWallpaper(app.storage);
    await app.mountNow(session);
    await app.until(() => app.url() !== "");
    await app.leave();
    await app.mountNow(session);
    assert.equal(app.late(), "false", "the cached wallpaper is simply there");
    const next = await app.storage.saveChatImage(new Blob(["next"], { type: "image/png" }));
    await app.storage.updateSessionSettings(session.id, { backgroundImage: next });
    await app.mountNow((await app.storage.readSession(session.id)).session); // same chat, newly selected wallpaper
    await app.until(() => app.url() !== "" && app.late() === "true");
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
    assert.equal(app.reads.settings, 1, "the one settings read starts in parallel before the cached snapshot is stored");
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
