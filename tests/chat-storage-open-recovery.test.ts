import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { lockOrigin } from "./generation-lock-fixture";

for (const mode of ["readonly", "readwrite"] as const) {
  test(`chat first ${mode} open retries a pending-close connection once`, async () => {
    const factory = new IDBFactory(), origin = lockOrigin();
    const nativeOpen = factory.open.bind(factory);
    let opens = 0, attempts = 0;
    factory.open = (...args) => {
      opens++;
      const request = nativeOpen(...args);
      request.addEventListener("success", () => {
        const db = request.result, transaction = db.transaction.bind(db);
        db.transaction = (...parameters) => {
          attempts++;
          if (attempts === 1) {
            db.close();
            throw new DOMException("Connection is closing", "InvalidStateError");
          }
          return transaction(...parameters);
        };
      });
      return request;
    };
    const storage = new ChatStorage(() => factory, () => undefined, createPersistenceWriteGate(() => origin.client()));
    if (mode === "readonly") assert.deepEqual(await storage.listSessions(), []);
    else assert.equal((await storage.openSession("simulated")).characterId, "simulated");
    assert.equal(opens, 2);
    assert.ok(attempts >= 2);
  });
}

test("chat first open stops after a second InvalidStateError and permits a later reopen", async () => {
  const factory = new IDBFactory(), nativeOpen = factory.open.bind(factory);
  let opens = 0, failures = 2;
  factory.open = (...args) => {
    opens++;
    const request = nativeOpen(...args);
    request.addEventListener("success", () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        if (failures-- > 0) {
          db.close();
          throw new DOMException("Connection is closing", "InvalidStateError");
        }
        return transaction(...parameters);
      };
    });
    return request;
  };
  const storage = new ChatStorage(() => factory, () => undefined, createPersistenceWriteGate(() => lockOrigin().client()));
  await assert.rejects(storage.listSessions(), { name: "InvalidStateError" });
  assert.equal(opens, 2);
  assert.deepEqual(await storage.listSessions(), []);
  assert.equal(opens, 3);
});
