import assert from "node:assert/strict";
import test from "node:test";
import { createPresetStorage, deletePresetAndBindings, type PresetStorage } from "../lib/preset-storage";
import { BUILTIN_PRESET_ID, createPresetDocument, presetForBinding } from "../lib/preset";
import { copyPreset, setActivePreset, updatePreset } from "../lib/preset-library";
import { createBindingStorage } from "../lib/binding-storage";
import { createRegexStorage } from "../lib/regex-storage";
import { bootstrapCurrentProduct } from "../lib/bootstrap";
import { resolveBindings } from "../lib/bindings";

const KEY = "veil.preset.v1";
function setup() {
  const values = new Map<string, string>();
  const memory = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const storage = createPresetStorage(() => memory), peer = createPresetStorage(() => memory);
  const document = setActivePreset(copyPreset(copyPreset(createPresetDocument(), BUILTIN_PRESET_ID,
    "Delete me", "deleted"), BUILTIN_PRESET_ID, "Keep me", "kept"), "deleted");
  return { memory, values, storage, peer, document };
}
const failingBindings = { transact: async () => { throw new Error("Binding save failed"); } };
function renameKept(document: ReturnType<typeof createPresetDocument>) {
  return updatePreset(document, { ...document.presets.find((p) => p.id === "kept")!, name: "Concurrent edit" });
}

test("failed deletion restores its own transaction snapshot, preserving an update completed before deletion", async () => {
  const { storage, peer, document } = setup(); await storage.save(document);
  const interleaved: PresetStorage = { ...storage, transact: async (update) => {
    await peer.transact(renameKept);
    return storage.transact(update);
  } };
  await assert.rejects(deletePresetAndBindings("deleted", interleaved, failingBindings), /Binding save failed/);
  const current = await peer.load();
  assert.equal(current.presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
  assert.deepEqual(current.presets.find((p) => p.id === "deleted"), document.presets[1]);
  assert.equal(current.activePresetId, "deleted");
});

test("failed deletion cannot mistake a post-delete concurrent update for its rollback token", async () => {
  const { storage, peer, document } = setup(); await storage.save(document);
  const interleaved: PresetStorage = { ...storage, transact: async (update) => {
    const next = await storage.transact(update);
    await peer.transact((current) => setActivePreset(renameKept(current), "kept"));
    return next;
  } };
  await assert.rejects(deletePresetAndBindings("deleted", interleaved, failingBindings), /changed while Binding cleanup failed/);
  const current = await peer.load();
  assert.equal(current.presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
  assert.equal(current.activePresetId, "kept");
  assert(!current.presets.some((p) => p.id === "deleted"));
});

test("ordinary failed deletion restores original library and successful deletion cleans bindings", async () => {
  const { memory, storage, document } = setup(); await storage.save(document);
  await assert.rejects(deletePresetAndBindings("deleted", storage, failingBindings), /Binding save failed/);
  assert.deepEqual(await storage.load(), document);
  const bindings = createBindingStorage(() => memory);
  await bindings.transact((current) => ({ ...current, global: { presetId: "deleted", apiConfigId: "keep-api" } }));
  await deletePresetAndBindings("deleted", storage, bindings);
  assert.equal((await storage.load()).activePresetId, BUILTIN_PRESET_ID);
  assert.deepEqual((await bindings.load()).global, { apiConfigId: "keep-api" });
});

test("unreadable JSON and partially damaged libraries stay byte-for-byte intact through load/save/transact and restart", async () => {
  const { memory, values, storage, document } = setup();
  const damaged = structuredClone(document); damaged.presets[1].name = "";
  for (const raw of ["{broken", JSON.stringify(damaged), JSON.stringify({ ...document, version: 99 })]) {
    values.set(KEY, raw);
    for (const operation of [() => storage.load(), () => storage.save(createPresetDocument()),
      () => storage.transact(() => createPresetDocument()), () => createPresetStorage(() => memory).load()]) {
      await assert.rejects(operation(), /could not be read/);
      assert.equal(values.get(KEY), raw);
    }
  }
  // Explicitly restoring a valid source unblocks normal operation; no hidden fallback was saved.
  memory.setItem(KEY, JSON.stringify(document));
  assert.deepEqual(await createPresetStorage(() => memory).load(), document);
});

test("restart preserves Use active Preset and resolves it to the selected custom preset", async () => {
  const { memory, storage, document } = setup(); await storage.save(setActivePreset(document, "kept"));
  const bindings = createBindingStorage(() => memory);
  await bindings.transact((current) => ({ ...current, global: { apiConfigId: "api" } }));
  const before = memory.getItem("veil.bindings.v1");
  for (let restart = 0; restart < 2; restart++) {
    const presets = createPresetStorage(() => memory), currentBindings = createBindingStorage(() => memory);
    await bootstrapCurrentProduct(presets, currentBindings, createRegexStorage(() => memory));
    assert.equal(memory.getItem("veil.bindings.v1"), before);
    const resolved = resolveBindings(await currentBindings.load(), null, "messages");
    assert.equal(resolved.presetId, undefined);
    assert.equal(presetForBinding(await presets.load(), resolved.presetId).id, "kept");
  }
});

test("restart preserves explicit Default and custom bindings while repairing only dangling preset IDs", async () => {
  const { memory, storage, document } = setup(); await storage.save(setActivePreset(document, "kept"));
  for (const choice of [null, BUILTIN_PRESET_ID, "deleted", "missing"]) {
    const bindings = createBindingStorage(() => memory);
    await bindings.transact(() => ({ global: { presetId: choice, apiConfigId: "api" }, characters: {} }));
    await bootstrapCurrentProduct(storage, bindings, createRegexStorage(() => memory));
    assert.deepEqual((await bindings.load()).global, { presetId: choice === "missing" ? BUILTIN_PRESET_ID : choice, apiConfigId: "api" });
    assert.equal((await storage.load()).activePresetId, "kept");
  }
});

test("a stale built-in refresh preserves custom preset content and active choice", async () => {
  const { memory, document, storage } = setup();
  document.presets[0].description = "Old VEIL default";
  memory.setItem(KEY, JSON.stringify(document));
  const current = await storage.load();
  assert.deepEqual(current.presets.slice(1), document.presets.slice(1));
  assert.equal(current.activePresetId, "deleted");
  assert.notEqual(current.presets[0].description, "Old VEIL default");
});

test("transaction refuses a changed raw document instead of overwriting an intervening writer", async () => {
  const { memory, storage, document } = setup(); await storage.save(document);
  const changed = renameKept(document);
  await assert.rejects(storage.transact((current) => {
    memory.setItem(KEY, JSON.stringify(changed));
    return setActivePreset(current, "kept");
  }), /changed elsewhere/);
  assert.deepEqual(await storage.load(), changed);
});

test("browser rollback fails closed without an origin-wide lock", async () => {
  const { memory, storage, document } = setup(); await storage.save(document);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { navigator: {} } });
  try {
    await assert.rejects(storage.rollbackIfCurrent(JSON.stringify(document), JSON.stringify(createPresetDocument())), /requires browser Web Locks/);
    assert.equal(memory.getItem(KEY), JSON.stringify(document));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("two storage clients refuse updates and rollback while another tab holds the browser lock", async () => {
  const { memory, storage, peer, document } = setup(); await storage.save(document);
  let held = false;
  let release!: () => void;
  const names: string[] = [];
  const locks = { async request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>): Promise<T> {
    names.push(name);
    assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true;
    try { return await callback({ name, mode: "exclusive" } as Lock); }
    finally { held = false; }
  } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  try {
    const pendingOwner = locks.request(KEY, { ifAvailable: true }, () => new Promise<void>((done) => { release = done; }));
    await Promise.resolve();
    await assert.rejects(peer.transact(renameKept), /busy in another tab/);
    await assert.rejects(storage.rollbackIfCurrent(JSON.stringify(document), JSON.stringify(createPresetDocument())), /busy in another tab/);
    assert.equal(memory.getItem(KEY), JSON.stringify(document), "neither mutation may run while another tab owns the lock");
    release(); await pendingOwner;
    assert.equal((await peer.transact(renameKept)).presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
    assert.equal(await storage.rollbackIfCurrent(JSON.stringify(document), JSON.stringify(createPresetDocument())), false);
    assert.equal((await storage.load()).presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
    assert(names.length >= 4 && names.every((name) => name === KEY));
  } finally {
    release?.();
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("concurrent calls on one storage instance queue instead of reporting another tab", async () => {
  const { storage, document } = setup(); await storage.save(document);
  let held = false;
  const locks = { async request<T>(_name: string, _options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>): Promise<T> {
    if (held) return callback(null);
    held = true;
    try { return await callback({ name: KEY, mode: "exclusive" } as Lock); }
    finally { held = false; }
  } };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  try {
    const results = await Promise.all([storage.load(), storage.load(), storage.transact(renameKept), storage.load()]);
    assert.equal(results.length, 4, "none of the same-tab calls was rejected as busy");
    assert.equal((await storage.load()).presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
