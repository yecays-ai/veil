import assert from "node:assert/strict";
import test from "node:test";
import { createRegexStorage, deleteRegexGroupAndBindings } from "../lib/regex-storage";
import { newRegexGroup, newRegexRule, type RegexDocument } from "../lib/regex";
import { createWorldBookStorage, deleteWorldBookAndBindings } from "../lib/worldbook-storage";
import { normalizeWorldBook, selectBoundWorldBooks, type WorldBookDocument } from "../lib/worldbook";
import { createBindingStorage } from "../lib/binding-storage";
import type { StringStorage } from "../lib/storage-types";

function memory() {
  const values = new Map<string, string>();
  let fail = false;
  const raw: StringStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error("Quota blocked"); values.set(key, value); },
  };
  return { raw, values, fail: (next: boolean) => { fail = next; } };
}
type Adapter<D> = { load(): Promise<D>; save(document: D, expected?: D): Promise<void>;
  transact(update: (current: D) => D, expected?: D): Promise<D> };
function storageCases<D>(name: string, key: string, fixture: (raw: StringStorage) => {
  adapter: Adapter<D>; document: D; edit: (current: D) => D; editTarget: (current: D) => D; drop: (current: D) => D;
  remove: (adapter: Adapter<D>, bindings: ReturnType<typeof createBindingStorage>, expected?: D) => Promise<D>;
}) {
  test(`${name}: two clients reject stale replacement, update and deletion without touching the newer document`, async () => {
    const { raw } = memory(), first = fixture(raw), peer = fixture(raw);
    await first.adapter.save(first.document);
    const old = await first.adapter.load(), other = await peer.adapter.load();
    const updated = await peer.adapter.transact(peer.edit, other);
    await assert.rejects(first.adapter.save(first.edit(old), old), /changed elsewhere/);
    await assert.rejects(first.adapter.transact(first.edit, old), /changed elsewhere/);
    const bindings = createBindingStorage(() => raw);
    await assert.rejects(first.remove(first.adapter, bindings, old), /changed elsewhere/);
    assert.deepEqual(await peer.adapter.load(), updated);
    assert.deepEqual(await bindings.load(), { global: {}, characters: {} });
  });
  test(`${name}: a deleted target cannot be silently saved or resurrected by an old editor`, async () => {
    const { raw } = memory(), first = fixture(raw), peer = fixture(raw);
    await first.adapter.save(first.document); const old = await first.adapter.load();
    const removed = await peer.adapter.transact(peer.drop, old);
    await assert.rejects(first.adapter.transact(first.edit, old), /deleted/);
    await assert.rejects(first.adapter.save(old, old), /deleted/);
    assert.deepEqual(await peer.adapter.load(), removed);
  });
  test(`${name}: write failure keeps the old data and the same draft can be manually retried`, async () => {
    const { raw, values, fail } = memory(), first = fixture(raw);
    await first.adapter.save(first.document);
    const old = await first.adapter.load(), draft = first.edit(old), before = values.get(key);
    fail(true); await assert.rejects(first.adapter.save(draft, old), /Quota blocked/);
    assert.equal(values.get(key), before); assert.deepEqual(await first.adapter.load(), old);
    fail(false); await first.adapter.save(draft, old);
    assert.deepEqual(await fixture(raw).adapter.load(), draft);
  });
  test(`${name}: a writer intervening inside a transaction is preserved`, async () => {
    const { raw } = memory(), first = fixture(raw);
    await first.adapter.save(first.document); const old = await first.adapter.load();
    const peerUpdate = first.edit(old);
    await assert.rejects(first.adapter.transact((current) => {
      raw.setItem(key, JSON.stringify(peerUpdate)); return first.drop(current);
    }, old), /changed while saving/);
    assert.deepEqual(await first.adapter.load(), peerUpdate);
  });
  test(`${name}: failed Binding cleanup rolls back the actual deletion snapshot, not an earlier read`, async () => {
    const { raw } = memory(), first = fixture(raw), peer = fixture(raw);
    await first.adapter.save(first.document);
    const interleaved: Adapter<D> = { ...first.adapter, transact: async (update, expected) => {
      await peer.adapter.transact(peer.editTarget);
      return first.adapter.transact(update, expected);
    } };
    const bindings = { ...createBindingStorage(() => raw), transact: async () => { throw new Error("Binding unavailable"); } };
    await assert.rejects(first.remove(interleaved, bindings), /Binding unavailable/);
    assert.deepEqual(await peer.adapter.load(), peer.editTarget(first.document));
  });
  test(`${name}: failed cleanup cannot roll back across a newer post-delete update`, async () => {
    const { raw } = memory(), first = fixture(raw), peer = fixture(raw);
    await first.adapter.save(first.document);
    const cleanup = new Error("Binding unavailable");
    const bindings = { ...createBindingStorage(() => raw), transact: async () => {
      await peer.adapter.transact(peer.edit); throw cleanup;
    } };
    await assert.rejects(first.remove(first.adapter, bindings), (error: unknown) => {
      assert(error instanceof Error); assert.match(error.message, /Newer data was kept/);
      assert.equal(error.cause, cleanup); return true;
    });
    assert.deepEqual(await peer.adapter.load(), peer.edit(peer.drop(first.document)));
  });
  test(`${name}: failed cleanup reports rollback storage failure without inventing a newer version`, async () => {
    const { raw, fail } = memory(), first = fixture(raw);
    await first.adapter.save(first.document);
    const cleanup = new Error("Binding unavailable");
    const bindings = { ...createBindingStorage(() => raw), transact: async () => { fail(true); throw cleanup; } };
    await assert.rejects(first.remove(first.adapter, bindings), (error: unknown) => {
      assert(error instanceof Error); assert.match(error.message, /could not be restored.*Quota blocked/);
      assert.doesNotMatch(error.message, /Newer data was kept/); assert.equal(error.cause, cleanup); return true;
    });
    fail(false); assert.deepEqual(await first.adapter.load(), first.drop(first.document));
  });
  test(`${name}: failed cleanup reports rollback lock contention and retains the Binding error cause`, async () => {
    const { raw } = memory(), first = fixture(raw);
    await first.adapter.save(first.document);
    const cleanup = new Error("Binding unavailable");
    let release!: () => void, active: Promise<void> | undefined;
    let startedResolve!: () => void;
    const started = new Promise<void>((done) => { startedResolve = done; });
    const bindings = { ...createBindingStorage(() => raw), transact: async () => {
        active = navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
          assert(lock); startedResolve(); await new Promise<void>((finish) => { release = finish; });
        }).then(() => {});
        await started; throw cleanup;
    } };
    const pending = first.remove(first.adapter, bindings);
    try {
      await started;
      await assert.rejects(pending, (error: unknown) => {
        assert(error instanceof Error); assert.match(error.message, /could not be restored.*saved elsewhere/);
        assert.doesNotMatch(error.message, /Newer data was kept/); assert.equal(error.cause, cleanup); return true;
      });
    } finally { release?.(); await active; }
    assert.deepEqual(await first.adapter.load(), first.drop(first.document));
  });
}

storageCases<RegexDocument>("Regex", "veil.regex.v1", (raw) => {
  const first = { ...newRegexGroup(), id: "first", rules: [{ ...newRegexRule(), id: "rule", find: "old" }] };
  const kept = { ...newRegexGroup(), id: "kept" };
  return { adapter: createRegexStorage(() => raw), document: { version: 1, groups: [first, kept] },
    edit: (current) => ({ ...current, groups: current.groups.map((g) => g.id === "kept" ? { ...g, name: "Newer" } : g) }),
    editTarget: (current) => ({ ...current, groups: current.groups.map((g) => g.id === "first" ? { ...g, name: "Newer target" } : g) }),
    drop: (current) => ({ ...current, groups: current.groups.filter((g) => g.id !== "first") }),
    remove: (adapter, bindings, expected) => deleteRegexGroupAndBindings("first", adapter, bindings, expected) };
});
storageCases<WorldBookDocument>("WorldBook", "veil.worldbooks.v1", (raw) => {
  const first = normalizeWorldBook({ name: "First", entries: [{ content: "old" }] }, "first");
  const kept = normalizeWorldBook({ name: "Kept", entries: [] }, "kept");
  return { adapter: createWorldBookStorage(() => raw), document: { version: 1, books: [first, kept] },
    edit: (current) => ({ ...current, books: current.books.map((b) => b.id === "kept" ? { ...b, name: "Newer" } : b) }),
    editTarget: (current) => ({ ...current, books: current.books.map((b) => b.id === "first" ? { ...b, name: "Newer target" } : b) }),
    drop: (current) => ({ ...current, books: current.books.filter((b) => b.id !== "first") }),
    remove: (adapter, bindings, expected) => deleteWorldBookAndBindings("first", adapter, bindings, expected) };
});

test("WorldBook safe save and deletion retain ordered Binding selection", async () => {
  const { raw } = memory(), storage = createWorldBookStorage(() => raw), bindings = createBindingStorage(() => raw);
  const books = ["a", "b", "c"].map((id) => normalizeWorldBook({ name: id, entries: [] }, id));
  await storage.save({ version: 1, books });
  await bindings.save({ global: { worldBookIds: ["c", "a", "b"] }, characters: {} });
  const old = await storage.load();
  await storage.transact((current) => ({ ...current, books: [...current.books].reverse() }), old);
  assert.deepEqual(selectBoundWorldBooks((await storage.load()).books, (await bindings.load()).global.worldBookIds).map((b) => b.id), ["c", "a", "b"]);
  await deleteWorldBookAndBindings("a", storage, bindings, await storage.load());
  assert.deepEqual((await bindings.load()).global.worldBookIds, ["c", "b"]);
  assert.deepEqual(selectBoundWorldBooks((await storage.load()).books, (await bindings.load()).global.worldBookIds).map((b) => b.id), ["c", "b"]);
});
