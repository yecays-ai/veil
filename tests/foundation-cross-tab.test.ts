import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { FoundationProvider, useFoundation } from "../components/foundation-provider";
import { IndexedDBDocumentStorage, type DocumentStorage } from "../lib/core-document-storage";
import {
  browserFoundationStorage,
  createIndexedDBFoundationStorage,
} from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";

class TestChannel {
  static rooms = new Map<string, Set<TestChannel>>();
  static instances: TestChannel[] = [];
  static opened = 0;
  static closed = 0;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(private name: string) {
    TestChannel.opened++;
    TestChannel.instances.push(this);
    const room = TestChannel.rooms.get(name) ?? new Set();
    room.add(this);
    TestChannel.rooms.set(name, room);
  }
  postMessage(data: unknown) {
    if (this.closed) return;
    TestChannel.rooms.get(this.name)?.forEach((peer) => {
      if (peer !== this && !peer.closed) peer.onmessage?.({ data } as MessageEvent);
    });
  }
  close() {
    TestChannel.closed++;
    this.closed = true;
    TestChannel.rooms.get(this.name)?.delete(this);
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 20 && !condition(); attempt++) await settle();
  assert.equal(condition(), true);
}
const peter = () => ({ characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) });

test("Foundation create, update, delete and alternating cross-tab writes converge", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: TestChannel });
  TestChannel.rooms.clear(); TestChannel.instances = []; TestChannel.opened = 0; TestChannel.closed = 0;
  try {
    const documents = new IndexedDBDocumentStorage(() => new IDBFactory());
    const a = createIndexedDBFoundationStorage(documents);
    const b = createIndexedDBFoundationStorage(documents);
    let snapshot = await a.load();
    const stopA = a.subscribe(() => { void a.load().then((next) => { snapshot = next; }); });
    const stopB = b.subscribe(() => {});

    await b.transact((current) => ({ ...current, characters: [peter()] }));
    await waitFor(() => snapshot.characters.length === 1);
    assert.deepEqual(snapshot.characters.map((item) => item.name), ["Peter"]);

    await b.transact((current) => ({ ...current, characters: current.characters.map((item) =>
      item.characterId === "peter" ? { ...item, name: "Peter Parker" } : item) }));
    await waitFor(() => snapshot.characters[0]?.name === "Peter Parker");
    assert.equal(snapshot.characters[0]?.name, "Peter Parker");

    await b.transact((current) => ({ ...current, characters: [] }));
    await waitFor(() => snapshot.characters.length === 0);
    assert.equal(snapshot.characters.length, 0);

    await a.transact((current) => ({ ...current, user: { ...current.user, name: "A" } }));
    await b.transact((current) => ({ ...current, universe: { ...current.universe, name: "B" } }));
    await a.transact((current) => ({ ...current, runtime: { timeAware: false } }));
    await settle();
    const [fromA, fromB] = await Promise.all([a.load(), b.load()]);
    assert.deepEqual(fromA, fromB);
    assert.equal(snapshot.user.name, "A");
    assert.equal(snapshot.universe.name, "B");
    assert.equal(snapshot.runtime.timeAware, false);

    stopA(); stopB();
    assert.equal(TestChannel.opened, 2);
    assert.equal(TestChannel.closed, 2);
  } finally {
    if (original) Object.defineProperty(globalThis, "BroadcastChannel", original);
    else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

test("a failed Foundation transaction emits no local or cross-tab success notification", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: TestChannel });
  TestChannel.rooms.clear();
  try {
    const failing: DocumentStorage = {
      read: async () => null,
      putIfAbsent: async (_key, value) => value,
      replaceIfCurrent: async () => { throw new Error("write failed"); },
      rollbackIfCurrent: async () => false,
    };
    const writer = createIndexedDBFoundationStorage(failing);
    const peer = createIndexedDBFoundationStorage(failing);
    let local = 0, remote = 0;
    const stops = [writer.subscribe(() => { local++; }), peer.subscribe(() => { remote++; })];
    await assert.rejects(writer.transact((current) => ({ ...current, characters: [peter()] })), /write failed/);
    await settle();
    assert.deepEqual({ local, remote }, { local: 0, remote: 0 });
    stops.forEach((stop) => stop());
  } finally {
    if (original) Object.defineProperty(globalThis, "BroadcastChannel", original);
    else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

test("Foundation storage stops delivery when a channel closes and supports a fresh subscription", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: TestChannel });
  TestChannel.rooms.clear(); TestChannel.instances = []; TestChannel.opened = 0; TestChannel.closed = 0;
  let stopRetired: (() => void) | undefined;
  let stopPeer: (() => void) | undefined;
  let stopFresh: (() => void) | undefined;
  try {
    const documents = new IndexedDBDocumentStorage(() => new IDBFactory());
    const left = createIndexedDBFoundationStorage(documents);
    const right = createIndexedDBFoundationStorage(documents);
    let retiredNotifications = 0;
    let peerNotifications = 0;
    let freshNotifications = 0;
    stopRetired = left.subscribe(() => { retiredNotifications++; });
    const retiredChannel = TestChannel.instances[0];
    stopPeer = right.subscribe(() => { peerNotifications++; });

    stopRetired();
    assert.equal(retiredChannel.closed, true);
    assert.equal(TestChannel.rooms.get("veil-foundation-v1")?.has(retiredChannel), false);
    retiredChannel.postMessage({ type: "foundation-changed" });
    assert.equal(peerNotifications, 0, "a closed channel must not deliver to a live peer");

    await right.transact((current) => ({ ...current, user: { ...current.user, name: "Peer" } }));
    await waitFor(() => peerNotifications === 1);
    assert.equal(retiredNotifications, 0, "the retired subscription must not receive peer changes");

    stopFresh = left.subscribe(() => { freshNotifications++; });
    const freshChannel = TestChannel.instances[2];
    assert.notEqual(freshChannel, retiredChannel);
    await right.transact((current) => ({ ...current, user: { ...current.user, name: "Fresh" } }));
    await waitFor(() => freshNotifications === 1);
    assert.equal(retiredNotifications, 0);

    stopFresh();
    stopPeer();
  } finally {
    stopRetired?.();
    stopFresh?.();
    stopPeer?.();
    if (original) Object.defineProperty(globalThis, "BroadcastChannel", original);
    else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

test("Foundation Provider coalesces stale reads and cleans up every mount", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://veil.test" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const focusListeners = new Set<EventListenerOrEventListenerObject>();
  const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
  const addWindowListener = dom.window.addEventListener.bind(dom.window);
  const removeWindowListener = dom.window.removeEventListener.bind(dom.window);
  const addDocumentListener = dom.window.document.addEventListener.bind(dom.window.document);
  const removeDocumentListener = dom.window.document.removeEventListener.bind(dom.window.document);
  dom.window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "focus") focusListeners.add(listener);
    addWindowListener(type, listener, options);
  }) as typeof dom.window.addEventListener;
  dom.window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === "focus") focusListeners.delete(listener);
    removeWindowListener(type, listener, options);
  }) as typeof dom.window.removeEventListener;
  dom.window.document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "visibilitychange") visibilityListeners.add(listener);
    addDocumentListener(type, listener, options);
  }) as typeof dom.window.document.addEventListener;
  dom.window.document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === "visibilitychange") visibilityListeners.delete(listener);
    removeDocumentListener(type, listener, options);
  }) as typeof dom.window.document.removeEventListener;
  const original = {
    load: browserFoundationStorage.load,
    transact: browserFoundationStorage.transact,
    subscribe: browserFoundationStorage.subscribe,
  };
  const callbacks = new Set<() => void>();
  const requests: { resolve: (value: FoundationDocument) => void }[] = [];
  browserFoundationStorage.load = () => new Promise((resolve) => requests.push({ resolve }));
  browserFoundationStorage.subscribe = (listener) => { callbacks.add(listener); return () => { callbacks.delete(listener); }; };
  const seen: string[] = [];
  function Probe() { const value = useFoundation(); if (value.ready) seen.push(value.document.user.name); return null; }
  async function resolveRequest(index: number, name: string) {
    const value = defaultFoundation(); value.user.name = name;
    await act(async () => { requests[index].resolve(value); await settle(); });
  }
  async function dispatch(target: EventTarget, type: string) {
    await act(async () => { target.dispatchEvent(new dom.window.Event(type)); await settle(); });
  }
  try {
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { root.render(createElement(FoundationProvider, null, createElement(Probe))); });
    assert.equal(callbacks.size, 1);
    assert.equal(requests.length, 1);
    callbacks.forEach((listener) => listener());
    const old = defaultFoundation(); old.user.name = "Old";
    await act(async () => { requests[0].resolve(old); await settle(); });
    assert.equal(requests.length, 2);
    const latest = structuredClone(old); latest.user.name = "Latest";
    await act(async () => { requests[1].resolve(latest); await settle(); });
    assert.deepEqual(seen, ["Latest"]);

    await act(async () => { root.unmount(); });
    assert.equal(callbacks.size, 0);
    assert.equal(focusListeners.size, 0);
    assert.equal(visibilityListeners.size, 0);
    const readsAfterUnmount = requests.length;
    await dispatch(dom.window, "focus");
    await dispatch(dom.window.document, "visibilitychange");
    assert.equal(requests.length, readsAfterUnmount, "events after unmount must not start storage reads");

    const second = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { second.render(createElement(FoundationProvider, null, createElement(Probe))); });
    assert.equal(callbacks.size, 1);
    assert.equal(focusListeners.size, 1);
    assert.equal(visibilityListeners.size, 1);
    await resolveRequest(2, "Remounted");
    await dispatch(dom.window, "focus");
    assert.equal(requests.length, 4, "the remounted focus listener should refresh storage");
    await resolveRequest(3, "Focused");
    await dispatch(dom.window.document, "visibilitychange");
    assert.equal(requests.length, 5, "the remounted visibility listener should refresh storage");
    await resolveRequest(4, "Visible");
    await act(async () => { callbacks.forEach((listener) => listener()); await settle(); });
    assert.equal(requests.length, 6, "the remounted storage subscription should receive notifications");
    await resolveRequest(5, "Notified");
    await act(async () => { second.unmount(); });
    assert.equal(callbacks.size, 0);
    assert.equal(focusListeners.size, 0);
    assert.equal(visibilityListeners.size, 0);
  } finally {
    browserFoundationStorage.load = original.load;
    browserFoundationStorage.transact = original.transact;
    browserFoundationStorage.subscribe = original.subscribe;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
