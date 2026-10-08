import assert from "node:assert/strict";
import test from "node:test";
import { IDBDatabase as FakeIDBDatabase, IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { BINDING_STORAGE_KEY, createBindingStorage } from "../lib/binding-storage";
import { createBindingResourceValidation } from "../lib/binding-resource-validation";
import { editBindingList, setBindingField, type BindingDocument } from "../lib/bindings";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import { createPresetStorage } from "../lib/preset-storage";
import { createRegexStorage, deleteRegexGroupAndBindings } from "../lib/regex-storage";
import { createWorldBookStorage, deleteWorldBookAndBindings } from "../lib/worldbook-storage";
import { regressionContract } from "./regression-contract";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Unlike a single global queue, this fake models independent named locks, FIFO waiting,
// ifAvailable returning null, and release AFTER the callback's promise settles.
function originLocks() {
  const held = new Set<string>();
  const tails = new Map<string, Promise<unknown>>();
  const locks = { request: (async (name: string, options: LockOptions, callback: (lock: unknown) => unknown) => {
    if (options.ifAvailable && held.has(name)) return callback(null);
    const before = tails.get(name) ?? Promise.resolve();
    const pending = before.then(async () => {
      held.add(name);
      try { return await callback({ name, mode: "exclusive" }); }
      finally { held.delete(name); }
    });
    tails.set(name, pending.catch(() => {}));
    return pending;
  }) as LockManager["request"] };
  return { locks, held };
}

const book = (id: string) => ({ id, name: id, description: "", enabled: true, entries: [] });
const group = (id: string) => ({ id, name: id, description: "", enabled: true, rules: [], createdAt: 1, updatedAt: 1 });
const customPreset = (id: string) => ({ ...createBuiltinPreset(), id, name: id, builtIn: false });
const apiConfig = (id: string) => ({ id, name: id, baseUrl: "https://example.test/v1", apiKey: "test", model: "test" });

async function fixture() {
  const origin = originLocks();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: origin.locks } });
  const restore = () => {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  };
  const values = new Map<string, string>();
  let failedKey: string | undefined;
  let failWrites = false;
  const backend = {
    getItem(key: string) {
      if (key === failedKey) throw new Error("Resource read failed");
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failWrites && key === BINDING_STORAGE_KEY) throw new Error("Quota exceeded");
      values.set(key, value);
    },
    removeItem(key: string) { values.delete(key); },
  };
  const factory = new IDBFactory();
  const api = new ApiConfigStorage(() => factory), apiB = new ApiConfigStorage(() => factory);
  const presets = createPresetStorage(() => backend);
  const worldBooks = createWorldBookStorage(() => backend);
  const regex = createRegexStorage(() => backend);
  const a = createBindingStorage(() => backend, () => origin.locks);
  const b = createBindingStorage(() => backend, () => origin.locks);
  try {
    await presets.save(createPresetDocument());
    await worldBooks.save({ version: 1, books: [book("w1")] });
    await regex.save({ version: 1, groups: [group("r1")] });
    await api.saveApiConfig(apiConfig("a1"));
    await apiB.listApiConfigs();
  } catch (error) { restore(); throw error; }
  const readers = { api, presets, worldBooks, regex };
  const validate = createBindingResourceValidation(readers, () => origin.locks);
  return { ...origin, values, a, b, api, apiB, presets, worldBooks, regex, readers, validate, restore,
    failReads(key?: string) { failedKey = key; }, failBindingWrites(value: boolean) { failWrites = value; } };
}

test("cleanup queued behind another tab re-reads catalogs and preserves its new resources and Bindings", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
    const holderStarted = deferred(), release = deferred();
    const holder = f.locks.request(BINDING_STORAGE_KEY, { mode: "exclusive" }, async () => {
      holderStarted.resolve(); await release.promise;
    });
    await holderStarted.promise;
    const pending = f.a.cleanStale(f.validate);
    await f.worldBooks.transact((d) => ({ ...d, books: [...d.books, book("w2")] }));
    await f.regex.transact((d) => ({ ...d, groups: [...d.groups, group("r2")] }));
    await f.presets.transact((d) => ({ ...d, presets: [...d.presets, customPreset("p2")] }));
    await f.apiB.saveApiConfig(apiConfig("a2"));
    // The current owner publishes its completed Binding before releasing #35's lock.
    f.values.set(BINDING_STORAGE_KEY, JSON.stringify({ global: {
      worldBookIds: ["missing", "w2", "w1"], regexIds: ["r2"], presetId: "p2", apiConfigId: "a2",
    }, characters: {} }));
    release.resolve(); await holder; await pending;
    assert.deepEqual((await f.b.load()).global, {
      worldBookIds: ["w2", "w1"], regexIds: ["r2"], presetId: "p2", apiConfigId: "a2",
    });
  } finally { f.restore(); }
});

test("cleanup and simultaneous unrelated intent edits retain both windows' updates and order", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
    await Promise.all([
      f.a.cleanStale(f.validate),
      f.b.transact((d) => setBindingField(d, { characterId: "p" }, "apiConfigId", "a1")),
      f.a.transact((d) => editBindingList(d, {}, "regexIds", { type: "add", id: "r1" })),
    ]);
    const saved = await f.b.load();
    assert.deepEqual(saved.global, { worldBookIds: ["w1"], regexIds: ["r1"] });
    assert.equal(saved.characters.p.defaults.apiConfigId, "a1");
  } finally { f.restore(); }
});

test("actual resource deletion still clears invalid references at every scope with API fail-closed", async () => {
  const f = await fixture();
  try {
    const slot = { apiConfigId: "a1", presetId: "gone", worldBookIds: ["w1", "gone"], regexIds: ["r1", "gone"] };
    await f.a.save({ global: slot, characters: { p: { defaults: slot, apps: { messages: slot } } } });
    await f.apiB.deleteApiConfig("a1");
    await f.worldBooks.transact((d) => ({ ...d, books: [] }));
    await f.regex.transact((d) => ({ ...d, groups: [] }));
    await f.a.cleanStale(f.validate);
    const expected = { apiConfigId: null, worldBookIds: [], regexIds: [] };
    const saved = await f.b.load();
    assert.deepEqual(saved.global, expected);
    assert.deepEqual(saved.characters.p.defaults, expected);
    assert.deepEqual(saved.characters.p.apps.messages, expected);
  } finally { f.restore(); }
});

test("explicit unlink, None and inheritance reset still apply by intent after reconciliation", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["w1"], regexIds: ["r1"], apiConfigId: "a1" }, characters: {} });
    await f.a.cleanStale(f.validate);
    await f.b.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "remove", id: "w1" }));
    await f.b.transact((d) => setBindingField(d, {}, "apiConfigId", null));
    await f.b.transact((d) => setBindingField(d, {}, "regexIds", undefined));
    assert.deepEqual((await f.a.load()).global, { worldBookIds: [], apiConfigId: null });
  } finally { f.restore(); }
});

test("existing resource locks are held through the final Binding write; same-resource writers cannot pass validation", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"], regexIds: ["r1"] }, characters: {} });
    const beforeApi = f.api.withApiConfigs.bind(f.api);
    const attempted: Promise<unknown>[] = [];
    f.api.withApiConfigs = (run) => beforeApi((configs) => {
      assert.deepEqual([...f.held], [BINDING_STORAGE_KEY, "veil.preset.v1", "veil.worldbooks.v1", "veil.regex.v1"]);
      attempted.push(assert.rejects(f.worldBooks.transact(() => ({ version: 1, books: [] })), /being saved elsewhere/));
      attempted.push(assert.rejects(f.regex.transact(() => ({ version: 1, groups: [] })), /being saved elsewhere/));
      attempted.push(assert.rejects(f.presets.transact((d) => d), /busy/));
      return run(configs);
    });
    await f.a.cleanStale(f.validate); await Promise.all(attempted);
    assert.deepEqual((await f.a.load()).global, { worldBookIds: ["w1"], regexIds: ["r1"] });
    assert.equal(f.held.size, 0);
    // Existing compensating deletion paths still work; locks are not leaked or acquired in reverse order.
    await deleteWorldBookAndBindings("w1", f.worldBooks, f.b);
    await deleteRegexGroupAndBindings("r1", f.regex, f.b);
    assert.deepEqual((await f.a.load()).global, { worldBookIds: [], regexIds: [] });
  } finally { f.restore(); }
});

test("API validation callback runs inside its real readonly transaction before another connection's write", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { apiConfigId: "a1", worldBookIds: ["missing"] }, characters: {} });
    const events: string[] = [];
    let other!: Promise<unknown>;
    const beforeApi = f.api.withApiConfigs.bind(f.api);
    f.api.withApiConfigs = (run) => beforeApi((configs) => {
      events.push("validated");
      other = f.apiB.deleteApiConfig("a1").then(() => { events.push("other committed"); });
      const saved = run(configs);
      events.push("Binding committed");
      assert.equal((saved as BindingDocument).global.apiConfigId, "a1");
      return saved;
    });
    await f.a.cleanStale(f.validate); await other;
    assert.deepEqual(events, ["validated", "Binding committed", "other committed"]);
    assert.equal(await f.api.getApiConfig("a1"), undefined);
  } finally { f.restore(); }
});

test("the API catalog boundary is still an active readonly IDB transaction, not a completed list read", async () => {
  const f = await fixture();
  const original = FakeIDBDatabase.prototype.transaction;
  let observed: IDBTransaction | undefined;
  FakeIDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
    const tx = original.apply(this, args);
    if (args[1] === "readonly" && tx.objectStoreNames.contains("configs")) observed = tx;
    return tx;
  };
  try {
    const result = await f.api.withApiConfigs((configs) => {
      assert.equal(configs[0].id, "a1");
      assert.ok(observed);
      assert.equal(observed.mode, "readonly");
      // Throws TransactionInactiveError if withApiConfigs merely awaits listApiConfigs.
      observed.objectStore("configs").getAll();
      return "active";
    });
    assert.equal(result, "active");
  } finally { FakeIDBDatabase.prototype.transaction = original; f.restore(); }
});

test("an asynchronous catalog-read gap keeps both the existing Binding lock and resource locks until write", async () => {
  const f = await fixture();
  const apiReadStarted = deferred(), finishApiRead = deferred();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
    const before = f.values.get(BINDING_STORAGE_KEY);
    const original = f.api.withApiConfigs.bind(f.api);
    f.api.withApiConfigs = async (run) => {
      apiReadStarted.resolve(); await finishApiRead.promise;
      return original(run);
    };
    const cleanup = f.a.cleanStale(f.validate);
    await apiReadStarted.promise;
    let editApplied = false;
    const edit = f.b.transact((d) => {
      editApplied = true;
      return setBindingField(d, {}, "regexIds", ["r1"]);
    });
    // Attempt to recreate an ID which the just-read directory says is missing. With only a
    // fresh read before commit this would succeed and then be silently removed by that commit.
    await assert.rejects(f.worldBooks.transact((d) => ({ ...d, books: [...d.books, book("missing")] })), /being saved elsewhere/);
    assert.equal(editApplied, false, "a concurrent Binding editor is still queued under #35's lock");
    assert.equal(f.values.get(BINDING_STORAGE_KEY), before, "cleanup has not written during the read gap");
    finishApiRead.resolve(); await Promise.all([cleanup, edit]);
    assert.deepEqual((await f.a.load()).global, { worldBookIds: ["w1"], regexIds: ["r1"] });
    await f.worldBooks.transact((d) => ({ ...d, books: [...d.books, book("missing")] }));
    await f.b.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "add", id: "missing" }));
    await f.a.cleanStale(f.validate);
    assert.deepEqual((await f.a.load()).global.worldBookIds, ["w1", "missing"]);
  } finally { finishApiRead.resolve(); f.restore(); }
});

test("resource lock contention refuses cleanup without changing data and a later retry succeeds", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
    const before = f.values.get(BINDING_STORAGE_KEY);
    const started = deferred(), release = deferred();
    const holder = f.locks.request("veil.worldbooks.v1", { mode: "exclusive" }, async () => {
      started.resolve(); await release.promise;
    });
    await started.promise;
    await assert.rejects(f.a.cleanStale(f.validate), /busy.*Nothing was cleaned/);
    assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
    assert.deepEqual([...f.held], ["veil.worldbooks.v1"]);
    release.resolve(); await holder;
    await f.a.cleanStale(f.validate);
    assert.deepEqual((await f.a.load()).global.worldBookIds, ["w1"]);
  } finally { f.restore(); }
});

test("unavailable Web Locks refuses destructive cleanup while explicit #35 intent edits remain usable", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
    const before = f.values.get(BINDING_STORAGE_KEY);
    await assert.rejects(f.a.cleanStale(createBindingResourceValidation(f.readers, () => undefined)), /requires browser Web Locks/);
    assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
    const noLocks = createBindingStorage(() => ({
      getItem: (key) => f.values.get(key) ?? null,
      setItem: (key, value) => { f.values.set(key, value); },
    }), () => undefined);
    await noLocks.transact((d) => editBindingList(d, {}, "worldBookIds", { type: "remove", id: "w1" }));
    assert.deepEqual((await f.a.load()).global.worldBookIds, ["missing"]);
  } finally { f.restore(); }
});

test("resource read/corruption, IDB read and Binding write failures never replace Bindings; queue and locks recover", async () => {
  const f = await fixture();
  try {
    await f.a.save({ global: { worldBookIds: ["missing", "w1"], presetId: "missing" }, characters: {} });
    const before = f.values.get(BINDING_STORAGE_KEY);
    for (const key of ["veil.preset.v1", "veil.worldbooks.v1", "veil.regex.v1"]) {
      f.failReads(key);
      await assert.rejects(f.a.cleanStale(f.validate), /Resource read failed/);
      assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
      assert.equal(f.held.size, 0);
      f.failReads();
      const raw = f.values.get(key)!; f.values.set(key, "{broken");
      await assert.rejects(f.a.cleanStale(f.validate));
      assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
      assert.equal(f.values.get(key), "{broken", "cleanup never repairs/reset a damaged library");
      f.values.set(key, raw);
    }
    const unavailable = new ApiConfigStorage(() => { throw new Error("IDB unavailable"); });
    await assert.rejects(f.a.cleanStale(createBindingResourceValidation({ ...f.readers, api: unavailable }, () => f.locks)), /IDB unavailable/);
    assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
    f.failBindingWrites(true);
    await assert.rejects(f.a.cleanStale(f.validate), /Quota/);
    assert.equal(f.values.get(BINDING_STORAGE_KEY), before);
    f.failBindingWrites(false); await f.a.cleanStale(f.validate);
    assert.deepEqual((await f.a.load()).global, { worldBookIds: ["w1"] });
    assert.equal(f.held.size, 0);
  } finally { f.restore(); }
});

regressionContract("bindings.stale-resource-cleanup", "async-race-safety",
  "mounted manager with an old catalog cannot erase another window's new resource Bindings", async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/settings/bindings", pretendToBeVisual: true });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "Event"] as const) install(name, dom.window[name]);
    const factory = new IDBFactory();
    Object.defineProperty(dom.window, "indexedDB", { value: factory, configurable: true });
    install("self", dom.window); install("indexedDB", factory); install("IS_REACT_ACT_ENVIRONMENT", true);
    const origin = originLocks(); Object.defineProperty(dom.window.navigator, "locks", { value: origin.locks, configurable: true });
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { BindingHome } = await import("../components/settings/bindings/binding-manager");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserBindingStorage } = await import("../lib/binding-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { browserPresetStorage } = await import("../lib/preset-storage");
    const { browserWorldBookStorage } = await import("../lib/worldbook-storage");
    const { browserRegexStorage } = await import("../lib/regex-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const originalFoundation = browserFoundationStorage.load;
    const originalBooks = browserWorldBookStorage.load;
    const originalTransact = browserBindingStorage.transact;
    const originalCleanup = browserBindingStorage.cleanStale;
    const readStarted = deferred(), returnOldCatalog = deferred();
    let operation: Promise<BindingDocument> | undefined;
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      browserFoundationStorage.load = async () => normalizeFoundation({ characters: [] });
      await browserPresetStorage.save(createPresetDocument());
      await browserWorldBookStorage.save({ version: 1, books: [book("w1")] });
      await browserRegexStorage.save({ version: 1, groups: [group("r1")] });
      await browserBindingStorage.save({ global: { worldBookIds: ["missing", "w1"] }, characters: {} });
      let first = true;
      browserWorldBookStorage.load = async () => {
        const loaded = await originalBooks();
        if (first) { first = false; readStarted.resolve(); await returnOldCatalog.promise; }
        return loaded;
      };
      // Observe both the old and new production cleanup entry points, then await the actual
      // operation. Rendering resources early must never make this assertion false-green.
      browserBindingStorage.transact = (update) => operation = originalTransact(update);
      browserBindingStorage.cleanStale = (boundary) => operation = originalCleanup(boundary);
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(BindingHome))); });
      await readStarted.promise;
      const foreign = createBindingStorage(() => dom.window.localStorage, () => origin.locks);
      await act(async () => {
        await browserWorldBookStorage.transact((d) => ({ ...d, books: [...d.books, book("w2")] }));
        await browserRegexStorage.transact((d) => ({ ...d, groups: [...d.groups, group("r2")] }));
        await browserPresetStorage.transact((d) => ({ ...d, presets: [...d.presets, customPreset("p2")] }));
        await browserApiConfigStorage.saveApiConfig(apiConfig("a2"));
        await foreign.transact((d) => ({ ...d, global: { ...d.global,
          worldBookIds: ["missing", "w2", "w1"], regexIds: ["r2"], apiConfigId: "a2", presetId: "p2" } }));
      });
      await act(async () => { returnOldCatalog.resolve(); await returnOldCatalog.promise; });
      const deadline = Date.now() + 5000;
      while (!operation) {
        assert.ok(Date.now() < deadline, "manager cleanup did not start");
        await act(async () => { await new Promise((done) => setTimeout(done, 5)); });
      }
      await act(async () => { await operation; });
      const saved = await foreign.load();
      assert.deepEqual(saved.global, { worldBookIds: ["w2", "w1"], regexIds: ["r2"], apiConfigId: "a2", presetId: "p2" });
      assert.equal(origin.held.size, 0, "assert only after protected write has completed and released locks");
      assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    } finally {
      returnOldCatalog.resolve();
      await act(async () => { root.unmount(); });
      browserFoundationStorage.load = originalFoundation; browserWorldBookStorage.load = originalBooks;
      browserBindingStorage.transact = originalTransact; browserBindingStorage.cleanStale = originalCleanup;
      dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
