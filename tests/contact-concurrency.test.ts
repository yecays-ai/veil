import assert from "node:assert/strict";
import test from "node:test";
import { addContact, createContactStorage, removeContact, updateContact } from "../lib/contact-storage";

const KEY = "veil.contacts.v1";
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=";

// Shared "browser profile": one backing map and one origin-wide FIFO exclusive lock queue.
function origin() {
  const values = new Map<string, string>();
  let tail: Promise<unknown> = Promise.resolve();
  const requests: string[] = [];
  const locks = { request: (async (name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
    requests.push(name);
    const run = tail.then(() => callback({ name }), () => callback({ name }));
    tail = run.then(() => {}, () => {});
    return run;
  }) as unknown as LockManager["request"] };
  const backend = (hooks: { afterFirstRead?: () => void; failWrites?: () => boolean } = {}) => ({
    getItem: (key: string) => { const value = values.get(key) ?? null; if (hooks.afterFirstRead) { const run = hooks.afterFirstRead; hooks.afterFirstRead = undefined; run(); } return value; },
    setItem: (key: string, value: string) => { if (hooks.failWrites?.()) throw new Error("Quota exceeded"); values.set(key, value); },
  });
  const tab = (hooks: Parameters<typeof backend>[0] = {}, withLocks = true) =>
    createContactStorage(() => backend(hooks), withLocks ? () => locks : () => undefined);
  const read = () => JSON.parse(values.get(KEY) ?? '{"contacts":[]}').contacts as Array<{ characterId: string; remark: string | null; heroBackground: string | null }>;
  return { values, locks, requests, tab, read, backend };
}
const seed = async (tab: ReturnType<ReturnType<typeof origin>["tab"]>) =>
  tab.transact((d) => addContact(addContact(d, "peter", 1), "lan", 1));

test("every write takes the origin-wide Contacts lock and starts from the latest stored document", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  // Another tab holds the lock, reads, and writes its own change before releasing.
  const holder = o.locks.request(KEY, { mode: "exclusive" }, async () => {
    await held;
    o.values.set(KEY, JSON.stringify({ version: 1, contacts: [...o.read(), { id: "x", characterId: "zed", createdAt: 2, remark: null, heroBackground: null, lastRemarkChange: null }] }));
  });
  const pending = b.transact((d) => updateContact(d, "peter", { remark: "Simba", heroBackground: null }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(o.read().find((c) => c.characterId === "peter")!.remark, null, "write waits for the lock holder");
  release(); await holder; await pending;
  assert.deepEqual(o.read().map((c) => [c.characterId, c.remark]), [["peter", "Simba"], ["lan", null], ["zed", null]]);
  assert(o.requests.every((name) => name === KEY));
});

test("concurrent changes to different Contacts from several tabs are all kept", async () => {
  const o = origin(); const tabs = [o.tab(), o.tab(), o.tab()];
  await seed(tabs[0]);
  await Promise.all([
    tabs[0].transact((d) => updateContact(d, "peter", { remark: "P", heroBackground: null })),
    tabs[1].transact((d) => updateContact(d, "lan", { remark: "L", heroBackground: image })),
    tabs[2].transact((d) => addContact(d, "new", 5)),
  ]);
  const rows = Object.fromEntries(o.read().map((c) => [c.characterId, c]));
  assert.equal(rows.peter.remark, "P"); assert.equal(rows.lan.remark, "L");
  assert.equal(rows.lan.heroBackground, image); assert.ok(rows.new);
});

test("same Contact: editing different fields merges; the same field is last-committed-wins", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a);
  const base = { remark: null, heroBackground: null };
  // Both editors opened on the same snapshot. A renames, B only changes the background.
  await a.transact((d) => updateContact(d, "peter", { remark: "Simba", heroBackground: null }, 10, base));
  await b.transact((d) => updateContact(d, "peter", { remark: "", heroBackground: image }, 20, base));
  let peter = o.read().find((c) => c.characterId === "peter")!;
  assert.equal(peter.remark, "Simba", "B did not touch the remark, so A's rename survives");
  assert.equal(peter.heroBackground, image);
  // Both rename from the same base: the later commit wins and the change event reflects the real previous value.
  await a.transact((d) => updateContact(d, "peter", { remark: "First", heroBackground: image }, 30, { remark: "Simba", heroBackground: image }));
  await b.transact((d) => updateContact(d, "peter", { remark: "Second", heroBackground: image }, 40, { remark: "Simba", heroBackground: image }));
  const stored = JSON.parse(o.values.get(KEY)!).contacts[0];
  assert.equal(stored.remark, "Second");
  assert.deepEqual(stored.lastRemarkChange, { type: "remark-changed", fromRemark: "First", toRemark: "Second", createdAt: 40 });
  peter = o.read()[0]; assert.equal(peter.heroBackground, image);
});

test("delete versus update: delete wins, an update to a removed Contact fails without resurrecting it", async () => {
  const o = origin(); const a = o.tab(), b = o.tab();
  await seed(a);
  const results = await Promise.allSettled([
    a.transact((d) => removeContact(d, "peter")),
    b.transact((d) => updateContact(d, "peter", { remark: "Late", heroBackground: null })),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(String((results[1] as PromiseRejectedResult).reason), /Contact not found/);
  assert.deepEqual(o.read().map((c) => c.characterId), ["lan"]);
  // Update first, then delete: the Contact is gone, and a repeated delete is harmless.
  await a.transact((d) => updateContact(d, "lan", { remark: "Ok", heroBackground: null }));
  await b.transact((d) => removeContact(d, "lan")); await a.transact((d) => removeContact(d, "lan"));
  assert.deepEqual(o.read(), []);
});

test("a failed save keeps stored data, releases the lock and does not block later writes", async () => {
  const o = origin(); let fail = false;
  const a = o.tab({ failWrites: () => fail }), b = o.tab();
  await seed(a);
  const before = o.values.get(KEY); fail = true;
  await assert.rejects(a.transact((d) => updateContact(d, "peter", { remark: "Lost", heroBackground: null })), /Quota/);
  assert.equal(o.values.get(KEY), before);
  fail = false;
  await Promise.all([b.transact((d) => updateContact(d, "lan", { remark: "B", heroBackground: null })),
    a.transact((d) => updateContact(d, "peter", { remark: "A", heroBackground: null }))]);
  assert.deepEqual(o.read().map((c) => c.remark), ["A", "B"]);
});

test("a write that completes late never overwrites newer data: later writes build on it", async () => {
  const o = origin(); const slow = o.tab(), fast = o.tab();
  await seed(slow);
  let finishSlow!: () => void; const gate = new Promise<void>((resolve) => { finishSlow = resolve; });
  const first = slow.transact((d) => { return updateContact(d, "peter", { remark: "Slow", heroBackground: null }); });
  const second = fast.transact((d) => updateContact(d, "lan", { remark: "Fast", heroBackground: null }));
  void gate; finishSlow();
  const [late, newer] = await Promise.all([first, second]);
  assert.equal(late.contacts.find((c) => c.characterId === "peter")!.remark, "Slow");
  assert.deepEqual(newer.contacts.map((c) => c.remark), ["Slow", "Fast"], "the newer result contains the older write");
  assert.deepEqual(o.read().map((c) => c.remark), ["Slow", "Fast"]);
});

test("without Web Locks, a change made by another context between read and write is detected and recomputed", async () => {
  const o = origin(); const quiet = o.tab({}, false);
  await seed(quiet);
  const foreign = () => o.values.set(KEY, JSON.stringify({ version: 1, contacts: [...o.read(), { id: "x", characterId: "zed", createdAt: 2, remark: null, heroBackground: null, lastRemarkChange: null }] }));
  const racing = o.tab({ afterFirstRead: foreign }, false);
  await racing.transact((d) => updateContact(d, "peter", { remark: "Mine", heroBackground: null }));
  assert.deepEqual(o.read().map((c) => [c.characterId, c.remark]), [["peter", "Mine"], ["lan", null], ["zed", null]]);
});

test("persistent interference fails after bounded attempts and saves nothing", async () => {
  const o = origin(); const quiet = o.tab({}, false);
  await seed(quiet);
  let n = 0;
  const hostile = createContactStorage(() => ({
    getItem: (key: string) => { const v = o.values.get(key) ?? null; n++; if (n % 2 === 1) return v; return `${v}\n`; },
    setItem: (key: string, value: string) => { o.values.set(key, value); },
  }), () => undefined);
  const before = o.values.get(KEY); let calls = 0;
  await assert.rejects(hostile.transact((d) => { calls++; return updateContact(d, "peter", { remark: "X", heroBackground: null }); }), /changed in another tab/);
  assert.equal(o.values.get(KEY), before);
  assert.equal(calls, 3);
});
