import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { ApiConfigStorage, ApiConfigConflictError } from "../lib/api-config-storage";
import { deleteApiConfigAndBindings } from "../lib/settings/text-api";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createIndexedDBFoundationStorage } from "../lib/foundation-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import { deleteCharacter, updateCharacter } from "../lib/foundation";

const config = { id: "api", name: "Original", provider: "Custom" as const,
  baseUrl: "https://example.test/v1", apiKey: "test-only", model: "test" };

test("two editors compare the Text API baseline inside the write transaction", async () => {
  const factory = new IDBFactory(), a = new ApiConfigStorage(() => factory), b = new ApiConfigStorage(() => factory);
  await a.saveApiConfig(config);
  const baseline = (await a.getApiConfig(config.id))!;
  const results = await Promise.allSettled([
    a.saveApiConfig({ ...baseline, name: "A" }, baseline),
    b.saveApiConfig({ ...baseline, name: "B" }, baseline),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof ApiConfigConflictError);
  const current = (await b.getApiConfig(config.id))!;
  assert.equal((await a.saveApiConfig({ ...current, model: "retry" }, current)).model, "retry");
  assert.equal((await b.getApiConfig(config.id))?.name, current.name);
});

test("a deleted Text API cannot be resurrected by a stale editor; create refuses an occupied id", async () => {
  const factory = new IDBFactory(), a = new ApiConfigStorage(() => factory), b = new ApiConfigStorage(() => factory);
  await a.saveApiConfig(config, null);
  await b.deleteApiConfig(config.id, config);
  await assert.rejects(a.saveApiConfig({ ...config, name: "Stale" }, config), ApiConfigConflictError);
  assert.equal(await b.getApiConfig(config.id), undefined);
  await b.saveApiConfig(config, null);
  await assert.rejects(a.saveApiConfig({ ...config, name: "Collision" }, null), ApiConfigConflictError);
  assert.deepEqual(await b.getApiConfig(config.id), config);
});

test("stale Text API deletion does not remove a concurrent edit or start association cleanup", async () => {
  const factory = new IDBFactory(), a = new ApiConfigStorage(() => factory), b = new ApiConfigStorage(() => factory);
  await a.saveApiConfig(config);
  await b.saveApiConfig({ ...config, name: "Updated" }, config);
  let cleanupCalls = 0;
  await assert.rejects(deleteApiConfigAndBindings(config.id, a,
    { transact: async () => { cleanupCalls++; throw new Error("must not execute"); } }, config), ApiConfigConflictError);
  assert.equal(cleanupCalls, 0);
  assert.equal((await b.getApiConfig(config.id))?.name, "Updated");
});

test("failed Text API deletion restores atomically only if the id remains absent", async () => {
  for (const recreate of [false, true]) {
    const factory = new IDBFactory(), a = new ApiConfigStorage(() => factory), b = new ApiConfigStorage(() => factory);
    await a.saveApiConfig(config);
    await assert.rejects(deleteApiConfigAndBindings(config.id, a, { transact: async () => {
      if (recreate) await b.saveApiConfig({ ...config, name: "Newer" }, null);
      throw new Error("cleanup failed");
    } }), recreate ? /Newer data was kept/ : /cleanup failed/);
    assert.equal((await b.getApiConfig(config.id))?.name, recreate ? "Newer" : config.name);
  }
});

test("Text API failed put retains durable data and can retry with the same baseline", async (context) => {
  const factory = new IDBFactory(), storage = new ApiConfigStorage(() => factory);
  await storage.saveApiConfig(config);
  const original = IDBObjectStore.prototype.put;
  let fail = true;
  context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
    if (fail) { fail = false; throw new Error("quota failure"); }
    return original.apply(this, args);
  });
  const next = { ...config, name: "Draft" };
  await assert.rejects(storage.saveApiConfig(next, config), /quota failure/);
  assert.deepEqual(await storage.getApiConfig(config.id), config);
  await storage.saveApiConfig(next, config);
  assert.deepEqual(await storage.getApiConfig(config.id), next);
});

async function characters() {
  const factory = new IDBFactory(), documents = new IndexedDBDocumentStorage(() => factory);
  const a = createIndexedDBFoundationStorage(documents), b = createIndexedDBFoundationStorage(documents);
  const initial = normalizeFoundation({ characters: [{ characterId: "p", name: "Peter" }, { characterId: "q", name: "Pep" }] });
  await a.transact(() => initial);
  return { a, b, documents, initial, baseline: initial.characters[0] };
}

test("Character CAS retry rejects the stale form after an interleaved edit", async () => {
  const { b, documents, baseline } = await characters();
  let interleave = true;
  const a = createIndexedDBFoundationStorage({ ...documents,
    read: async (key) => {
      const old = await documents.read(key);
      if (interleave) { interleave = false; await b.transact((current) =>
        updateCharacter(current, "p", { ...baseline, personality: "newer personality" }, baseline)); }
      return old;
    },
    putIfAbsent: documents.putIfAbsent.bind(documents), replaceIfCurrent: documents.replaceIfCurrent.bind(documents),
    rollbackIfCurrent: documents.rollbackIfCurrent.bind(documents),
  });
  await assert.rejects(a.transact((current) => updateCharacter(current, "p", { ...baseline, name: "Old form" }, baseline)), /changed elsewhere/);
  assert.equal((await b.load()).characters[0].personality, "newer personality");
  assert.equal((await b.load()).characters[0].name, "Peter");
});

test("Character edits merge unrelated updates and never resurrect a deleted identity", async () => {
  const { a, b, baseline } = await characters();
  await b.transact((current) => ({ ...current, user: { ...current.user, name: "New user" },
    characters: current.characters.map((c) => c.characterId === "q" ? { ...c, name: "Other character" } : c) }));
  const saved = await a.transact((current) => updateCharacter(current, "p", { ...baseline, name: "Saved" }, baseline));
  assert.equal(saved.user.name, "New user");
  assert.equal(saved.characters[1].name, "Other character");
  await b.transact((current) => deleteCharacter(current, "p", saved.characters[0]));
  await assert.rejects(a.transact((current) => updateCharacter(current, "p", baseline, saved.characters[0])), /not found/);
  assert.equal((await b.load()).characters.some((c) => c.characterId === "p"), false);
});

test("stale Character deletion refuses a newer record; failed persistence permits explicit retry", async () => {
  const { a, b, documents, baseline } = await characters();
  const updated = { ...baseline, name: "Current" };
  await b.transact((current) => updateCharacter(current, "p", updated, baseline));
  await assert.rejects(a.transact((current) => deleteCharacter(current, "p", baseline)), /was not deleted/);
  let fail = true;
  const failing = createIndexedDBFoundationStorage({
    read: documents.read.bind(documents), putIfAbsent: documents.putIfAbsent.bind(documents),
    rollbackIfCurrent: documents.rollbackIfCurrent.bind(documents),
    replaceIfCurrent: (...args) => { if (fail) { fail = false; return Promise.reject(new Error("write failed")); }
      return documents.replaceIfCurrent(...args); },
  });
  const draft = { ...updated, name: "Retry draft" };
  await assert.rejects(failing.transact((current) => updateCharacter(current, "p", draft, updated)), /write failed/);
  assert.equal((await b.load()).characters[0].name, "Current");
  await failing.transact((current) => updateCharacter(current, "p", draft, updated));
  assert.equal((await b.load()).characters[0].name, "Retry draft");
});
