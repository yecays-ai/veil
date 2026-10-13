import assert from "node:assert/strict";
import test from "node:test";
import { RETRIEVAL_CASES } from "./memory-retrieval-fixture";
import { KNOWN_RETRIEVAL_MISSES } from "./memory-retrieval-p4-fixture";
import { evaluateMemoryP4 } from "./memory-retrieval-p4-evaluation";

const evaluation = evaluateMemoryP4();
test("P4 fixed corpus and documented misses have unique, valid identities", () => {
  assert.equal(RETRIEVAL_CASES.length, 82);
  assert.equal(new Set(RETRIEVAL_CASES.map((row) => row.id)).size, 82);
  assert.equal(Object.keys(KNOWN_RETRIEVAL_MISSES).length, 11);
  for (const id of Object.keys(KNOWN_RETRIEVAL_MISSES)) {
    assert.equal(RETRIEVAL_CASES.find((row) => row.id === id)?.relevant, true, id);
  }
});
for (const sample of RETRIEVAL_CASES) test(`P4 quality baseline: ${sample.id}`, async () => {
  const row = (await evaluation).quality.find((row) => row.id === sample.id)!;
  assert.deepEqual(row.failures, [], `${row.id}: ${row.failures.join("; ")}`);
});
test("P4 boundary and persisted source fixtures satisfy their complete expectations", async (t) => {
  for (const row of [...(await evaluation).boundaries, ...(await evaluation).sources]) {
    await t.test(row.id, () => assert.deepEqual(row.failures, [], `${row.id}: ${row.failures.join("; ")}`));
  }
});
test("P4 report repeats byte-for-byte, including source cleanup in fresh databases", async () => {
  assert.equal(JSON.stringify(await evaluation), JSON.stringify(await evaluateMemoryP4()));
});
