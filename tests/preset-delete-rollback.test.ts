import assert from "node:assert/strict";
import test from "node:test";
import { createPresetStorage, deletePresetAndBindings } from "../lib/preset-storage";
import { BUILTIN_PRESET_ID, createPresetDocument } from "../lib/preset";
import { copyPreset, setActivePreset, updatePreset } from "../lib/preset-library";
import { createBindingStorage } from "../lib/binding-storage";

const KEY = "veil.preset.v1";
const cleanup = new Error("Binding save failed");

function setup() {
  const values = new Map<string, string>();
  let failWrites = false;
  const memory = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("Quota blocked");
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
  };
  const storage = createPresetStorage(() => memory), peer = createPresetStorage(() => memory);
  const document = setActivePreset(copyPreset(copyPreset(createPresetDocument(), BUILTIN_PRESET_ID,
    "Delete me", "deleted"), BUILTIN_PRESET_ID, "Keep me", "kept"), "deleted");
  return { memory, values, storage, peer, document, failWrites: (next: boolean) => { failWrites = next; } };
}
const rename = (document: ReturnType<typeof createPresetDocument>) =>
  updatePreset(document, { ...document.presets.find((p) => p.id === "kept")!, name: "Concurrent edit" });

// A lock manager in which a held lock makes ifAvailable requests see no lock, as in a real browser.
function fakeLocks() {
  let held = false;
  const locks = { async request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => T | Promise<T>): Promise<T> {
    if (name !== KEY) return callback({ name, mode: "exclusive" } as Lock); // other stores' locks are not under test
    assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true;
    try { return await callback({ name, mode: "exclusive" } as Lock); } finally { held = false; }
  } };
  return { locks, hold() {
    let release!: () => void;
    const owner = locks.request(KEY, { ifAvailable: true }, () => new Promise<void>((done) => { release = done; }));
    return { release: async () => { release(); await owner; } };
  } };
}
async function withGlobal<T>(name: string, value: unknown, run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  try { return await run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
}
const failing = { transact: async () => { throw cleanup; } };

test("cleanup failure with a working rollback restores the library and reports the original error", async () => {
  const { storage, document } = setup(); await storage.save(document);
  await assert.rejects(deletePresetAndBindings("deleted", storage, failing), (error) => error === cleanup);
  assert.deepEqual(await storage.load(), document);
});

test("P1: rollback blocked by another tab keeps the cleanup cause, says the Preset stays deleted, and a retry finishes", async () => {
  const { memory, storage, document } = setup(); await storage.save(document);
  const bindings = createBindingStorage(() => memory);
  await bindings.transact((current) => ({ ...current, global: { presetId: "deleted", apiConfigId: "keep-api" } }));
  const lock = fakeLocks();
  await withGlobal("navigator", { locks: lock.locks }, async () => {
    let owner!: { release: () => Promise<void> };
    const blocked = { transact: async () => { owner = lock.hold(); throw cleanup; } };
    await assert.rejects(deletePresetAndBindings("deleted", storage, blocked), (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /could not be restored \(Presets are busy in another tab/);
      assert.match(error.message, /stays deleted; delete it again/);
      assert.doesNotMatch(error.message, /Newer data was kept/);
      assert.equal(error.cause, cleanup);
      return true;
    });
    await owner.release();
    // The Preset was deleted, not restored, and the Binding still points at it.
    assert(!(await storage.load()).presets.some((p) => p.id === "deleted"));
    assert.equal((await bindings.load()).global.presetId, "deleted");
    // Deleting again is not "no longer exists": it completes the Binding cleanup.
    const result = await deletePresetAndBindings("deleted", storage, bindings);
    assert(!result.presets.some((p) => p.id === "deleted"));
    assert.deepEqual((await bindings.load()).global, { apiConfigId: "keep-api" });
  });
});

test("a snapshot conflict keeps the newer data, is the only case that says so, and keeps the cause", async () => {
  const { storage, peer, document } = setup(); await storage.save(document);
  const bindings = { transact: async () => { await peer.transact((current) => setActivePreset(rename(current), "kept")); throw cleanup; } };
  await assert.rejects(deletePresetAndBindings("deleted", storage, bindings), (error: unknown) => {
    assert(error instanceof Error);
    assert.match(error.message, /Newer data was kept/);
    assert.equal(error.cause, cleanup);
    return true;
  });
  const current = await peer.load();
  assert.equal(current.presets.find((p) => p.id === "kept")?.name, "Concurrent edit");
  assert.equal(current.activePresetId, "kept");
  assert(!current.presets.some((p) => p.id === "deleted"));
});

test("a storage failure during rollback is reported as not restored, with the cleanup cause", async () => {
  const { memory, storage, document, failWrites } = setup(); await storage.save(document);
  const bindings = { transact: async () => { failWrites(true); throw cleanup; } };
  await assert.rejects(deletePresetAndBindings("deleted", storage, bindings), (error: unknown) => {
    assert(error instanceof Error);
    assert.match(error.message, /could not be restored \(Quota blocked\)/);
    assert.doesNotMatch(error.message, /Newer data was kept/);
    assert.equal(error.cause, cleanup);
    return true;
  });
  failWrites(false);
  assert(!JSON.parse(memory.getItem(KEY)!).presets.some((p: { id: string }) => p.id === "deleted"));
});

test("a browser without Web Locks cannot roll back, says so, and keeps the cleanup cause", async () => {
  const { storage, document } = setup(); await storage.save(document);
  await withGlobal("window", { navigator: {} }, async () => {
    await assert.rejects(deletePresetAndBindings("deleted", storage, failing), (error: unknown) => {
      assert(error instanceof Error);
      assert.match(error.message, /could not be restored \(Safe Preset rollback requires browser Web Locks/);
      assert.equal(error.cause, cleanup);
      return true;
    });
  });
});

test("retrying after a failed rollback never overwrites data another tab saved meanwhile", async () => {
  const { storage, peer, document } = setup(); await storage.save(document);
  const lock = fakeLocks();
  await withGlobal("navigator", { locks: lock.locks }, async () => {
    let owner!: { release: () => Promise<void> };
    await assert.rejects(deletePresetAndBindings("deleted", storage, { transact: async () => { owner = lock.hold(); throw cleanup; } }), /stays deleted/);
    await owner.release();
    const newer = await peer.transact((current) => setActivePreset(rename(current), "kept"));
    await deletePresetAndBindings("deleted", storage, { transact: async () => undefined as never });
    assert.deepEqual(await peer.load(), newer);
  });
});

test("deleting an already-deleted Preset runs only the Binding cleanup, and a failing cleanup restores nothing", async () => {
  const { memory, storage, document } = setup(); await storage.save(document);
  await storage.transact((current) => ({ ...current, presets: current.presets.filter((p) => p.id !== "deleted"), activePresetId: BUILTIN_PRESET_ID }));
  const gone = await storage.load();
  await assert.rejects(deletePresetAndBindings("deleted", storage, failing), (error) => error === cleanup);
  assert.deepEqual(await storage.load(), gone, "no rollback ran against a Preset this call did not delete");
  const bindings = createBindingStorage(() => memory);
  await bindings.transact((current) => ({ ...current, global: { presetId: "deleted" } }));
  await deletePresetAndBindings("deleted", storage, bindings);
  assert.deepEqual((await bindings.load()).global, {});
  assert.deepEqual(await storage.load(), gone);
});

test("VEIL Default still cannot be deleted", async () => {
  const { storage, document } = setup(); await storage.save(document);
  await assert.rejects(deletePresetAndBindings(BUILTIN_PRESET_ID, storage, failing), /read-only/);
});
