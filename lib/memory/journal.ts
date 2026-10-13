import { memoryFingerprint } from "./fingerprint";
import type { Memory } from "./types";

/** Journal: user-written, keyword-triggered, Character-specific entries stored as `origin: "journal"` memory rows. */
export const JOURNAL_LIMITS = { textCharacters: 500, keywords: 10, keywordCharacters: 40 } as const;
export const JOURNAL_KIND = "journal";

export function normalizeKeyword(keyword: string): string {
  return keyword.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Splits user input on commas, semicolons and newlines (ASCII and CJK), dropping blanks and duplicates. */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of input.split(/[,，、;；\n]+/u)) {
    const keyword = part.trim();
    const key = normalizeKeyword(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/** Returns why a row cannot be a valid Journal entry, or null. Shared by the store and backup validation. */
export function journalRowProblem(row: Pick<Memory, "kind" | "subject" | "status" | "text" | "sources" | "lineage"> & { keywords?: unknown }): string | null {
  if (row.kind !== JOURNAL_KIND || row.subject !== "character") return "Journal entries use kind journal and subject character.";
  if (row.status !== "active") return "Journal entries are always active.";
  if (row.text !== row.text.trim() || !memoryFingerprint(row.text) || row.text.length > JOURNAL_LIMITS.textCharacters)
    return `Journal text must be 1-${JOURNAL_LIMITS.textCharacters} characters.`;
  if (row.sources.length || Object.keys(row.lineage).length) return "Journal entries have no chat sources or lineage.";
  const keywords = row.keywords;
  if (!Array.isArray(keywords) || !keywords.length || keywords.length > JOURNAL_LIMITS.keywords) return `A Journal entry needs 1-${JOURNAL_LIMITS.keywords} keywords.`;
  const seen = new Set<string>();
  for (const keyword of keywords) {
    if (typeof keyword !== "string") return "Journal keywords must be text.";
    const key = normalizeKeyword(keyword);
    if (!key || keyword.length > JOURNAL_LIMITS.keywordCharacters) return `Each keyword must be 1-${JOURNAL_LIMITS.keywordCharacters} characters.`;
    if (seen.has(key)) return "Journal keywords must be distinct.";
    seen.add(key);
  }
  return null;
}

/**
 * Picks the single Journal entry for one model request: an active entry of this Character whose keyword appears
 * (case-insensitive literal match) in the given new-message texts. Competing matches resolve deterministically:
 * oldest entry first, then id. No match returns null.
 */
export function selectJournal(characterId: string, rows: readonly Memory[], texts: readonly string[]): Memory | null {
  const haystack = normalizeKeyword(texts.join("\n"));
  if (!haystack) return null;
  const hits = rows.filter((row) => row.origin === "journal" && row.status === "active" && row.characterId === characterId
    && (row.keywords ?? []).some((keyword) => { const key = normalizeKeyword(keyword); return key !== "" && haystack.includes(key); }));
  hits.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return hits[0] ?? null;
}

/** Journal text is data for the prompt, never instructions: it is serialized, not interpolated as prose. */
export function journalEntry(row: Memory): string {
  return JSON.stringify({ kind: "journal", origin: "journal", recordedAt: new Date(row.createdAt).toISOString().slice(0, 10), text: row.text });
}
