import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStorageBytes,
  readStorageHealth,
  requestPersistentStorage,
  storageUsageRatio,
} from "../lib/storage-health";

test("storage health reports quota, usage and persistence without throwing", async () => {
  let persistent = false;
  const manager = {
    estimate: async () => ({ usage: 75, quota: 100 }),
    persisted: async () => persistent,
    persist: async () => { persistent = true; return true; },
  };
  const before = await readStorageHealth(manager);
  assert.deepEqual(before, {
    supported: true, persisted: false, usage: 75, quota: 100,
  });
  assert.equal(storageUsageRatio(before), 0.75);
  assert.equal((await requestPersistentStorage(manager)).persisted, true);
});

test("storage health degrades safely when browser APIs reject or are unavailable", async () => {
  assert.deepEqual(await readStorageHealth(undefined), {
    supported: false, persisted: null, usage: null, quota: null,
  });
  assert.deepEqual(await readStorageHealth({
    estimate: async () => { throw new Error("denied"); },
    persisted: async () => { throw new Error("denied"); },
  }), {
    supported: true, persisted: null, usage: null, quota: null,
  });
});

test("storage sizes and invalid ratios stay readable", () => {
  assert.equal(formatStorageBytes(null), "Unknown");
  assert.equal(formatStorageBytes(512), "512 B");
  assert.equal(formatStorageBytes(1536), "1.5 KB");
  assert.equal(formatStorageBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(storageUsageRatio({ supported: true, persisted: true, usage: 1, quota: 0 }), null);
});
