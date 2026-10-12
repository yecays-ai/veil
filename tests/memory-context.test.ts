import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { MEMORY_CONTEXT_LIMITS, selectMemoryContext } from "../lib/memory/context";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { MemoryStorage } from "../lib/memory/storage";
import type { Memory } from "../lib/memory/types";

const row = (id: string, text: string, extra: Partial<Memory> = {}): Memory => ({
  id, characterId: "a", kind: "fact", text, subject: "character", status: "active", origin: "auto",
  sources: [], lineage: {}, fingerprint: memoryFingerprint(text), createdAt: 1, updatedAt: 1, ...extra,
});
const ids = (rows: Memory[], query: string) => selectMemoryContext("a", rows, [query]).ids;

test("read-only selection isolates Characters and admits active relevant memories only", async () => {
  let writes = 0;
  const rows = [row("a", "I grow orchids"), row("b", "I grow orchids elsewhere", { characterId: "b" }),
    ...(["flagged", "archived", "superseded"] as const).map((status) => row(status, `orchids ${status}`, { status }))];
  // Use a stable factory for the persisted roundtrip.
  const factory = new IDBFactory();
  const store = new MemoryStorage(() => factory, () => 1, { withWrite: (run) => { writes++; return run(); } });
  for (const characterId of ["a", "b"]) await store.applyChange(characterId, "fixture", {
    put: rows.filter((item) => item.characterId === characterId),
  });
  const before = await store.listMemories("a");
  const operations = await store.listOperations("a");
  const writesBefore = writes;
  assert.deepEqual(ids([...before, ...await store.listMemories("b")], "Tell me about orchids"), ["a"]);
  assert.equal(writes, writesBefore);
  assert.deepEqual(await store.listMemories("a"), before);
  assert.deepEqual(await store.listOperations("a"), operations);
  assert.deepEqual(await store.listSuppressions("a"), []);
  assert.deepEqual(await store.listCursors("a"), []);
});

test("manual and ongoing priorities apply only after relevance, with no filler", () => {
  const rows = [row("manual-unrelated", "I paint landscapes", { origin: "manual" }),
    row("manual", "I raise orchids", { origin: "manual" }),
    row("ongoing", "I am cataloguing orchids", { kind: "ongoing" }),
    ...Array.from({ length: 6 }, (_, i) => row(`auto-${i}`, `orchids grow in garden ${i}`, { updatedAt: 10 + i }))];
  const result = ids(rows, "How are the orchids?");
  assert.equal(result.length, 5);
  assert(result.includes("manual") && result.includes("ongoing"));
  assert(!result.includes("manual-unrelated"));
  assert.deepEqual(ids(rows, "The train arrived"), []);
  assert.deepEqual(ids(rows, "and the with 然后呢"), []);
});

test("exact duplicates are removed without treating source ids as content equivalence", () => {
  const rows = [row("auto", "I raise orchids!"), row("manual", "Ｉ raise orchids", { origin: "manual" }),
    row("supplement", "Orchids remind me of my grandmother", { sources: [{ sessionId: "s", messageId: "current" }] })];
  assert.deepEqual(ids(rows, "Tell me about orchids"), ["manual", "supplement"]);
  assert.deepEqual(ids(rows, "I raise orchids"), ["supplement"]);
});

test("selection and serialization are deterministic, including equal ranks and changed query scores", () => {
  const rows = [row("b", "orchids garden"), row("a", "orchids greenhouse")];
  const result = selectMemoryContext("a", rows, ["Tell me about orchids in the garden"]);
  assert.deepEqual(result, selectMemoryContext("a", [...rows].reverse(), ["Tell me about orchids in the garden"]));
  assert.deepEqual(result.slot, selectMemoryContext("a", rows, ["Tell me about orchids in the greenhouse"]).slot);
  assert.deepEqual(result.ids, ["a", "b"]);
});

test("count and serialized character guards skip whole oversized entries and account for JSON escapes", () => {
  const large = row("large", `orchids ${"x".repeat(2_000)}`, { origin: "manual" });
  const escaped = row("escaped", `orchids ${"\n\"".repeat(600)}`, { origin: "manual" });
  const small = row("small", "I care for orchids");
  const result = selectMemoryContext("a", [large, escaped, small], ["orchids"]);
  assert.deepEqual(result.ids, ["small"]);
  assert.equal(result.characterLength, result.slot.entries.join("\n").length);
  assert(result.characterLength <= MEMORY_CONTEXT_LIMITS.characters);
  const boundary = row("boundary", "orchids ");
  const overhead = JSON.stringify({ kind: boundary.kind, subject: boundary.subject, origin: boundary.origin, text: boundary.text }).length;
  boundary.text += "x".repeat(MEMORY_CONTEXT_LIMITS.characters - overhead);
  assert.equal(selectMemoryContext("a", [boundary], ["orchids"]).characterLength, 2_000);
  boundary.text += "x";
  assert.deepEqual(ids([boundary], "orchids"), []);
});

/** Fixed semantic expectations: misses are measured evidence, not a claim of adequate semantic retrieval. */
export const RECALL_CASES = [
  { name: "English literal", text: "I keep orchids in my greenhouse", query: "How are the orchids?", hit: true },
  { name: "Chinese literal", text: "我正在照顾阳台上的兰花", query: "阳台上的兰花怎么样了？", hit: true },
  { name: "English paraphrase with shared topic", text: "I paint landscapes beside the river", query: "Tell me about your river painting", hit: true },
  { name: "Chinese paraphrase with shared topic", text: "我周末在海边练习摄影", query: "海边拍照的练习顺利吗？", hit: true },
  { name: "English synonym", text: "I resigned from my job", query: "How do you feel after quitting work?", hit: false },
  { name: "Chinese synonym", text: "我已经辞职，开始写小说", query: "离开工作以后，创作顺利吗？", hit: false },
  { name: "English indirect with lexical anchor", text: "My grandmother taught me to grow orchids", query: "Do you remember what she taught you?", hit: true },
  { name: "English indirect without lexical anchor", text: "My grandmother taught me to grow orchids", query: "Does her advice still come to mind?", hit: false },
  { name: "Chinese indirect", text: "我和妹妹约好周五去看展览", query: "你们之前约好的事情还去吗？", hit: false },
  { name: "short Chinese named topic", text: "我喜欢兰花", query: "兰花长得好吗？", hit: false },
] as const;

for (const sample of RECALL_CASES) test(`fixed recall: ${sample.name} (${sample.hit ? "hit" : "miss"})`, () => {
  assert.equal(ids([row("target", sample.text)], sample.query).includes("target"), sample.hit);
});
