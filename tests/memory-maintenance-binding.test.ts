import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { resolveMaintenanceModel } from "../lib/memory/maintenance-binding";
import { normalizeBindings, withoutApiConfigBinding, cleanStaleBindings, type BindingDocument } from "../lib/bindings";
import { buildUsageBaselineRecord, appendUsageBaseline, readUsageBaseline } from "../lib/chat/usage-baseline";
import { backupData, packageFixture } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { restoreIntoEmpty } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";

test("maintenance defaults to actual Messages binding, explicit model is independent and failures never fall back", async () => {
  const doc: BindingDocument = { global: { apiConfigId: "global" }, characters: {
    c: { defaults: { apiConfigId: "character" }, apps: { messages: { apiConfigId: "chat" } } } } };
  const requests: string[] = [];
  const read = async (id: string) => { requests.push(id); return id === "missing" ? null : {
    id, model: id, baseUrl: "https://example.test", apiKey: id === "invalid" ? "" : "test" }; };
  assert.equal((await resolveMaintenanceModel(doc, "c", read)).id, "chat");
  doc.characters.c.defaults.memoryApiConfigId = "cheap";
  assert.equal((await resolveMaintenanceModel(doc, "c", read)).id, "cheap");
  assert.equal(doc.characters.c.apps.messages?.apiConfigId, "chat");
  for (const id of ["missing", "invalid"]) {
    doc.characters.c.defaults.memoryApiConfigId = id; requests.length = 0;
    await assert.rejects(resolveMaintenanceModel(doc, "c", read)); assert.deepEqual(requests, [id]);
  }
  doc.characters.c.defaults.memoryApiConfigId = null; requests.length = 0;
  await assert.rejects(resolveMaintenanceModel(doc, "c", read)); assert.deepEqual(requests, []);
  doc.characters.c.defaults.memoryApiConfigId = "cheap";
  await assert.rejects(resolveMaintenanceModel(doc, "c", async () => ({ id: "wrong", model: "wrong", apiKey: "test", baseUrl: "https://example.test" })));
});

test("maintenance binding normalization, stale cleanup and API deletion preserve explicit disable without inheritance", () => {
  const doc = normalizeBindings({ global: { memoryApiConfigId: "cheap" }, characters: {
    c: { defaults: { apiConfigId: "chat", memoryApiConfigId: "cheap" }, apps: {} } } }, ["c"]);
  assert.equal(doc.characters.c.defaults.memoryApiConfigId, "cheap");
  assert.equal(withoutApiConfigBinding(doc, "cheap").characters.c.defaults.memoryApiConfigId, null);
  assert.equal(withoutApiConfigBinding(doc, "cheap").characters.c.defaults.apiConfigId, "chat");
  const cleaned = cleanStaleBindings(doc, { apiConfigIds: new Set(["chat"]), presetIds: new Set(), worldBookIds: new Set(), regexIds: new Set() });
  assert.equal(cleaned.global.memoryApiConfigId, null); assert.equal(cleaned.characters.c.defaults.memoryApiConfigId, null);
});

test("maintenance bindings validate and restore with stable IDs; missing resources are rejected", async () => {
  const data = backupData(), id = data.apiConfigs[0].id;
  data.bindings!.global.memoryApiConfigId = id;
  const f = await packageFixture(data);
  await validateBackupPackage(JSON.stringify(f.manifest), f.files);
  const raw = new Map<string, string>(), device = { indexedDB: new IDBFactory(), localStorage: {
    getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); },
    removeItem: (key: string) => { raw.delete(key); } } };
  await restoreIntoEmpty(JSON.stringify(f.manifest), f.files, device, lockOrigin().client());
  const snapshot = await readStaticBackupSource(device);
  assert.equal((snapshot.documents.bindings as BindingDocument).global.memoryApiConfigId, id);
  data.bindings!.global.memoryApiConfigId = "missing";
  const invalid = await packageFixture(data);
  await assert.rejects(validateBackupPackage(JSON.stringify(invalid.manifest), invalid.files));
});

test("maintenance M0 source records numeric usage without content and does not imply a paid stub request", () => {
  const values = new Map<string, string>(), store = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const record = buildUsageBaselineRecord({ model: "configured-model", messages: [{ content: "private fact" }] }, "memory-maintenance", "completed", 10,
    { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 });
  appendUsageBaseline(record, store);
  assert.equal(readUsageBaseline(store)[0].source, "memory-maintenance");
  assert.equal(readUsageBaseline(store)[0].totalTokens, 120);
  assert.ok(!JSON.stringify([...values.values()]).includes("private fact"));
});
