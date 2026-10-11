import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { ApiConfigStorage } from "../lib/api-config-storage";
import { AppearanceImageStorage } from "../lib/appearance-image-storage";
import { ChatStorage } from "../lib/chat/storage";
import { BackupCoordinator, BACKUP_LOCK_NAME, type BackupLockManager } from "../lib/backup/coordination";
import { createPersistenceWriteGate, type PersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const domains = ["core", "api", "appearance", "chat"] as const;
function fixture(domain: typeof domains[number], factory: IDBFactory, gate: PersistenceWriteGate) {
  if (domain === "core") {
    const store = new IndexedDBDocumentStorage(() => factory, gate);
    return { store, read: () => store.read("test"), write: () => store.putIfAbsent("test", "saved") };
  }
  if (domain === "api") {
    const store = new ApiConfigStorage(() => factory, gate);
    return { store, read: () => store.listApiConfigs(), write: () => store.saveApiConfig({ id: "test", baseUrl: "https://example.invalid", apiKey: "SIMULATED", model: "test" }) };
  }
  if (domain === "appearance") {
    const store = new AppearanceImageStorage(() => factory, Date.now, gate);
    return { store, read: () => store.readBlob("a".repeat(64)), write: () => store.saveBlobs([new Blob([new Uint8Array([1])], { type: "image/png" })]) };
  }
  const store = new ChatStorage(() => factory, () => undefined, gate);
  return { store, read: () => store.listSessions(), write: () => store.openSession("test") };
}

for (const domain of domains) {
  test(`${domain} first readonly open cannot bootstrap while a snapshot holds the lock`, async () => {
    const origin = lockOrigin(), factory = new IDBFactory(), ready = deferred(), finish = deferred();
    const env = fixture(domain, factory, createPersistenceWriteGate(() => origin.client()));
    const snapshot = new BackupCoordinator(origin.client()).withSnapshot(async () => { ready.resolve(); await finish.promise; });
    await ready.promise;
    const reads = [env.read(), env.read()];
    await Promise.resolve();
    assert.equal((env.store as unknown as { database?: Promise<IDBDatabase> }).database, undefined);
    assert.deepEqual(await factory.databases(), []);
    finish.resolve(); await snapshot; await Promise.all(reads);
    assert.equal((await factory.databases()).length, 1);
    await env.write();
  });

  test(`${domain} first write reuses one shared lease for open and commit; cached reads acquire no extra lock`, async () => {
    const origin = lockOrigin(), factory = new IDBFactory(); let requests = 0;
    const manager = { request: ((...args: Parameters<LockManager["request"]>) => {
      if (args[0] === BACKUP_LOCK_NAME) requests++;
      return origin.client().request(...args);
    }) as BackupLockManager["request"] };
    const env = fixture(domain, factory, createPersistenceWriteGate(() => manager));
    await env.write(); assert.equal(requests, 1);
    await env.read(); await env.read(); assert.equal(requests, 1);
  });

  for (const event of ["error", "blocked"] as const) test(`${domain} ${event} rejects and aborts late upgrade / closes late success`, async () => {
    const factory = new IDBFactory(); let closes = 0, aborts = 0, created = 0, reads = 0;
    const request = { onerror: null, onblocked: null, onupgradeneeded: null, onsuccess: null,
      result: { close() { closes++; }, objectStoreNames: { contains: () => false },
        createObjectStore() { created++; }, transaction() { reads++; throw new Error("Unexpected transaction"); } },
      transaction: { abort() { aborts++; } } } as unknown as IDBOpenDBRequest;
    factory.open = () => request;
    const env = fixture(domain, factory, createPersistenceWriteGate(() => undefined));
    const reading = env.read(); await Promise.resolve();
    const rejected = assert.rejects(reading);
    request[`on${event}`]?.call(request, new Event(event) as IDBVersionChangeEvent);
    await rejected;
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    assert.equal(aborts, 1); assert.equal(closes, 1); assert.equal(created, 0); assert.equal(reads, 0);
    assert.equal((env.store as unknown as { database?: Promise<IDBDatabase> }).database, undefined);
  });
}
