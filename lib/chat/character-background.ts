import { textMatcher } from "../memory/context";
import { normalizeKeyword, parseKeywords, JOURNAL_LIMITS } from "../memory/journal";

/**
 * Character Background (the single Backstory text) is split at prompt time only; nothing is stored or copied.
 * Core paragraphs stay in the Character section every turn. Other paragraphs are injected only when the current
 * input or the last two turns point at them. Deterministic, local, no model call.
 */
export const BACKGROUND_LIMITS = {
  /** Whole text at or below this size is always core: nothing worth retrieving. */
  shortText: 600,
  /** A first paragraph shorter than this is a title line and joins the next paragraph as core. */
  titleParagraph: 80,
  items: 3,
  characters: 1500,
  /** Target size of one chunk when a retrievable paragraph is longer than the whole budget. */
  chunk: 700,
  chunksPerParagraph: 2,
} as const;

export type BackgroundSplit = { core: string | null; retrievable: BackgroundParagraph[] };
export type BackgroundParagraph = { index: number; text: string; keywords: string[] };
export type BackgroundChunk = { paragraph: number; part: number; text: string; keywords: string[]; order: number };
export type BackgroundSelection = {
  /** Text to inject after History, in original order. Empty when nothing matched. */
  entries: string[];
  characters: number;
  /** Characters of single sentences longer than the whole budget; they can never be injected, so they are reported. */
  skippedOversizeCharacters: number;
};

const MARKER = /^\s*[[【]\s*(?:常驻|core)\s*[\]】]\s*/iu;
const KEYWORD_LINE = /^[ \t]*(?:关键词|关键字|keywords?)[ \t]*[:：][ \t]*(.*)$/imu;
const KEYWORD_LINES = new RegExp(KEYWORD_LINE.source, "gimu");

function parseParagraph(raw: string) {
  const marked = MARKER.test(raw);
  let text = marked ? raw.replace(MARKER, "") : raw;
  const keywords: string[] = [];
  for (const match of text.matchAll(KEYWORD_LINES)) keywords.push(...parseKeywords(match[1]));
  text = text.replace(KEYWORD_LINES, "").replace(/\n{3,}/gu, "\n\n").trim();
  const seen = new Set<string>();
  const limited = keywords.filter((keyword) => {
    const key = normalizeKeyword(keyword);
    if (!key || key.length > JOURNAL_LIMITS.keywordCharacters || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, JOURNAL_LIMITS.keywords);
  return { marked, text, keywords: limited };
}

/** Old, short or unstructured Backstory is returned unchanged as core, so no existing Character loses anything. */
export function splitBackground(backstory: string | null): BackgroundSplit {
  if (!backstory) return { core: backstory, retrievable: [] };
  const raw = backstory.replace(/\r\n?/gu, "\n").split(/\n[ \t]*\n+/u).map((part) => part.trim()).filter(Boolean);
  if (backstory.length <= BACKGROUND_LIMITS.shortText || raw.length <= 1) return { core: backstory, retrievable: [] };
  const core: string[] = [];
  let start = 0, head = "";
  // The first paragraph is core; a bare title line also takes the next paragraph so identity text is not left out.
  do { head = [head, parseParagraph(raw[start]).text].filter(Boolean).join("\n\n"); start++; }
  while (head.length < BACKGROUND_LIMITS.titleParagraph && start < raw.length);
  core.push(head);
  const retrievable: BackgroundParagraph[] = [];
  for (let i = start; i < raw.length; i++) {
    const parsed = parseParagraph(raw[i]);
    if (!parsed.text) continue;
    if (parsed.marked) core.push(parsed.text);
    else retrievable.push({ index: i, text: parsed.text, keywords: parsed.keywords });
  }
  return { core: core.join("\n\n"), retrievable };
}

/** Pieces concatenate back to the original text: whitespace stays attached to the sentence before it. */
const sentences = (text: string) => text.split(/(?<=[。！？!?])|(?<=\.\s)|(?<=\n)/u).filter((part) => part.trim());

/**
 * A paragraph that fits the whole budget is one unit. A longer one is cut at sentence boundaries into chunks of about
 * `chunk` characters, in original order; text is never altered. A single sentence longer than the budget cannot be
 * injected whole and is skipped, but counted so the omission is visible in diagnostics.
 */
export function chunkParagraph(paragraph: BackgroundParagraph): { chunks: BackgroundChunk[]; skipped: number } {
  const make = (text: string, part: number): BackgroundChunk =>
    ({ paragraph: paragraph.index, part, text: text.trim(), keywords: paragraph.keywords, order: paragraph.index * 1000 + part });
  if (paragraph.text.length <= BACKGROUND_LIMITS.characters) return { chunks: [make(paragraph.text, 0)], skipped: 0 };
  const chunks: BackgroundChunk[] = [];
  let current = "", skipped = 0;
  const flush = () => { if (current.trim()) chunks.push(make(current, chunks.length)); current = ""; };
  for (const sentence of sentences(paragraph.text)) {
    if (sentence.trim().length > BACKGROUND_LIMITS.characters) { flush(); skipped += sentence.trim().length; continue; }
    if (current && current.length + sentence.length > BACKGROUND_LIMITS.chunk) flush();
    current += sentence;
  }
  flush();
  return { chunks, skipped };
}

/** ASCII keywords need word boundaries so a short one cannot fire inside another word; CJK keywords match as substrings. */
function keywordHit(haystack: string, keyword: string) {
  const needle = normalizeKeyword(keyword);
  if (!needle) return false;
  if (!/^[\p{Script=Latin}\p{N}\s'’.-]+$/u.test(needle)) return haystack.includes(needle);
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1], after = haystack[at + needle.length];
    if (!(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after))) return true;
  }
  return false;
}

/**
 * Chooses the paragraphs/chunks relevant to this request. `current` is the round's new input; `recent` the previous
 * two turns (continuity). A keyword hit in current input is the strongest signal; recent text needs two shared terms
 * or a keyword. Chunks inherit their paragraph's keywords only as a fallback for its opening chunk, so a keyword
 * never drags every chunk of a long paragraph in, and at most `chunksPerParagraph` chunks per paragraph are used.
 */
export function selectBackground(retrievable: readonly BackgroundParagraph[], current: string, recent: string): BackgroundSelection {
  const none: BackgroundSelection = { entries: [], characters: 0, skippedOversizeCharacters: 0 };
  if (!retrievable.length) return none;
  const haystackNow = current.normalize("NFKC").toLowerCase(), haystackRecent = recent.normalize("NFKC").toLowerCase();
  const matchNow = textMatcher(current), matchRecent = textMatcher(recent);
  let skippedOversizeCharacters = 0;
  const ranked: { chunk: BackgroundChunk; band: number; score: number }[] = [];
  for (const paragraph of retrievable) {
    const { chunks, skipped } = chunkParagraph(paragraph);
    skippedOversizeCharacters += skipped;
    if (!chunks.length) continue;
    const keywordBand = paragraph.keywords.some((k) => keywordHit(haystackNow, k)) ? 3
      : paragraph.keywords.some((k) => keywordHit(haystackRecent, k)) ? 1 : 0;
    const own = chunks.map((chunk) => {
      const now = matchNow(chunk.text), before = matchRecent(chunk.text);
      return { chunk, band: now > 0 ? 2 : before >= 2 ? 1 : 0, score: now * 2 + before };
    });
    const hits = own.filter((item) => item.band > 0);
    // Keyword fallback: when no chunk matches by its own text, only the opening chunk is brought in.
    const picked = keywordBand === 0 ? hits : hits.length
      ? hits.map((item) => ({ ...item, band: Math.max(item.band, keywordBand) }))
      : [{ chunk: chunks[0], band: keywordBand, score: 0 }];
    ranked.push(...picked.sort((a, b) => b.band - a.band || b.score - a.score || a.chunk.order - b.chunk.order)
      .slice(0, BACKGROUND_LIMITS.chunksPerParagraph));
  }
  ranked.sort((a, b) => b.band - a.band || b.score - a.score || a.chunk.order - b.chunk.order);
  const chosen: BackgroundChunk[] = [];
  let characters = 0;
  for (const { chunk } of ranked) {
    if (chosen.length === BACKGROUND_LIMITS.items) break;
    if (chosen.some((item) => item.text === chunk.text)) continue;
    const added = chunk.text.length + (chosen.length ? 2 : 0);
    if (characters + added > BACKGROUND_LIMITS.characters) continue;
    chosen.push(chunk); characters += added;
  }
  chosen.sort((a, b) => a.order - b.order);
  // Adjacent chunks of one paragraph read as one passage.
  const entries: string[] = [];
  let previous: BackgroundChunk | undefined;
  for (const chunk of chosen) {
    if (previous && previous.paragraph === chunk.paragraph && chunk.part === previous.part + 1) entries[entries.length - 1] += `\n${chunk.text}`;
    else entries.push(chunk.text);
    previous = chunk;
  }
  return { entries, characters, skippedOversizeCharacters };
}

export const BACKGROUND_NOTE = "Parts of my background that matter for this moment (the rest of my background still holds):";
export const backgroundBlock = (entries: readonly string[]) => `[background]\n${BACKGROUND_NOTE}\n${entries.join("\n\n")}`;
