import type { MemorySlot } from "../chat/prompt";
import { memoryFingerprint } from "./fingerprint";
import type { Memory } from "./types";

/** Temporary M4 safety limits, not a tokenizer or a model context-window guarantee. */
export const MEMORY_CONTEXT_LIMITS = { entries: 5, characters: 2_000 } as const;
const STOP_WORDS = new Set("a an and are as at be but by for from had has have i in is it me my of on or our that the their them they this to was we were with you your".split(" "));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function terms(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const words = new Set((normalized.match(/[\p{Script=Latin}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
  const bigrams = new Set<string>();
  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...run];
    for (let i = 1; i < chars.length; i++) bigrams.add(chars[i - 1] + chars[i]);
  }
  return { words, bigrams };
}

export type MemoryContext = {
  slot: MemorySlot;
  ids: string[];
  characterLength: number;
  outcome: "selected" | "empty" | "unavailable" | "preset-disabled";
};
export const emptyMemoryContext = (outcome: MemoryContext["outcome"] = "empty"): MemoryContext =>
  ({ slot: { entries: [] }, ids: [], characterLength: 0, outcome });

/** Read-only lexical candidate selection. No source-message reads, model calls, writes or fallback filler. */
export function selectMemoryContext(characterId: string, rows: readonly Memory[], conversation: readonly string[]): MemoryContext {
  const query = terms(conversation.join("\n"));
  const present = new Set(conversation.map(memoryFingerprint));
  const candidates = rows.filter((row) => row.characterId === characterId && row.status === "active")
    .flatMap((row) => {
      if (row.text.length > MEMORY_CONTEXT_LIMITS.characters) return [];
      const fingerprint = memoryFingerprint(row.text);
      if (!fingerprint || present.has(fingerprint)) return [];
      const tokens = terms(row.text);
      const words = [...tokens.words].filter((term) => query.words.has(term)).length;
      const bigrams = [...tokens.bigrams].filter((term) => query.bigrams.has(term)).length;
      // A single common CJK pair is weak evidence. This threshold deliberately permits missed recalls.
      if (!words && bigrams < 2) return [];
      return [{ row, fingerprint, score: words + bigrams,
        priority: row.origin === "manual" ? 2 : row.kind === "ongoing" ? 1 : 0 }];
    })
    .sort((a, b) => b.priority - a.priority || b.score - a.score || b.row.updatedAt - a.row.updatedAt || compare(a.row.id, b.row.id));
  const selected: { row: Memory; entry: string }[] = [];
  const seen = new Set<string>();
  let characters = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.fingerprint)) continue;
    const entry = JSON.stringify({ kind: candidate.row.kind, subject: candidate.row.subject,
      origin: candidate.row.origin, text: candidate.row.text });
    const added = entry.length + (selected.length ? 1 : 0);
    if (characters + added > MEMORY_CONTEXT_LIMITS.characters) continue;
    selected.push({ row: candidate.row, entry });
    seen.add(candidate.fingerprint);
    characters += added;
    if (selected.length === MEMORY_CONTEXT_LIMITS.entries) break;
  }
  // Selection rank does not churn the serialized order when the selected set is unchanged.
  selected.sort((a, b) => compare(a.row.id, b.row.id));
  return { slot: { entries: selected.map((item) => item.entry) }, ids: selected.map((item) => item.row.id),
    characterLength: characters, outcome: selected.length ? "selected" : "empty" };
}
