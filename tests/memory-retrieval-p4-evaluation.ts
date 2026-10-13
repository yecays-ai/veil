import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { selectMemoryContext, type MemoryConversation } from "../lib/memory/context";
import { completeClear } from "../lib/memory/lifecycle";
import { MemoryStorage } from "../lib/memory/storage";
import type { Memory } from "../lib/memory/types";
import { evaluationConversation, evaluationRows } from "./memory-retrieval-evaluation";
import { RETRIEVAL_CASES } from "./memory-retrieval-fixture";
import { KNOWN_RETRIEVAL_MISSES, P4_BOUNDARY_CASES, p4Memory } from "./memory-retrieval-p4-fixture";

export const P4_BASE_SHA = "8a0f79044c6b291906a518bc07a5d717924a348a";
const query = (current = "How are the orchids?"): MemoryConversation => ({
  current: [{ role: "user", content: current }], recent: [], earlier: [],
});
const SOURCE_CASES = [
  { id: "cleared-auto-source", rows: [p4Memory("auto")], expectedIds: [] },
  { id: "remaining-source-keeps-auto", rows: [p4Memory("auto", { sources: [
    { sessionId: "s", messageId: "auto" }, { sessionId: "kept", messageId: "other" } ] })], expectedIds: ["auto"] },
  { id: "manual-survives-source-clear", rows: [p4Memory("manual", { origin: "manual" })], expectedIds: ["manual"] },
];

/** A deterministic comparison of complete results; timings and machine-specific metadata stay outside it. */
export function checkP4Selection(id: string, rows: Memory[], conversation: MemoryConversation, expectedIds: string[]) {
  const before = structuredClone({ rows, conversation });
  const actual = selectMemoryContext("a", rows, conversation);
  const failures: string[] = [];
  if (!isDeepStrictEqual(actual.ids, expectedIds)) failures.push(`expected ids ${JSON.stringify(expectedIds)}, got ${JSON.stringify(actual.ids)}`);
  // Freeze the approved numeric contract independently of the implementation's exported limits.
  if (actual.ids.length > 5) failures.push(`entry budget exceeded: ${actual.ids.length} > 5`);
  if (actual.characterLength > 2_000) failures.push(`character budget exceeded: ${actual.characterLength} > 2000`);
  if (actual.characterLength !== actual.slot.entries.join("\n").length) failures.push("serialized character accounting differs");
  if (actual.slot.entries.length !== actual.ids.length) failures.push("ids and serialized entries differ in count");
  const expectedEntries = expectedIds.map((key) => {
    const row = before.rows.find((item) => item.id === key)!;
    return JSON.stringify({ kind: row.kind, subject: row.subject, origin: row.origin, text: row.text });
  });
  if (!isDeepStrictEqual(actual.slot.entries, expectedEntries)) failures.push("serialized entries differ from expected rows");
  if (actual.outcome !== (expectedIds.length ? "selected" : "empty")) failures.push(`unexpected outcome: ${actual.outcome}`);
  for (const [name, candidates] of [ ["repeat", rows], ["reverse", [...rows].reverse()],
    ["rotate", [...rows.slice(1), ...rows.slice(0, 1)]] ] as const) {
    if (!isDeepStrictEqual(selectMemoryContext("a", candidates, conversation), actual)) failures.push(`${name} result is unstable`);
  }
  if (!isDeepStrictEqual({ rows, conversation }, before)) failures.push("selection mutated input");
  return { id, expectedIds, actualIds: actual.ids, characters: actual.characterLength, failures };
}

/** In-memory fixtures and fresh fake IndexedDB only; no browser globals or provider entry points. */
export async function evaluateMemoryP4() {
  const quality = RETRIEVAL_CASES.map((sample) => {
    const knownMiss = KNOWN_RETRIEVAL_MISSES[sample.id];
    const expectedIds = sample.relevant && !knownMiss ? ["m0"] : [];
    return { ...checkP4Selection(sample.id, evaluationRows(sample), evaluationConversation(sample), expectedIds),
      language: sample.language, relevant: sample.relevant, knownMiss: knownMiss ?? null };
  });
  const boundaries = P4_BOUNDARY_CASES.map((sample) => checkP4Selection(sample.id, sample.rows, query(sample.current), sample.expectedIds));
  const sources = [];
  for (const sample of SOURCE_CASES) {
    const factory = new IDBFactory();
    const storage = new MemoryStorage(() => factory, () => 1, { withWrite: (work) => work() });
    await storage.applyChange("a", "synthetic P4 fixture", { put: sample.rows });
    const initial = await storage.listMemories("a");
    const admittedBefore = checkP4Selection(`${sample.id}:before`, initial, query(), sample.rows.map((row) => row.id));
    await completeClear(storage, "a", "s");
    const remaining = await storage.listMemories("a");
    const result = checkP4Selection(sample.id, remaining, query(), sample.expectedIds);
    result.failures.push(...admittedBefore.failures.map((reason) => `before cleanup: ${reason}`));
    if (remaining.some((row) => row.sources.some((source) => source.sessionId === "s"))) result.failures.push("cleared source pointer remains");
    sources.push(result);
  }
  const rows = [...quality, ...boundaries, ...sources];
  return {
    version: "memory-p4-v1", baselineSha: P4_BASE_SHA,
    fixtureSha256: createHash("sha256").update(JSON.stringify({ quality: RETRIEVAL_CASES,
      knownMisses: KNOWN_RETRIEVAL_MISSES, boundaries: P4_BOUNDARY_CASES, sources: SOURCE_CASES })).digest("hex"),
    summary: {
      total: rows.length, passed: rows.filter((row) => !row.failures.length).length,
      failed: rows.filter((row) => row.failures.length).length,
      positiveTotal: quality.filter((row) => row.relevant).length,
      positiveHits: quality.filter((row) => row.relevant && row.actualIds.includes("m0")).length,
      negativeTotal: quality.filter((row) => !row.relevant).length,
      falseRecalls: quality.filter((row) => !row.relevant && row.actualIds.length).length,
      knownMisses: quality.filter((row) => row.relevant && !row.actualIds.includes("m0")).map((row) => ({ id: row.id, reason: row.knownMiss })),
    }, quality, boundaries, sources,
  };
}
