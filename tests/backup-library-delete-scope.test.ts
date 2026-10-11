import assert from "node:assert/strict";
import test from "node:test";
import { BackupCoordinator, BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { browserPersistenceWriteGate, createPersistenceWriteGate, runPersistenceWrite, withPersistenceWriteScope,
  type PersistenceWriteGate, type PersistenceWriteScope } from "../lib/backup/persistence-write-gate";
import { BackupValidationError } from "../lib/backup/format";
import { createBindingStorage, type BindingStorage } from "../lib/binding-storage";
import { createPresetStorage, deletePresetAndBindings } from "../lib/preset-storage";
import { BUILTIN_PRESET_ID, createPresetDocument } from "../lib/preset";
import { copyPreset } from "../lib/preset-library";
import { createRegexStorage, deleteRegexGroupAndBindings, browserRegexStorage } from "../lib/regex-storage";
import { newRegexGroup } from "../lib/regex";
import { createWorldBookStorage, deleteWorldBookAndBindings } from "../lib/worldbook-storage";
import { normalizeWorldBook } from "../lib/worldbook";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const kinds = ["preset", "regex", "worldbook"] as const;
async function fixture(kind: typeof kinds[number], gate: PersistenceWriteGate, locks: () => LockManager) {
  const values = new Map<string, string>();
  const raw = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const bindings = createBindingStorage(() => raw, locks, gate);
  const slot = kind === "preset" ? { presetId: "target" } : kind === "regex" ? { regexIds: ["target"] } : { worldBookIds: ["target"] };
  await bindings.save({ global: slot, characters: {} });
  if (kind === "preset") {
    const store = createPresetStorage(() => raw, gate);
    await store.save(copyPreset(createPresetDocument(), BUILTIN_PRESET_ID, "Target", "target"));
    return { bindings, present: async () => (await store.load()).presets.some((row) => row.id === "target"),
      remove: (target: BindingStorage) => deletePresetAndBindings("target", store, target, gate) };
  }
  if (kind === "regex") {
    const store = createRegexStorage(() => raw, gate);
    await store.save({ version: 1, groups: [{ ...newRegexGroup(), id: "target" }] });
    return { bindings, present: async () => (await store.load()).groups.some((row) => row.id === "target"),
      remove: (target: BindingStorage) => deleteRegexGroupAndBindings("target", store, target, undefined, () => {}, gate) };
  }
  const store = createWorldBookStorage(() => raw, gate);
  await store.save({ version: 1, books: [normalizeWorldBook({ name: "Target", entries: [] }, "target")] });
  return { bindings, present: async () => (await store.load()).books.some((row) => row.id === "target"),
    remove: (target: BindingStorage) => deleteWorldBookAndBindings("target", store, target, undefined, () => {}, gate) };
}

for (const kind of kinds) for (const fails of [false, true]) {
  test(`${kind}: queued snapshot waits for deletion and ${fails ? "failed cleanup rollback" : "Binding cleanup"} without a nested shared request`, async () => {
    const origin = lockOrigin(); let sharedRequests = 0;
    const manager = { request: ((...args: Parameters<LockManager["request"]>) => {
      if (args[0] === BACKUP_LOCK_NAME && (args[1] as LockOptions).mode === "shared") sharedRequests++;
      return origin.client().request(...args);
    }) as BackupLockManager["request"] };
    const gate = createPersistenceWriteGate(() => manager);
    const env = await fixture(kind, gate, () => origin.client());
    sharedRequests = 0;
    const entered = deferred(), finish = deferred(), failure = new Error("Simulated cleanup failure");
    const paused: BindingStorage = { ...env.bindings, async transact(update, scope) {
      entered.resolve(); await finish.promise;
      if (fails) throw failure;
      return env.bindings.transact(update, scope);
    } };
    const deleting = env.remove(paused);
    const settled = fails ? assert.rejects(deleting, (error) => error === failure) : deleting;
    await entered.promise;
    let captured = false, edited = false;
    const capture = new BackupCoordinator(manager).withSnapshot(async () => {
      captured = true;
      // Inspect raw authorities through the existing pure Binding read. Preset.load may write.
      const bound = JSON.stringify(await env.bindings.load()).includes("target");
      assert.equal(bound, fails);
      assert.equal(edited, false);
    });
    // Same Binding instance: this unscoped call must not reserve a queue slot that blocks the scope.
    const edit = env.bindings.transact((current) => { edited = true; return current; });
    await Promise.resolve(); assert.equal(captured, false); assert.equal(edited, false);
    assert.equal(sharedRequests, 2); // one outer deletion and the unrelated queued edit only.
    finish.resolve(); await settled; await capture; await edit;
    assert.equal(await env.present(), fails);
    assert.equal(captured, true); assert.equal(edited, true);
  });
}

test("forged, expired, failed and foreign-owner scopes cannot bypass a write gate", async () => {
  const gate = createPersistenceWriteGate(() => undefined), foreign = createPersistenceWriteGate(() => undefined);
  let saved!: PersistenceWriteScope, calls = 0;
  const operation = async () => { calls++; };
  await withPersistenceWriteScope(gate, async (scope) => {
    saved = scope;
    await runPersistenceWrite(gate, operation, scope);
    await assert.rejects(runPersistenceWrite(foreign, operation, scope), (error: unknown) =>
      error instanceof BackupValidationError && error.code === "invalid-write-scope");
  });
  for (const scope of [saved, {} as PersistenceWriteScope]) await assert.rejects(runPersistenceWrite(gate, operation, scope),
    (error: unknown) => error instanceof BackupValidationError && error.code === "invalid-write-scope");
  await assert.rejects(withPersistenceWriteScope(gate, async (scope) => { saved = scope; throw new Error("Simulated failure"); }));
  await assert.rejects(runPersistenceWrite(gate, operation, saved));
  assert.equal(calls, 1);
});

test("a child left pending cannot outlive the shared lease or silently fail after success", async () => {
  for (const fails of [false, true]) {
    const origin = lockOrigin(), gate = createPersistenceWriteGate(() => origin.client());
    const ready = deferred(), finish = deferred(), failure = new Error("Simulated child failure");
    const parent = withPersistenceWriteScope(gate, async (scope) => {
      void runPersistenceWrite(gate, async () => { ready.resolve(); await finish.promise; if (fails) throw failure; }, scope);
      await ready.promise;
    });
    const settled = fails ? assert.rejects(parent, (error) => error === failure) : parent;
    await ready.promise;
    let captured = false;
    const capture = new BackupCoordinator(origin.client()).withSnapshot(async () => { captured = true; });
    await Promise.resolve(); assert.equal(captured, false);
    finish.resolve(); await settled; await capture; assert.equal(captured, true);
  }
});

test("browser Regex initialization and deletion share the outer lease when an exclusive snapshot is queued", async () => {
  const origin = lockOrigin(), values = new Map<string, string>(), finish = deferred(), entered = deferred();
  values.set("veil.regex.v1", JSON.stringify({ version: 1, groups: [{ ...newRegexGroup(), id: "target" }] }));
  const raw = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const previous = new Map(["window", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: raw, navigator: { locks: origin.client() } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: origin.client() } });
  const bindings: BindingStorage = { ...createBindingStorage(() => raw, () => undefined),
    async transact(update, scope) { entered.resolve(); await finish.promise; return runPersistenceWrite(browserPersistenceWriteGate,
      async () => update({ global: { regexIds: ["target"] }, characters: {} }), scope); } };
  try {
    const deleting = deleteRegexGroupAndBindings("target", browserRegexStorage, bindings);
    await entered.promise;
    const capture = new BackupCoordinator(origin.client()).withSnapshot(async () => {
      assert.equal(JSON.parse(values.get("veil.regex.v1")!).groups.some((row: { id: string }) => row.id === "target"), false);
    });
    const loading = browserRegexStorage.load(); // its default initialization waits behind the snapshot.
    finish.resolve(); await deleting; await capture; await loading;
  } finally {
    finish.resolve();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
