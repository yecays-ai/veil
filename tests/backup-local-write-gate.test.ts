import assert from "node:assert/strict";
import test from "node:test";
import { createBindingStorage } from "../lib/binding-storage";
import { addContact, createContactStorage } from "../lib/contact-storage";
import { createPresetStorage } from "../lib/preset-storage";
import { createPresetDocument } from "../lib/preset";
import { createRegexStorage } from "../lib/regex-storage";
import { emptyRegexDocument } from "../lib/regex";
import { createWorldBookStorage } from "../lib/worldbook-storage";
import { emptyWorldBookDocument } from "../lib/worldbook";
import { BackupCoordinator } from "../lib/backup/coordination";
import { createPersistenceWriteGate, type PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function memory() {
  const values = new Map<string, string>(); let writes = 0;
  return { values, get writes() { return writes; },
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) { writes++; values.set(key, value); },
    removeItem(key: string) { writes++; values.delete(key); } };
}
type Memory = ReturnType<typeof memory>;
type Scenario = { name: string; operation: (raw: Memory, gate: PersistenceWriteGate) => () => Promise<unknown> };
const scenarios: Scenario[] = [
  { name: "Bindings save", operation: (raw, gate) => () => createBindingStorage(() => raw, () => undefined, gate).save({ global: {}, characters: {} }) },
  { name: "Bindings update", operation: (raw, gate) => () => createBindingStorage(() => raw, () => undefined, gate).transact((value) => value) },
  { name: "Bindings reconciliation", operation: (raw, gate) => () => createBindingStorage(() => raw, () => undefined, gate).cleanStale(async (write) =>
    write({ apiConfigIds: new Set(), presetIds: new Set(), worldBookIds: new Set(), regexIds: new Set() })) },
  { name: "Contacts update", operation: (raw, gate) => () => createContactStorage(() => raw, () => undefined, gate).transact((value) => addContact(value, "test")) },
  { name: "Contacts portable restore", operation: (raw, gate) => () => createContactStorage(() => raw, () => undefined, gate).restorePortable('{"version":1,"contacts":[]}') },
  { name: "Preset first load", operation: (raw, gate) => () => createPresetStorage(() => raw, gate).load() },
  { name: "Preset canonical load", operation: (raw, gate) => {
    raw.values.set("veil.preset.v1", JSON.stringify(createPresetDocument(), null, 2));
    return () => createPresetStorage(() => raw, gate).load();
  } },
  { name: "Preset save", operation: (raw, gate) => () => createPresetStorage(() => raw, gate).save(createPresetDocument()) },
  { name: "Preset update", operation: (raw, gate) => () => createPresetStorage(() => raw, gate).transact((value) => value) },
  { name: "Preset rollback deletion", operation: (raw, gate) => {
    const saved = JSON.stringify(createPresetDocument()); raw.values.set("veil.preset.v1", saved);
    return () => createPresetStorage(() => raw, gate).rollbackIfCurrent(saved, null);
  } },
  { name: "Regex save", operation: (raw, gate) => () => createRegexStorage(() => raw, gate).save(emptyRegexDocument()) },
  { name: "Regex update", operation: (raw, gate) => () => createRegexStorage(() => raw, gate).transact((value) => value) },
  { name: "WorldBook save", operation: (raw, gate) => () => createWorldBookStorage(() => raw, gate).save(emptyWorldBookDocument()) },
  { name: "WorldBook update", operation: (raw, gate) => () => createWorldBookStorage(() => raw, gate).transact((value) => value) },
];

for (const scenario of scenarios) test(`${scenario.name} waits before modifying its source and releases after publication`, async () => {
  const entered = deferred(), permit = deferred(), raw = memory(); let released = false;
  const gate: PersistenceWriteGate = { async withWrite<T>(operation: () => Promise<T>) {
    entered.resolve(); await permit.promise;
    try { return await operation(); } finally { assert.equal(raw.writes, 1); released = true; }
  } };
  const operation = scenario.operation(raw, gate), before = new Map(raw.values);
  const pending = operation(); await entered.promise;
  assert.deepEqual(raw.values, before); assert.equal(raw.writes, 0); assert.equal(released, false);
  permit.resolve(); await pending; assert.equal(released, true); assert.equal(raw.writes, 1);
});

test("denied coordination leaves every local write source unchanged", async () => {
  const denied = new Error("Simulated coordination denied");
  const gate: PersistenceWriteGate = { withWrite: () => Promise.reject(denied) };
  for (const scenario of scenarios) {
    const raw = memory(), operation = scenario.operation(raw, gate), before = new Map(raw.values);
    await assert.rejects(operation(), (error) => error === denied);
    assert.deepEqual(raw.values, before); assert.equal(raw.writes, 0);
  }
});

test("an exclusive snapshot blocks all five local domains from another lock client", async () => {
  const origin = lockOrigin(), gate = createPersistenceWriteGate(() => origin.client());
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: origin.client() } });
  const raw = memory(), ready = deferred(), finish = deferred();
  const coordinator = new BackupCoordinator(origin.client());
  try {
    const capture = coordinator.withSnapshot(async () => { ready.resolve(); await finish.promise; });
    await ready.promise;
    const operations = [
      createBindingStorage(() => raw, () => origin.client(), gate).save({ global: {}, characters: {} }),
      createContactStorage(() => raw, () => origin.client(), gate).transact((value) => addContact(value, "test")),
      createPresetStorage(() => raw, gate).load(),
      createRegexStorage(() => raw, gate).save(emptyRegexDocument()),
      createWorldBookStorage(() => raw, gate).save(emptyWorldBookDocument()),
    ];
    await Promise.resolve(); assert.equal(raw.writes, 0); assert.equal(raw.values.size, 0);
    finish.resolve(); await capture; await Promise.all(operations);
    assert.equal(raw.writes, 5); assert.equal(raw.values.size, 5);
  } finally {
    finish.resolve();
    if (navigatorBefore) Object.defineProperty(globalThis, "navigator", navigatorBefore);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("a rejected local commit releases its shared lock and keeps the original bytes", async () => {
  const origin = lockOrigin(), gate = createPersistenceWriteGate(() => origin.client());
  const raw = memory(), store = createBindingStorage(() => raw, () => origin.client(), gate);
  await store.save({ global: {}, characters: {} }); const before = new Map(raw.values);
  const original = raw.setItem; raw.setItem = () => { throw new Error("Simulated quota"); };
  await assert.rejects(store.transact((value) => value), /quota/); assert.deepEqual(raw.values, before);
  assert.equal(await new BackupCoordinator(origin.client()).withSnapshot(async () => "released"), "released");
  raw.setItem = original; await store.transact((value) => value); assert.equal(raw.writes, 2);
});
