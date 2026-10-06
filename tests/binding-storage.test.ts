import assert from "node:assert/strict";
import test from "node:test";
import { BINDING_STORAGE_KEY, createBindingStorage } from "../lib/binding-storage";
import { normalizeBindings, resolveBindings } from "../lib/bindings";

function backend() {
  const values = new Map<string, string>();
  return { values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test("the current Binding document persists independently and resolves Messages defaults", async () => {
  const local = backend();
  const storage = createBindingStorage(() => local);
  const current = { global: { apiConfigId: "chat-default", presetId: "veil-default-v1" },
    characters: { peter: { defaults: { regexIds: ["default-rules"] }, apps: {} } } };
  await storage.save(current);
  assert.equal(local.values.has(BINDING_STORAGE_KEY), true);
  assert.deepEqual(await createBindingStorage(() => local).load(), current);
  assert.deepEqual(resolveBindings(current, null, "messages"), current.global);
  assert.deepEqual(resolveBindings(current, "peter", "messages"), {
    ...current.global, regexIds: ["default-rules"],
  });
});

test("normalization retains current resources and filters unregistered app overrides", () => {
  const normalized = normalizeBindings({ global: { presetId: "veil-default-v1" },
    characters: { peter: { defaults: { apiConfigId: "api" }, apps: {
      messages: { regexIds: ["default-rules"] }, removedApp: { presetId: "ignored" },
    } } } }, ["peter"]);
  assert.deepEqual(normalized, { global: { presetId: "veil-default-v1" },
    characters: { peter: { defaults: { apiConfigId: "api" }, apps: {
      messages: { regexIds: ["default-rules"] },
    } } } });
});
