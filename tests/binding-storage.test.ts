import assert from "node:assert/strict";
import test from "node:test";
import { BINDING_STORAGE_KEY, createBindingStorage } from "../lib/binding-storage";
import { createFoundationStorage } from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput, normalizeFoundation } from "../lib/foundation-types";
import { exportBackupV1 } from "../lib/backup/export";
import { restoreBackupV1 } from "../lib/backup/import";
import { validateBackupV1 } from "../lib/backup/validate";
import { normalizeDocument, type ThemeDocument } from "../lib/theme-types";
import { createPresetStorage } from "../lib/preset-storage";
import { ChatStorage } from "../lib/chat/storage";
import { IDBFactory } from "fake-indexeddb";

function fixture() {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const bindings = { global: { apiConfigId: null, worldBookIds: ["b", "a"], regexIds: ["global-regex"] },
    characters: { peter: { defaults: { regexIds: ["peter-default"] },
      apps: { messages: { presetId: "custom", regexIds: ["peter-message"] } } } } };
  const foundation = { ...defaultFoundation(),
    characters: [{ characterId: "peter", ...normalizeCharacterInput({ name: "Peter" }) }], bindings };
  values.set("veil.foundation.v1", JSON.stringify(foundation));
  return { values, backend, bindings, foundation };
}

test("legacy bindings migrate once, retain inheritance values and leave Foundation independent", async () => {
  const value = fixture(); const bindings = createBindingStorage(() => value.backend);
  const foundation = createFoundationStorage(() => value.backend);
  assert.equal(Object.hasOwn(normalizeFoundation(value.foundation), "bindings"), false);
  assert.equal(Object.hasOwn(await foundation.load(), "bindings"), false);
  assert.deepEqual(await bindings.load(), value.bindings);
  assert.deepEqual((await bindings.load()).characters.peter.defaults.regexIds,
    value.bindings.characters.peter.defaults.regexIds);
  assert.deepEqual((await bindings.load()).characters.peter.apps.messages!.regexIds,
    value.bindings.characters.peter.apps.messages.regexIds);
  assert.equal(Object.hasOwn(JSON.parse(value.values.get("veil.foundation.v1")!), "bindings"), false);
  await bindings.save({ global: { presetId: "changed" }, characters: {} });
  await foundation.transact((document) => ({ ...document, user: { ...document.user, name: "Edited" } }));
  assert.equal((await createBindingStorage(() => value.backend).load()).global.presetId, "changed");
});

test("failed migration writes preserve the legacy source and can safely retry", async () => {
  for (const failingKey of [BINDING_STORAGE_KEY, "veil.foundation.v1"]) {
    const value = fixture(); const original = value.values.get("veil.foundation.v1");
    const storage = createBindingStorage(() => ({ ...value.backend, setItem(key, raw) {
      if (key === failingKey) throw new Error("quota"); value.backend.setItem(key, raw);
    } }));
    await assert.rejects(storage.load(), /quota/);
    assert.equal(value.values.get("veil.foundation.v1"), original);
    assert.deepEqual(await createBindingStorage(() => value.backend).load(), value.bindings);
  }
});

test("independent bindings win over residual legacy data without resetting profiles", async () => {
  const value = fixture(); const current = { global: { presetId: null }, characters: {} };
  value.values.set(BINDING_STORAGE_KEY, JSON.stringify(current));
  assert.deepEqual(await createBindingStorage(() => value.backend).load(), current);
  const expected = normalizeFoundation(value.foundation);
  assert.deepEqual(await createFoundationStorage(() => value.backend).load(), expected);
});

test("backup independently round-trips bindings, accepts legacy embedded bindings and rolls back failures", async () => {
  const original = fixture();
  const themeStorage = (backend: typeof original.backend) => ({
    load: async () => normalizeDocument(JSON.parse(backend.getItem("test.theme") ?? "null")),
    readRaw: async () => backend.getItem("test.theme"),
    async replaceIfCurrent(expected: string | null, document: ThemeDocument) {
      assert.equal(backend.getItem("test.theme"), expected);
      const raw = JSON.stringify(document); backend.setItem("test.theme", raw); return raw;
    },
    async rollbackIfCurrent(expected: string, previous: string | null) {
      if (backend.getItem("test.theme") !== expected) return false;
      if (previous === null) backend.removeItem("test.theme"); else backend.setItem("test.theme", previous);
      return true;
    },
  });
  const sources = (backend: typeof original.backend) => ({
    foundation: createFoundationStorage(() => backend), bindings: createBindingStorage(() => backend),
    theme: themeStorage(backend), preset: createPresetStorage(() => backend),
    chat: new ChatStorage(() => new IDBFactory()),
  });
  const source = sources(original.backend);
  const exported = await exportBackupV1(source);
  assert.deepEqual(exported.backup.bindings, original.bindings);
  assert.equal(Object.hasOwn(exported.backup.foundation, "bindings"), false);
  const legacy = { ...exported.backup,
    foundation: { ...exported.backup.foundation, bindings: original.bindings } };
  delete legacy.bindings;
  assert.deepEqual(validateBackupV1(legacy).bindings, original.bindings);
  const target = fixture(); target.values.clear(); const restored = sources(target.backend);
  await restoreBackupV1(exported.backup, restored);
  assert.deepEqual(await restored.bindings.load(), original.bindings);
  await restored.bindings.save({ global: { presetId: null }, characters: {} });
  const before = await restored.bindings.readRaw();
  await assert.rejects(restoreBackupV1(exported.backup, { ...restored,
    chat: { exportBackup: () => restored.chat.exportBackup(), replaceBackup: async () => { throw new Error("chat failure"); } } }, true), /chat failure/);
  assert.equal(await restored.bindings.readRaw(), before);
});
