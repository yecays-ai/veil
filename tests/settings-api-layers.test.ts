import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_API_CONFIG_ID } from "../lib/api-config";
import { setBindingField, withoutApiConfigBinding, type BindingDocument } from "../lib/bindings";
import { resolveMaintenanceModel } from "../lib/memory/maintenance-binding";
import { apiConfigReferences } from "../lib/settings/text-api";
import { defaultApiId, memoryApiState } from "../lib/settings/api-layers";

const config = (id: string, extra: Record<string, string> = {}) => ({ id, name: `API ${id}`, provider: "Custom" as const,
  baseUrl: "https://example.test/v1", apiKey: "stub-only", model: `model-${id}`, ...extra });
const ready = (state: ReturnType<typeof memoryApiState>) => { assert.equal(state.kind, "ready"); return state as Extract<typeof state, { kind: "ready" }>; };
const empty = (): BindingDocument => ({ global: {}, characters: {} });

test("Memory follows the Default API until a custom choice is made, and restoring inheritance follows it again", () => {
  const configs = [config(DEFAULT_API_CONFIG_ID), config("other")];
  let bindings = empty();
  assert.deepEqual(memoryApiState(bindings, configs), { kind: "ready", source: "default", id: DEFAULT_API_CONFIG_ID, name: `API ${DEFAULT_API_CONFIG_ID}`, model: `model-${DEFAULT_API_CONFIG_ID}` });
  // Changing the Default API moves Memory with it.
  bindings = setBindingField(bindings, {}, "apiConfigId", "other");
  assert.equal(defaultApiId(bindings), "other");
  assert.equal(ready(memoryApiState(bindings, configs)).id, "other");
  // A custom choice stays put when the Default changes.
  bindings = setBindingField(bindings, {}, "memoryApiConfigId", DEFAULT_API_CONFIG_ID);
  bindings = setBindingField(bindings, {}, "apiConfigId", undefined);
  assert.equal(ready(memoryApiState(bindings, configs)).source, "custom");
  // Restore inheritance.
  bindings = setBindingField(bindings, {}, "memoryApiConfigId", undefined);
  assert.equal(ready(memoryApiState(bindings, configs)).source, "default");
});

test("a missing, unusable or switched-off Memory API is reported and never replaced by another one", () => {
  const configs = [config(DEFAULT_API_CONFIG_ID), config("broken", { apiKey: "" })];
  const withMemory = (id: string | null) => setBindingField(empty(), {}, "memoryApiConfigId", id);
  assert.deepEqual(memoryApiState(withMemory(null), configs), { kind: "off" });
  assert.deepEqual(memoryApiState(withMemory("gone"), configs), { kind: "missing", source: "custom" });
  assert.equal(memoryApiState(withMemory("broken"), configs).kind, "invalid");
  assert.deepEqual(memoryApiState(setBindingField(empty(), {}, "apiConfigId", "gone"), configs), { kind: "missing", source: "default" });
  assert.deepEqual(memoryApiState(setBindingField(empty(), {}, "apiConfigId", null), configs), { kind: "off" });
});

test("the Settings choice and the runner agree, and a Character's own choice is kept", async () => {
  const read = async (id: string) => config(id);
  let bindings = setBindingField(empty(), {}, "memoryApiConfigId", "global-memory");
  assert.equal((await resolveMaintenanceModel(bindings, "c", read)).id, "global-memory");
  bindings = setBindingField(bindings, { characterId: "c" }, "memoryApiConfigId", "own");
  assert.equal((await resolveMaintenanceModel(bindings, "c", read)).id, "own");
  assert.equal((await resolveMaintenanceModel(bindings, "other-character", read)).id, "global-memory");
  // Character-level "follow the chat model" is untouched by the global layer: it still follows that Character's Text API.
  bindings = setBindingField(setBindingField(empty(), { characterId: "c" }, "apiConfigId", "char-text"), {}, "memoryApiConfigId", undefined);
  assert.equal((await resolveMaintenanceModel(bindings, "c", read)).id, "char-text");
  // A missing API fails; it does not fall back.
  await assert.rejects(resolveMaintenanceModel(setBindingField(empty(), {}, "memoryApiConfigId", "gone"), "c", async () => undefined), /missing/);
});

test("deleting an API disables, not redirects, every place that used it, and the delete prompt counts Memory uses", () => {
  let bindings = setBindingField(empty(), {}, "memoryApiConfigId", "x");
  bindings = setBindingField(bindings, { characterId: "c" }, "memoryApiConfigId", "x");
  bindings = setBindingField(bindings, { characterId: "c" }, "apiConfigId", "x");
  assert.deepEqual(apiConfigReferences(bindings, "x"), ["Global (Memory)", "Character c", "Character c (Memory)"]);
  const cleared = withoutApiConfigBinding(bindings, "x");
  assert.equal(cleared.global.memoryApiConfigId, null);
  assert.equal(cleared.characters.c.defaults.apiConfigId, null);
  assert.deepEqual(apiConfigReferences(cleared, "x"), []);
});
