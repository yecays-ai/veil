import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";
import type { ChatBackgroundSettings, ChatSession } from "../lib/chat/types";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const session = { id: "s1", type: "direct", characterId: "a", title: "A", createdAt: 0, updatedAt: 0, nextOrder: 1 } as unknown as ChatSession;
type Change = Parameters<Parameters<typeof import("../lib/chat/storage").chatStorage.subscribe>[0]>[0];

/** Mounts the real ChatBackgroundSettings with only the chat storage reads under test replaced. */
async function mounted(sessionOverride: Partial<ChatSession> = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const { createRoot } = await import("react-dom/client");
  const { ChatBackgroundSettings: Component } = await import("../components/chat/chat-background-settings");
  const { chatStorage } = await import("../lib/chat/storage");
  const originals = { settings: chatStorage.readChatBackgroundSettings, image: chatStorage.readChatImage, subscribe: chatStorage.subscribe,
    update: chatStorage.updateSessionSettings, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const settingsReads: Array<ReturnType<typeof deferred<ChatBackgroundSettings>>> = [];
  const imageReads: Array<{ id: string; read: ReturnType<typeof deferred<Blob | null>> }> = [];
  const created: string[] = [];
  const revoked: string[] = [];
  const listeners = new Set<(change: Change) => void>();
  let unsubscribed = 0;
  chatStorage.readChatBackgroundSettings = () => { const read = deferred<ChatBackgroundSettings>(); settingsReads.push(read); return read.promise; };
  chatStorage.readChatImage = (id: string) => { const read = deferred<Blob | null>(); imageReads.push({ id, read }); return read.promise; };
  chatStorage.subscribe = ((next: (change: Change) => void) => {
    listeners.add(next);
    return () => { if (listeners.delete(next)) unsubscribed++; };
  }) as typeof chatStorage.subscribe;
  URL.createObjectURL = (() => { const url = `blob:test-${created.length}`; created.push(url); return url; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => { revoked.push(url); }) as typeof URL.revokeObjectURL;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let unmounted = false;
  const unmount = async () => { if (unmounted) return; unmounted = true; await act(async () => { root.unmount(); }); };
  const render = (override: Partial<ChatSession> = sessionOverride) => act(async () => {
    root.render(createElement(Component, { session: { ...session, ...override }, onBack: () => {} }));
  });
  const flush = () => act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); await new Promise<void>((resolve) => setImmediate(resolve)); });
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null;
  const preview = () => container.querySelector(".chat-background-preview-image");
  return { chatStorage, settingsReads, imageReads, created, revoked, container, render, flush, alert, preview, unhandled, unmount,
    notify: (change: Change) => act(async () => { for (const listener of [...listeners]) listener(change); }),
    get listenerCount() { return listeners.size; }, get unsubscribed() { return unsubscribed; },
    async cleanup() {
      await unmount();
      process.off("unhandledRejection", onUnhandled);
      Object.assign(chatStorage, { readChatBackgroundSettings: originals.settings, readChatImage: originals.image,
        subscribe: originals.subscribe, updateSessionSettings: originals.update });
      URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke;
      loader._load = originalLoad; dom.window.close();
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
    } };
}

regressionContract("chat.background-settings-read-errors", "async-race-safety",
  "Chat Background settings load, preview and refresh reads never leave unhandled rejections and report real failures", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    // Success: settings then image resolve, the preview is shown, nothing is reported.
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "g1", blur: 3 }); await ui.flush();
    assert.deepEqual(ui.imageReads.map((r) => r.id), ["g1"]);
    ui.imageReads[0].read.resolve(new Blob(["x"])); await ui.flush();
    assert.ok(ui.preview(), "the preview renders on success");
    assert.equal(ui.alert(), null);
    // Settings read fails: a visible error, no unhandled rejection, previous settings stay.
    await ui.notify({ domain: "chat-background" } as Change);
    ui.settingsReads[1].reject(new Error("settings read failed")); await ui.flush();
    assert.match(ui.alert() ?? "", /could not be loaded/);
    assert.ok(ui.preview(), "the last good preview is kept");
    // A later successful refresh clears the stale error.
    await ui.notify({ domain: "chat-background" } as Change);
    ui.settingsReads[2].resolve({ id: "chat-background", globalChatBackgroundImage: "g1", blur: 3 }); await ui.flush();
    assert.equal(ui.alert(), null);
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});

regressionContract("chat.background-settings-image-read-error", "async-race-safety",
  "a failed preview image read shows an error instead of an unhandled rejection or a stuck preview", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "g1" }); await ui.flush();
    ui.imageReads[0].read.reject(new Error("image read failed")); await ui.flush();
    assert.match(ui.alert() ?? "", /preview could not be loaded/);
    assert.equal(ui.preview(), null);
    assert.deepEqual(ui.created, []);
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});

regressionContract("chat.background-settings-failure-is-per-read", "async-race-safety",
  "a preview failure for one image does not come back when the same image is shown again", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "gA" }); await ui.flush();
    ui.imageReads[0].read.reject(new Error("A failed")); await ui.flush();
    assert.match(ui.alert() ?? "", /preview could not be loaded/);
    await ui.render({ backgroundImage: "gB" }); await ui.flush();      // the shown image changes to B
    assert.equal(ui.alert(), null, "B has not failed");
    await ui.render({}); await ui.flush();                              // back to A, whose new read is pending
    assert.deepEqual(ui.imageReads.map((r) => r.id), ["gA", "gB", "gA"]);
    assert.equal(ui.alert(), null, "A's earlier failure is not replayed while its new read is pending");
    ui.imageReads[2].read.resolve(new Blob(["a"])); await ui.flush();
    assert.ok(ui.preview(), "A's new read succeeded and is shown");
    assert.equal(ui.alert(), null, "no stale error next to a loaded preview");
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});

regressionContract("chat.background-settings-unmount", "async-race-safety",
  "reads that finish or fail after unmount publish nothing, start no image read and create no object URL", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    assert.equal(ui.listenerCount, 1, "the mounted component registers one store listener");
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "g1" }); await ui.flush();
    await ui.notify({ domain: "chat-background" } as Change);
    await ui.unmount();
    assert.equal(ui.unsubscribed, 1, "the store subscription is released");
    assert.equal(ui.listenerCount, 0, "the live listener fixture no longer retains the component callback");
    const settingsReadsAtUnmount = ui.settingsReads.length;
    await ui.notify({ domain: "chat-background" } as Change);
    assert.equal(ui.settingsReads.length, settingsReadsAtUnmount, "a post-unmount notification starts no settings read");
    ui.settingsReads[1].resolve({ id: "chat-background", globalChatBackgroundImage: "late" });
    ui.imageReads[0].read.resolve(new Blob(["late"]));
    await ui.flush();
    assert.deepEqual(ui.imageReads.map((r) => r.id), ["g1"], "no image read starts for settings that arrive after unmount");
    assert.deepEqual(ui.created, [], "no object URL is created after unmount");
    // A failure after unmount is swallowed too.
    const second = await mounted();
    try {
      await second.render(); await second.unmount();
      second.settingsReads[0].reject(new Error("late failure")); await second.flush();
      assert.deepEqual(second.unhandled, []);
    } finally { await second.cleanup(); }
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});

regressionContract("chat.background-settings-preview-url-release", "async-race-safety",
  "replacing or unmounting a preview revokes its created object URL and a late image read creates none", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "g1" }); await ui.flush();
    ui.imageReads[0].read.resolve(new Blob(["first"])); await ui.flush();
    assert.deepEqual(ui.created, ["blob:test-0"], "the first successful read creates a preview URL");
    assert.ok(ui.preview(), "the first preview is rendered");
    assert.deepEqual(ui.revoked, []);

    await ui.notify({ domain: "chat-background" } as Change);
    ui.settingsReads[1].resolve({ id: "chat-background", globalChatBackgroundImage: "g2" }); await ui.flush();
    assert.deepEqual(ui.revoked, ["blob:test-0"], "changing images revokes the previous preview URL");
    ui.imageReads[1].read.resolve(new Blob(["second"])); await ui.flush();
    assert.deepEqual(ui.created, ["blob:test-0", "blob:test-1"]);
    assert.ok(ui.preview(), "the replacement preview is rendered");

    await ui.notify({ domain: "chat-background" } as Change);
    ui.settingsReads[2].resolve({ id: "chat-background", globalChatBackgroundImage: "g3" }); await ui.flush();
    assert.equal(ui.imageReads[2].id, "g3", "the third image read is pending before unmount");
    await ui.unmount();
    assert.deepEqual(ui.revoked, ["blob:test-0", "blob:test-1"], "unmount revokes the currently displayed preview URL");
    ui.imageReads[2].read.resolve(new Blob(["late"])); await ui.flush();
    assert.deepEqual(ui.created, ["blob:test-0", "blob:test-1"], "a late read after unmount creates no orphan URL");
    assert.deepEqual(ui.revoked, ["blob:test-0", "blob:test-1"]);
  } finally { await ui.cleanup(); }
});

regressionContract("chat.background-settings-stale-refresh", "async-race-safety",
  "an older settings read that finishes after a newer one cannot replace the newer settings", async () => {
  const ui = await mounted();
  try {
    await ui.render();
    await ui.notify({ domain: "chat-background" } as Change); // a second read while the first is still pending
    assert.equal(ui.settingsReads.length, 2);
    ui.settingsReads[1].resolve({ id: "chat-background", globalChatBackgroundImage: "newer" }); await ui.flush();
    assert.deepEqual(ui.imageReads.map((r) => r.id), ["newer"]);
    ui.settingsReads[0].resolve({ id: "chat-background", globalChatBackgroundImage: "older" }); await ui.flush();
    assert.deepEqual(ui.imageReads.map((r) => r.id), ["newer"], "the older result is discarded, never read as an image");
    // The same holds for a late failure of the older read.
    await ui.notify({ domain: "chat-background" } as Change);
    await ui.notify({ domain: "chat-background" } as Change);
    ui.settingsReads[3].resolve({ id: "chat-background", globalChatBackgroundImage: "newer" }); await ui.flush();
    ui.settingsReads[2].reject(new Error("older failed")); await ui.flush();
    assert.equal(ui.alert(), null, "a stale failure does not report an error over a newer success");
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});

test("existing interactions: Restore Global still clears the conversation background and reports a save failure", async () => {
  const ui = await mounted({ backgroundImage: "own" });
  try {
    const calls: unknown[][] = []; let fail = false;
    ui.chatStorage.updateSessionSettings = (async (...args: unknown[]) => { calls.push(args); if (fail) throw new Error("save failed"); }) as typeof ui.chatStorage.updateSessionSettings;
    await ui.render();
    ui.settingsReads[0].resolve({ id: "chat-background" }); await ui.flush();
    const restore = [...ui.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Restore Global")!;
    await act(async () => { restore.click(); }); await ui.flush();
    assert.deepEqual(calls, [["s1", { backgroundImage: null, backgroundBlur: null }]]);
    assert.equal(ui.alert(), null);
    fail = true;
    await act(async () => { restore.click(); }); await ui.flush();
    assert.match(ui.alert() ?? "", /save failed/);
    assert.deepEqual(ui.unhandled, []);
  } finally { await ui.cleanup(); }
});
