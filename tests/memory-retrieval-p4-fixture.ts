import { memoryFingerprint } from "../lib/memory/fingerprint";
import type { Memory } from "../lib/memory/types";

/** Explicit misses documented in memory-m41-evaluation.md; never inferred from the live selector. */
export const KNOWN_RETRIEVAL_MISSES: Readonly<Record<string, string>> = {
  "o-en-indirect-no-anchor": "No recent referent for her advice",
  "o-zh-indirect": "No recent anchor for the earlier agreement",
  "en-employment-negation": "No employment object for resigning",
  "en-adoption-paraphrase-no-anchor": "No bridge between adopted and took in",
  "en-family-paraphrase-no-anchor": "No global sister/sibling equivalence",
  "en-grandma-no-anchor": "No referent for her guidance",
  "en-rest-no-anchor": "No recent sleep anchor for rest",
  "zh-creation-broad": "Creation is broader than writing novels",
  "zh-no-anchor": "No concrete anchor for that event",
  "mix-orchid-no-bridge": "No English/Chinese orchid bridge",
  "mix-cat-no-bridge": "No English/Chinese cat bridge",
};

export const p4Memory = (id: string, extra: Partial<Memory> = {}): Memory => ({
  id, characterId: "a", kind: "fact", subject: "character", text: `Orchids in greenhouse section ${id}.`,
  status: "active", origin: "auto", sources: [{ sessionId: "s", messageId: id }], lineage: {},
  fingerprint: memoryFingerprint(`Orchids in greenhouse section ${id}.`), createdAt: 1, updatedAt: 1, ...extra,
});

export type P4BoundaryCase = { id: string; rows: Memory[]; expectedIds: string[]; current?: string };
const boundaryText = "Orchids ";
const overhead = JSON.stringify({ kind: "fact", subject: "character", origin: "auto", text: boundaryText }).length;

/** Synthetic rows only. Exact expectations encode the existing contract, not a new algorithm. */
export const P4_BOUNDARY_CASES: P4BoundaryCase[] = [
  { id: "character-isolation", rows: [p4Memory("a"), p4Memory("b", { characterId: "b" })], expectedIds: ["a"] },
  ...(["flagged", "archived", "superseded"] as const).map((status) => ({ id: `exclude-${status}`,
    rows: [p4Memory("live"), p4Memory("invalid", { status })], expectedIds: ["live"] })),
  { id: "journal-separate-channel", rows: [p4Memory("journal", { origin: "journal", keywords: ["orchids"] })], expectedIds: [] },
  { id: "no-unrelated-manual-filler", rows: [p4Memory("unrelated", { text: "I paint landscapes.", origin: "manual" })], expectedIds: [] },
  { id: "manual-before-auto-dedup", rows: [p4Memory("auto", { text: "I raise orchids!" }),
    p4Memory("manual", { text: "Ｉ raise orchids", origin: "manual" })], expectedIds: ["manual"] },
  { id: "already-in-prompt", rows: [p4Memory("present", { text: "I raise orchids!" })],
    current: "Ｉ raise orchids", expectedIds: [] },
  { id: "five-entry-tie-break", rows: Array.from({ length: 7 }, (_, i) => p4Memory(`m${i}`)),
    expectedIds: ["m0", "m1", "m2", "m3", "m4"] },
  { id: "manual-ongoing-priority", rows: [p4Memory("manual", { origin: "manual" }), p4Memory("ongoing", { kind: "ongoing" }),
    ...Array.from({ length: 6 }, (_, i) => p4Memory(`auto${i}`, { updatedAt: 10 }))],
    expectedIds: ["auto0", "auto1", "auto2", "manual", "ongoing"] },
  { id: "raw-oversize-skip", rows: [p4Memory("large", { text: `Orchids ${"x".repeat(2_000)}`, origin: "manual" }), p4Memory("small")], expectedIds: ["small"] },
  { id: "json-escape-oversize-skip", rows: [p4Memory("escaped", { text: `Orchids ${'\n"'.repeat(600)}`, origin: "manual" }), p4Memory("small")], expectedIds: ["small"] },
  { id: "exact-2000-character-boundary", rows: [p4Memory("boundary", { text: boundaryText + "x".repeat(2_000 - overhead) })], expectedIds: ["boundary"] },
  { id: "over-2000-character-boundary", rows: [p4Memory("boundary", { text: boundaryText + "x".repeat(2_001 - overhead) })], expectedIds: [] },
  { id: "newline-counted-in-budget", rows: [p4Memory("a", { text: boundaryText + "a".repeat(1_000 - overhead - 2), origin: "manual" }),
    p4Memory("b", { text: boundaryText + "b".repeat(1_000 - overhead - 2), origin: "manual" }), p4Memory("small")], expectedIds: ["a", "small"] },
];
