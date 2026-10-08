import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import type { createRoot as CreateRoot } from "react-dom/client";
import { FoundationProvider, useFoundation } from "../components/foundation-provider";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { browserFoundationStorage, createIndexedDBFoundationStorage, FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { saveUser } from "../lib/foundation";
import type { FoundationDocument } from "../lib/foundation-types";

type Foundation = ReturnType<typeof useFoundation>;
const settle = (ms = 15) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const named = (name: string) => (document: FoundationDocument) => saveUser(document, { ...document.user, name });

// Installs a real IndexedDB-backed Foundation store behind the singleton the Provider uses, and lets a test
// fail or script reads. Reads are the only thing it can break; writes always reach the real store.
async function mounted(run: (env: {
  container: HTMLElement; dom: JSDOM; root: ReturnType<typeof CreateRoot>; context: () => Foundation;
  published: string[]; calls: { load: number; transact: number }; live: () => number;
  store: ReturnType<typeof createIndexedDBFoundationStorage>; raw: () => Promise<string | null>;
  control: { fail: boolean; scripted: Array<() => Promise<FoundationDocument>> };
}) => Promise<void>, options: { start?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://veil.test" });
  const keys = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window
      : key === "document" ? dom.window.document : dom.window[key as keyof typeof dom.window] });
  const channel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined }); // an open Node channel would keep the process alive
  const documents = new IndexedDBDocumentStorage(() => new IDBFactory());
  const store = createIndexedDBFoundationStorage(documents);
  const original = { load: browserFoundationStorage.load, transact: browserFoundationStorage.transact, subscribe: browserFoundationStorage.subscribe };
  const calls = { load: 0, transact: 0 }; let live = 0;
  const control = { fail: false, scripted: [] as Array<() => Promise<FoundationDocument>> };
  browserFoundationStorage.load = async () => {
    calls.load++;
    const scripted = control.scripted.shift();
    if (scripted) return scripted();
    if (control.fail) throw new Error("IndexedDB temporarily unavailable");
    return store.load();
  };
  browserFoundationStorage.transact = (update) => { calls.transact++; return store.transact(update); };
  browserFoundationStorage.subscribe = (listener) => { live++; const stop = store.subscribe(listener); return () => { live--; stop(); }; };
  const container = dom.window.document.getElementById("root")!;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  let latest!: Foundation; const published: string[] = [];
  function Probe() {
    latest = useFoundation();
    published.push(latest.document.user.name);
    return createElement("output", { "data-ready": String(latest.ready), "data-name": latest.document.user.name,
      "data-characters": String(latest.document.characters.length) });
  }
  const render = () => act(async () => { root.render(createElement(FoundationProvider, null, createElement(Probe))); });
  try {
    const env = { container, dom, root, context: () => latest, published, calls, live: () => live, store,
      raw: () => documents.read(FOUNDATION_STORAGE_KEY), control, render };
    await (run as (env: unknown) => Promise<void>)(Object.assign(env, { start: options.start !== false }));
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    Object.assign(browserFoundationStorage, original);
    if (channel) Object.defineProperty(globalThis, "BroadcastChannel", channel); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
    keys.forEach((key, index) => { if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key); });
  }
}
type Env = Parameters<Parameters<typeof mounted>[0]>[0] & { render: () => Promise<void> };
const output = (env: Env) => env.container.querySelector("output")!;
const alertText = (env: Env) => env.container.querySelector("[role=alert]")?.textContent ?? "";
const retry = (env: Env) => [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Retry");
const run = (body: (env: Env) => Promise<void>) => mounted(body as Parameters<typeof mounted>[0]);

test("a failed first load is not shown as an empty, ready catalog, and offers Retry", async () => {
  await run(async (env) => {
    env.control.fail = true;
    await env.render(); await act(async () => { await settle(); });
    assert.equal(output(env).dataset.ready, "false", "a read failure must not publish the default document as ready");
    assert.match(alertText(env), /temporarily unavailable/);
    assert(retry(env), "the failure offers an explicit retry");
  });
});

test("Retry after a failed first load shows the real persisted data", async () => {
  await run(async (env) => {
    await env.store.transact(named("Alice"));
    env.control.fail = true;
    await env.render(); await act(async () => { await settle(); });
    assert.equal(output(env).dataset.ready, "false");
    env.control.fail = false;
    await act(async () => { retry(env)!.click(); await settle(); });
    assert.equal(output(env).dataset.ready, "true");
    assert.equal(output(env).dataset.name, "Alice");
    assert.equal(alertText(env), "");
    assert.equal(retry(env), undefined);
  });
});

test("a refresh that fails after a good load keeps the last good document, then recovers", async () => {
  await run(async (env) => {
    await env.store.transact(named("Alice"));
    await env.render(); await act(async () => { await settle(); });
    assert.equal(output(env).dataset.name, "Alice");
    env.control.fail = true;
    await act(async () => { env.dom.window.dispatchEvent(new env.dom.window.Event("focus")); await settle(); });
    assert.equal(output(env).dataset.ready, "true", "an earlier good read stays usable");
    assert.equal(output(env).dataset.name, "Alice", "the last good document is retained, not replaced by defaults");
    assert.match(alertText(env), /temporarily unavailable/);
    await env.store.transact(named("Alice v2")); // another tab saved while reads were failing
    env.control.fail = false;
    await act(async () => { retry(env)!.click(); await settle(); });
    assert.equal(output(env).dataset.name, "Alice v2");
    assert.equal(alertText(env), "");
  });
});

test("while reads keep failing a write is refused and the persisted bytes are untouched", async () => {
  await run(async (env) => {
    await env.store.transact(named("Alice"));
    const before = await env.raw();
    env.control.fail = true;
    await env.render(); await act(async () => { await settle(); });
    let refusal: unknown;
    await act(async () => { await env.context().commit(named("Bob")).catch((reason) => { refusal = reason; }); });
    assert.match((refusal as Error)?.message ?? "", /temporarily unavailable|still loading|could not be loaded/i);
    assert.equal(env.calls.transact, 0, "no write was attempted from a state that never loaded");
    assert.equal(await env.raw(), before);
    // The same holds once an earlier good read exists and a later read fails.
    env.control.fail = false;
    await act(async () => { retry(env)!.click(); await settle(); });
    env.control.fail = true;
    await act(async () => { env.dom.window.dispatchEvent(new env.dom.window.Event("focus")); await settle(); });
    refusal = undefined;
    await act(async () => { await env.context().commit(named("Carol")).catch((reason) => { refusal = reason; }); });
    assert(refusal instanceof Error);
    assert.equal(env.calls.transact, 0);
    assert.equal(await env.raw(), before);
  });
});

test("a write after storage recovers re-reads first and then applies", async () => {
  await run(async (env) => {
    await env.store.transact(named("Alice"));
    env.control.fail = true;
    await env.render(); await act(async () => { await settle(); });
    env.control.fail = false; // readable again, nothing retried yet
    await act(async () => { await env.context().commit(named("Alice edited")); });
    assert.equal(env.calls.transact, 1);
    assert.equal((await env.store.load()).user.name, "Alice edited");
    assert.equal(output(env).dataset.ready, "true");
    assert.equal(output(env).dataset.name, "Alice edited");
  });
});

test("an older read finishing after a newer one never replaces it", async () => {
  await run(async (env) => {
    await env.store.transact(named("First"));
    await env.render(); await act(async () => { await settle(); });
    const stale = deferred<FoundationDocument>(), staleDoc = await env.store.load();
    await env.store.transact(named("Newest"));
    const newest = await env.store.load();
    env.control.scripted.push(() => stale.promise, async () => newest);
    await act(async () => {
      env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
      await settle();
      env.dom.window.dispatchEvent(new env.dom.window.Event("focus")); // a newer request while the first is slow
      await settle();
      stale.resolve({ ...staleDoc, user: { ...staleDoc.user, name: "STALE" } });
      await settle(40);
    });
    assert.equal(output(env).dataset.name, "Newest");
    assert(!env.published.includes("STALE"), "the slow, superseded result was never published");
  });
});

test("after unmount a pending read publishes nothing and no listener or request remains", async () => {
  await run(async (env) => {
    const slow = deferred<FoundationDocument>();
    env.control.scripted.push(() => slow.promise);
    await env.render(); await act(async () => { await settle(); });
    const reads = env.calls.load, seen = env.published.length;
    assert.equal(env.live(), 1);
    await act(async () => { env.root.unmount(); });
    assert.equal(env.live(), 0, "the storage subscription is released");
    slow.resolve({ ...(await env.store.load()), user: { ...(await env.store.load()).user, name: "LATE" } });
    env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
    await settle(40);
    assert.equal(env.calls.load, reads, "an unmounted Provider starts no new read");
    assert.equal(env.published.length, seen);
    assert(!env.published.includes("LATE"));
  });
});

test("a genuinely empty catalog is ready and shows no error or Retry", async () => {
  await run(async (env) => {
    await env.render(); await act(async () => { await settle(); });
    assert.equal(output(env).dataset.ready, "true");
    assert.equal(output(env).dataset.characters, "0");
    assert.equal(alertText(env), "");
    assert.equal(retry(env), undefined);
  });
});
