import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { BINDING_STORAGE_KEY, createBindingStorage } from "../lib/binding-storage";
import { editBindingList, setBindingField, withoutWorldBookBinding, type BindingDocument } from "../lib/bindings";
import { regressionContract } from "./regression-contract";

const KEY = BINDING_STORAGE_KEY;
type Hooks = { afterFirstRead?: () => void; failWrites?: () => boolean };

// One browser profile: a shared backing map and one origin-wide FIFO exclusive lock queue.
function origin() {
  const values = new Map<string, string>();
  let tail: Promise<unknown> = Promise.resolve();
  const locks = { request: (async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    const run = tail.then(() => callback({}), () => callback({}));
    tail = run.then(() => {}, () => {});
    return run;
  }) as unknown as LockManager["request"] };
  const backend = (hooks: Hooks) => ({
    getItem: (key: string) => { const value = values.get(key) ?? null;
      if (hooks.afterFirstRead) { const run = hooks.afterFirstRead; hooks.afterFirstRead = undefined; run(); } return value; },
    setItem: (key: string, value: string) => { if (hooks.failWrites?.()) throw new Error("Quota exceeded"); values.set(key, value); },
  });
  const tab = (hooks: Hooks = {}, withLocks = true) =>
    createBindingStorage(() => backend(hooks), withLocks ? () => locks : () => undefined);
  const read = (): BindingDocument => JSON.parse(values.get(KEY) ?? '{"global":{},"characters":{}}');
  return { values, locks, tab, read };
}
const seed = (tab: ReturnType<ReturnType<typeof origin>["tab"]>, doc: BindingDocument) => tab.save(doc);

test("two tabs saving interleaved changes to different Bindings keep both", async () => {
  const o = origin(); const [a, b, c] = [o.tab(), o.tab(), o.tab()];
  await seed(a, { global: { apiConfigId: "api-1" }, characters: {} });
  await Promise.all([
    a.transact((d) => setBindingField(d, {}, "presetId", "preset-a")),
    b.transact((d) => setBindingField(d, { characterId: "p" }, "regexIds", ["r1"])),
    c.transact((d) => setBindingField(d, { characterId: "p", appId: "messages" }, "worldBookIds", [])),
  ]);
  const saved = o.read();
  assert.deepEqual(saved.global, { apiConfigId: "api-1", presetId: "preset-a" });
  assert.deepEqual(saved.characters.p.defaults, { regexIds: ["r1"] });
  assert.deepEqual(saved.characters.p.apps.messages, { worldBookIds: [] }, "explicit None survives as []");
});

test("every write waits for the origin-wide lock and then starts from what the lock holder wrote", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a, { global: {}, characters: {} });
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  const owner = (o.locks.request as unknown as (n: string, o: unknown, cb: () => Promise<void>) => Promise<void>)(KEY, { mode: "exclusive" }, async () => {
    await held;
    o.values.set(KEY, JSON.stringify({ global: { apiConfigId: "from-holder" }, characters: {} }));
  });
  const pending = b.transact((d) => setBindingField(d, {}, "presetId", "mine"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(o.read().global, {}, "nothing is written while another tab holds the lock");
  release(); await owner; await pending;
  assert.deepEqual(o.read().global, { apiConfigId: "from-holder", presetId: "mine" });
});

test("stale list edits from two tabs merge by intent and keep the explicit (non-alphabetical) order", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a, { global: { worldBookIds: ["w3"] }, characters: {} });
  // Both tabs rendered [w3]. A adds w2, B adds w1; neither knows about the other.
  await a.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "toggle", id: "w2" }));
  await b.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "toggle", id: "w1" }));
  assert.deepEqual(o.read().global.worldBookIds, ["w3", "w2", "w1"], "append order is commit order, nothing dropped");
  // B moves w3 down while A (stale) removes w2: ids, not positions, so both apply.
  await Promise.all([
    b.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "move", id: "w3", by: 1 })),
    a.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "toggle", id: "w2" })),
  ]);
  const order = o.read().global.worldBookIds!;
  assert.deepEqual(order, ["w3", "w1"], "w3 moved past w2, then w2 was removed by id");
  // A move that no longer applies (id removed elsewhere, or already at the edge) changes nothing.
  const before = o.values.get(KEY);
  await a.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "move", id: "w2", by: 1 }));
  await a.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "move", id: order[0], by: -1 }));
  assert.equal(o.values.get(KEY), before);
});

test("Default (All), None and a selection keep their meaning through concurrent unrelated saves and deletions", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a, { global: { regexIds: [] }, characters: { p: { defaults: { worldBookIds: ["w1", "w2"] }, apps: {} } } });
  await Promise.all([
    a.transact((d) => setBindingField(d, {}, "apiConfigId", "api-2")),
    b.transact((d) => withoutWorldBookBinding(d, "w1")),
    a.transact((d) => setBindingField(d, { characterId: "q" }, "presetId", null)),
  ]);
  const saved = o.read();
  assert.deepEqual(saved.global.regexIds, [], "None stays an explicit empty list");
  assert.equal("worldBookIds" in saved.global, false, "unset stays Default (All), never becomes []");
  assert.deepEqual(saved.characters.p.defaults.worldBookIds, ["w2"]);
  assert.equal(saved.global.apiConfigId, "api-2");
  assert.equal(saved.characters.q.defaults.presetId, null);
});

test("delete versus edit: a deleted Book is removed without losing another tab's concurrent edit", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a, { global: { worldBookIds: ["w1", "w2"] }, characters: {} });
  await Promise.all([
    b.transact((d) => withoutWorldBookBinding(d, "w1")),
    a.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "toggle", id: "w3" })),
  ]);
  assert.deepEqual(o.read().global.worldBookIds, ["w2", "w3"]);
});

test("a failed save leaves stored Bindings untouched and later saves from every tab still work", async () => {
  const o = origin(); let fail = false;
  const a = o.tab({ failWrites: () => fail }), b = o.tab();
  await seed(a, { global: { regexIds: ["r1"] }, characters: {} });
  const before = o.values.get(KEY); fail = true;
  await assert.rejects(a.transact((d) => editBindingList(d, {}, "regexIds", { type: "toggle", id: "r2" })), /Quota/);
  assert.equal(o.values.get(KEY), before);
  fail = false;
  await Promise.all([a.transact((d) => editBindingList(d, {}, "regexIds", { type: "toggle", id: "r2" })),
    b.transact((d) => editBindingList(d, {}, "regexIds", { type: "toggle", id: "r3" }))]);
  assert.deepEqual(o.read().global.regexIds, ["r1", "r2", "r3"]);
});

test("without Web Locks a change by another context between read and write is detected; persistent interference saves nothing", async () => {
  const o = origin(); await seed(o.tab({}, false), { global: { apiConfigId: "api-1" }, characters: {} });
  const foreign = () => o.values.set(KEY, JSON.stringify({ global: { apiConfigId: "api-1", presetId: "foreign" }, characters: {} }));
  await o.tab({ afterFirstRead: foreign }, false).transact((d) => setBindingField(d, {}, "regexIds", ["r1"]));
  assert.deepEqual(o.read().global, { apiConfigId: "api-1", presetId: "foreign", regexIds: ["r1"] });
  let reads = 0, calls = 0;
  const hostile = createBindingStorage(() => ({
    getItem: (key: string) => { const v = o.values.get(key) ?? null; return ++reads % 2 ? v : `${v}\n`; },
    setItem: (key: string, value: string) => { o.values.set(key, value); },
  }), () => undefined);
  const before = o.values.get(KEY);
  await assert.rejects(hostile.transact((d) => { calls++; return setBindingField(d, {}, "presetId", "x"); }), /changed in another tab/);
  assert.equal(o.values.get(KEY), before); assert.equal(calls, 3);
});

regressionContract("bindings.stale-ui-list-edit", "async-race-safety",
  "mounted Binding editor applies a list toggle to the latest stored Bindings, not to its stale on-screen list", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings/bindings", pretendToBeVisual: true });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event"] as const) install(name, dom.window[name]);
    install("self", dom.window); install("indexedDB", new IDBFactory());
    install("IS_REACT_ACT_ENVIRONMENT", true);
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { BindingHome } = await import("../components/settings/bindings/binding-manager");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { browserPresetStorage } = await import("../lib/preset-storage");
    const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
    const { browserRegexStorage } = await import("../lib/regex-storage");
    const { createPresetDocument } = await import("../lib/preset");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const originals = [browserFoundationStorage.load, browserApiConfigStorage.listApiConfigs, browserPresetStorage.load,
      browserWorldBookStorage.load, browserRegexStorage.load] as const;
    browserFoundationStorage.load = async () => normalizeFoundation({ characters: [] });
    browserApiConfigStorage.listApiConfigs = async () => [];
    browserPresetStorage.load = async () => createPresetDocument();
    browserWorldBookStorage.load = async () => ({ books: [{ id: "b1", name: "Lore" }, { id: "b2", name: "Map" }, { id: "b3", name: "Atlas" }] }) as never;
    browserRegexStorage.load = async () => ({ groups: [] }) as never;
    const doc = dom.window.document;
    const stored = () => JSON.parse(dom.window.localStorage.getItem(BINDING_STORAGE_KEY) ?? "{}");
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (true) {
        assert.ok(Date.now() < deadline, "mounted UI condition timed out");
        let ready = false;
        await act(async () => { ready = condition(); if (!ready) await new Promise((r) => setTimeout(r, 10)); });
        if (ready) return;
      }
    };
    const field = () => [...doc.querySelectorAll<HTMLElement>(".binding-field")].find((el) => el.querySelector("strong")?.textContent === "WorldBook")!;
    const summary = () => field().querySelector(".binding-field-main small")!.textContent;
    const choice = (text: string) => [...field().querySelectorAll<HTMLButtonElement>(".binding-picker button")].find((el) => el.textContent?.trim().startsWith(text))!;
    const root = createRoot(doc.getElementById("root")!);
    try {
      dom.window.localStorage.setItem(BINDING_STORAGE_KEY, JSON.stringify({ global: { worldBookIds: ["b1"] }, characters: {} }));
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(BindingHome))); });
      await wait(() => !!doc.querySelector(".binding-field") && summary() === "Lore");
      // Another tab adds b2. The storage event has not reached this tab yet, so it still shows [Lore].
      dom.window.localStorage.setItem(BINDING_STORAGE_KEY, JSON.stringify({ global: { worldBookIds: ["b1", "b2"] }, characters: {} }));
      assert.equal(summary(), "Lore");
      await act(async () => { field().querySelector<HTMLButtonElement>(".binding-field-main")!.click(); });
      await act(async () => { choice("Atlas").click(); });
      await wait(() => summary() === "Lore · Map · Atlas");
      assert.deepEqual(stored().global.worldBookIds, ["b1", "b2", "b3"], "the other tab's b2 survives this tab's toggle");
    } finally {
      await act(async () => { root.unmount(); });
      browserFoundationStorage.load = originals[0]; browserApiConfigStorage.listApiConfigs = originals[1];
      browserPresetStorage.load = originals[2]; browserWorldBookStorage.load = originals[3]; browserRegexStorage.load = originals[4];
      dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
