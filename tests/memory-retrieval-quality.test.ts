import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRetrieval } from "./memory-retrieval-evaluation";
import { RETRIEVAL_CASES } from "./memory-retrieval-fixture";

test("formal quality comparison preserves original baseline and improves short Chinese recall", () => {
  const results = evaluateRetrieval(), original = results.filter((r) => r.set === "original");
  assert.equal(original.filter((r) => r.before).length, 5);
  assert(original.filter((r) => r.after).length > 5);
  for (const id of ["o-zh-short", "zh-orange-cat"]) assert.equal(results.find((r) => r.id === id)?.after, true, id);
  for (const row of original.filter((r) => r.before)) assert.equal(row.after, true, row.id);
});
test("fresh English examples improve recall and reduce false recalls", () => {
  const rows = evaluateRetrieval().filter((r) => r.language === "en" && r.set === "fresh");
  assert(rows.filter((r) => r.relevant && r.after).length > rows.filter((r) => r.relevant && r.before).length);
  assert(rows.filter((r) => !r.relevant && r.after).length < rows.filter((r) => !r.relevant && r.before).length);
});
test("all languages keep false recalls no worse than the frozen M4 baseline", () => {
  for (const language of ["en", "zh", "mixed"]) {
    const rows = evaluateRetrieval().filter((r) => r.language === language && !r.relevant);
    assert(rows.filter((r) => r.after).length <= rows.filter((r) => r.before).length, language);
  }
});
test("every formal evaluation stays within the unchanged count and serialized character guards", () => {
  for (const result of evaluateRetrieval()) {
    assert(result.afterIds.length <= 5, result.id);
    assert(result.afterCharacters <= 2_000, result.id);
  }
});
for (const sample of RETRIEVAL_CASES.filter((row) => !row.relevant)) test(`formal negative: ${sample.id}`, () => {
  const result = evaluateRetrieval().find((row) => row.id === sample.id)!;
  assert.deepEqual(result.afterIds, [], sample.id);
});
