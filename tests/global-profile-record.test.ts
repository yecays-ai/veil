import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";

// Characterization of the stored "global-profile-settings" record: every writer must keep the same
// four fields, carry the untouched ones over, and normalise invalid stored values. These tests pin the
// existing write format so the writers can share one record builder without changing what is stored.

const ID = "global-profile-settings";
const HOUR = 60 * 60 * 1000;
const KEYS = ["bubbleTiming", "hereThereEnabled", "id", "nextCommentAt"];
const SAVED_TIMING = { shortMs: 111, mediumMs: 222, longMs: 333 };
const DEFAULT_TIMING = { shortMs: 1200, mediumMs: 2400, longMs: 3600 };

async function rawDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(CHAT_DATABASE_NAME);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function raw(factory: IDBFactory, value?: unknown): Promise<unknown> {
  const db = await rawDatabase(factory);
  try {
    const store = db.transaction("chatSettings", "readwrite").objectStore("chatSettings");
    const request = value === undefined ? store.get(ID) : store.put(value);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(value === undefined ? request.result : undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function remove(factory: IDBFactory) {
  const db = await rawDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("chatSettings", "readwrite").objectStore("chatSettings").delete(ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function setup(seed?: unknown) {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  await storage.readGlobalProfileSettings(); // creates the database
  if (seed === "none") await remove(factory); else if (seed !== undefined) await raw(factory, seed);
  return { factory, storage };
}
const record = (patch: Record<string, unknown> = {}) => ({
  id: ID, bubbleTiming: SAVED_TIMING, hereThereEnabled: true, nextCommentAt: 5 * HOUR, ...patch });
async function stored(factory: IDBFactory) {
  const value = await raw(factory) as Record<string, unknown>;
  assert.deepEqual(Object.keys(value).sort(), KEYS, "exactly the four known fields are stored");
  return value;
}

test("updateBubbleTiming changes only the timings it was given", async () => {
  const { factory, storage } = await setup(record());
  await storage.updateBubbleTiming({ shortMs: 500 });
  assert.deepEqual(await stored(factory), record({ bubbleTiming: { shortMs: 500, mediumMs: 222, longMs: 333 } }));
});

test("updateBubbleTiming on a missing record stores defaults for everything else", async () => {
  const { factory, storage } = await setup("none");
  await storage.updateBubbleTiming({ longMs: 4000 });
  assert.deepEqual(await stored(factory), record({ bubbleTiming: { ...DEFAULT_TIMING, longMs: 4000 }, hereThereEnabled: true, nextCommentAt: null }));
});

test("updateHereThereEnabled(false) clears the schedule and keeps the timings", async () => {
  const { factory, storage } = await setup(record());
  await storage.updateHereThereEnabled(false, 10 * HOUR, () => 0);
  assert.deepEqual(await stored(factory), record({ hereThereEnabled: false, nextCommentAt: null }));
});

test("updateHereThereEnabled(true) schedules a new opportunity and keeps the timings", async () => {
  const { factory, storage } = await setup(record({ hereThereEnabled: false, nextCommentAt: null }));
  await storage.updateHereThereEnabled(true, 10 * HOUR, () => 0);
  assert.deepEqual(await stored(factory), record({ hereThereEnabled: true, nextCommentAt: 11 * HOUR }));
});

test("ensureHereThereSchedule leaves a valid saved schedule untouched", async () => {
  const { factory, storage } = await setup(record());
  const before = await stored(factory);
  const result = await storage.ensureHereThereSchedule(10 * HOUR, () => 0);
  assert.deepEqual(await stored(factory), before);
  assert.deepEqual(result, record());
});

test("ensureHereThereSchedule creates the full record when none exists", async () => {
  const { factory, storage } = await setup("none");
  const result = await storage.ensureHereThereSchedule(10 * HOUR, () => 0);
  const expected = record({ bubbleTiming: DEFAULT_TIMING, nextCommentAt: 11 * HOUR });
  assert.deepEqual(await stored(factory), expected);
  assert.deepEqual(result, expected);
});

test("ensureHereThereSchedule repairs an invalid schedule and keeps timings and the OFF switch", async () => {
  const on = await setup(record({ nextCommentAt: "soon" }));
  await on.storage.ensureHereThereSchedule(10 * HOUR, () => 0);
  assert.deepEqual(await stored(on.factory), record({ nextCommentAt: 11 * HOUR }));
  const off = await setup(record({ hereThereEnabled: false, nextCommentAt: Number.NaN }));
  await off.storage.ensureHereThereSchedule(10 * HOUR, () => 0);
  assert.deepEqual(await stored(off.factory), record({ hereThereEnabled: false, nextCommentAt: null }));
});

test("claimHereThereOpportunity schedules the next one and keeps the timings", async () => {
  const { factory, storage } = await setup(record({ nextCommentAt: 2 * HOUR }));
  assert.equal(await storage.claimHereThereOpportunity(3 * HOUR, () => 0), 4 * HOUR);
  assert.deepEqual(await stored(factory), record({ nextCommentAt: 4 * HOUR }));
});

test("claimHereThereOpportunity writes nothing when it is not due, switched OFF, or has no schedule", async () => {
  for (const seed of [record({ nextCommentAt: 9 * HOUR }), record({ hereThereEnabled: false, nextCommentAt: HOUR }),
    record({ nextCommentAt: null }), "none"]) {
    const { factory, storage } = await setup(seed);
    const before = seed === "none" ? undefined : await stored(factory);
    assert.equal(await storage.claimHereThereOpportunity(3 * HOUR, () => 0), null);
    assert.deepEqual(await raw(factory), before);
  }
});

test("rescheduleHereThereOpportunity moves only the matching schedule and keeps the timings", async () => {
  const { factory, storage } = await setup(record({ nextCommentAt: 4 * HOUR }));
  assert.equal(await storage.rescheduleHereThereOpportunity(4 * HOUR, 10 * HOUR, 777), true);
  assert.deepEqual(await stored(factory), record({ nextCommentAt: 10 * HOUR + 777 }));
  assert.equal(await storage.rescheduleHereThereOpportunity(4 * HOUR, 20 * HOUR, 5), false, "a stale expectation changes nothing");
  assert.deepEqual(await stored(factory), record({ nextCommentAt: 10 * HOUR + 777 }));
});

test("writers normalise an invalid stored bubbleTiming instead of copying it", async () => {
  const { factory, storage } = await setup(record({ bubbleTiming: { shortMs: "fast", mediumMs: -1 } }));
  await storage.updateHereThereEnabled(false, HOUR, () => 0);
  assert.deepEqual(await stored(factory), record({ bubbleTiming: DEFAULT_TIMING, hereThereEnabled: false, nextCommentAt: null }));
});

test("readGlobalProfileSettings reports the same four fields it would store", async () => {
  const { storage } = await setup(record({ nextCommentAt: Number.POSITIVE_INFINITY }));
  assert.deepEqual(await storage.readGlobalProfileSettings(), record({ nextCommentAt: null }));
  const empty = await setup("none");
  assert.deepEqual(await empty.storage.readGlobalProfileSettings(), record({ bubbleTiming: DEFAULT_TIMING, nextCommentAt: null }));
});
