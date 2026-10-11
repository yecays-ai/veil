import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { lockOrigin } from "./generation-lock-fixture";

// Each connection closes and throws InvalidStateError on its first `failures` transaction attempts.
function closingFactory(failures: number) {
  const factory = new IDBFactory(), nativeOpen = factory.open.bind(factory);
  const counts = { opens: 0, attempts: 0 };
  let remaining = failures;
  factory.open = (...args) => {
    counts.opens++;
    const request = nativeOpen(...args);
    request.addEventListener("success", () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...parameters) => {
        counts.attempts++;
        if (remaining-- > 0) {
          db.close();
          throw new DOMException("Connection is closing", "InvalidStateError");
        }
        return transaction(...parameters);
      };
    });
    return request;
  };
  return { factory, counts };
}

for (const mode of ["readonly", "readwrite"] as const) {
  test(`core first ${mode} open retries a pending-close connection once`, async () => {
    const { factory, counts } = closingFactory(1), origin = lockOrigin();
    const documents = new IndexedDBDocumentStorage(() => factory, createPersistenceWriteGate(() => origin.client()));
    if (mode === "readonly") assert.equal(await documents.read("profile"), null);
    else assert.equal(await documents.putIfAbsent("profile", "simulated"), "simulated");
    assert.equal(counts.opens, 2);
    assert.equal(counts.attempts, 2);
  });
}

test("core first open stops after a second InvalidStateError and permits a later reopen", async () => {
  const { factory, counts } = closingFactory(2);
  const documents = new IndexedDBDocumentStorage(() => factory, createPersistenceWriteGate(() => lockOrigin().client()));
  await assert.rejects(documents.read("profile"), { name: "InvalidStateError" });
  assert.equal(counts.opens, 2);
  assert.equal(await documents.read("profile"), null);
  assert.equal(counts.opens, 3);
});
