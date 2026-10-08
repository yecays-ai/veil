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
  static opened = 0;
  static closed = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(private name: string) {
    TestChannel.opened++;
    const room = TestChannel.rooms.get(name) ?? new Set();
    room.add(this);
    TestChannel.rooms.set(name, room);
  }
  postMessage(data: unknown) {
    TestChannel.rooms.get(this.name)?.forEach((peer) => {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    });
  }
  close() {
    TestChannel.closed++;
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
  TestChannel.rooms.clear(); TestChannel.opened = 0; TestChannel.closed = 0;
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

test("Foundation Provider coalesces stale reads and cleans up every mount", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://veil.test" });
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
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
    const second = createRoot(dom.window.document.getElementById("root")!);
    await act(async () => { second.render(createElement(FoundationProvider, null, createElement(Probe))); });
    assert.equal(callbacks.size, 1);
    await act(async () => { second.unmount(); });
    assert.equal(callbacks.size, 0);
  } finally {
    browserFoundationStorage.load = original.load;
    browserFoundationStorage.transact = original.transact;
    browserFoundationStorage.subscribe = original.subscribe;
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
