import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { MemoryStorage } from "../lib/memory/storage";
import { completeClear } from "../lib/memory/lifecycle";
import type { MemoryDraft } from "../lib/memory/types";

const draft = (id: string, extra: Partial<MemoryDraft> = {}): MemoryDraft => ({ id, characterId: "c", text: id,
  kind: "fact", subject: "user", status: "active", origin: "auto", sources: [{ sessionId: "A", messageId: "a" }], lineage: {}, ...extra });
const setup = () => new MemoryStorage(() => new IDBFactory(), () => 100, { withWrite: (f) => f() });

test("an unowned automatic write cannot consume the user's undo slots", async () => {
  const storage = setup();
  await assert.rejects(storage.applyChange("c", "automatic", { put: [draft("auto")] }, { auto: true }));
  assert.deepEqual(await storage.listOperations("c"), []);
});

test("automatic writes cannot create user suppression", async () => {
  const storage = setup();
  await assert.rejects(storage.applyChange("c", "automatic", { suppress: [{ id: "s", fingerprint: "x", reason: "deleted", sources: [] }] }, { auto: true }));
  assert.deepEqual(await storage.listSuppressions("c"), []);
});

test("clearing the replacement source restores the preceding fact", async () => {
  const storage = setup();
  await storage.applyChange("c", "seed", { put: [
    draft("old", { status: "superseded", sources: [{ sessionId: "B", messageId: "b" }], lineage: { supersededBy: "new" } }), draft("new"),
  ] });
  await completeClear(storage, "c", "A");
  assert.equal((await storage.getMemory("old"))?.status, "active");
});

test("a manual merged row survives source cleanup", async () => {
  const storage = setup();
  await storage.applyChange("c", "seed", { put: [draft("manual", { origin: "manual", lineage: { mergedFrom: ["original"] } }),
    draft("original", { status: "superseded", lineage: { supersededBy: "manual" } })] });
  await completeClear(storage, "c", "A");
  assert.equal((await storage.getMemory("manual"))?.origin, "manual");
});
