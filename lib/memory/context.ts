import type { MemorySlot } from "../chat/prompt";
import { memoryFingerprint } from "./fingerprint";
import type { Memory } from "./types";

/** Temporary M4 safety limits, not a tokenizer or a model context-window guarantee. */
export const MEMORY_CONTEXT_LIMITS = { entries: 5, characters: 2_000 } as const;
export type MemoryContextMessage = { role: "user" | "assistant"; content: string };
export type MemoryConversation = {
  current: readonly MemoryContextMessage[];
  recent: readonly (readonly MemoryContextMessage[])[];
  earlier: readonly MemoryContextMessage[];
};
const STOP_WORDS = new Set("a an and are as at be but by for from had has have i in is it me my of on or our that the their them they this to was we were with you your she her him how do did does what when where about after any get got been lately better recently things thing today days feel feeling tell remember still come mind show would like should think before could will now some these those up well yet properly managed happening holding follow unsure more safe happy healthy calm fine".split(" "));
// These can describe unrelated objects. A shared generic action is not a topic anchor by itself.
const WEAK_WORDS = new Set("adopt adopte grow grown keep take took leave leav left resign quit quitt care decide decided decision advice guidance plan ready rest going doing happening".split(" "));
const CJK_COMMON = "怎么样 我觉得 今天 明天 事情 觉得 应该 可以 什么 怎么 我们 你们 他们 她们 这个 那个 这样 那样 现在 最近 已经 之前 以后 然后 还是 一下 时候 是否 喜欢 知道 长得 好吗 了吗 的吗".split(" ");
const CJK_FUNCTIONS = new RegExp(CJK_COMMON.sort((a, b) => b.length - a.length).join("|"), "gu");
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function terms(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const words = new Set((normalized.match(/[\p{Script=Latin}\p{N}]+/gu) ?? [])
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));
  const weak = new Set<string>();
  for (const word of [...words]) {
    const forms = [word];
    const base = word.length > 5 && word.endsWith("ing") ? word.slice(0, -3)
      : word.length > 4 && word.endsWith("ed") ? word.slice(0, -2) : null;
    if (base && /^[a-z]+$/.test(base)) {
      forms.push(base, `${base}e`);
      if (/([bcdfghjklmnpqrtvwxyz])\1$/.test(base)) forms.push(base.slice(0, -1));
    }
    if (word === "slept") forms.push("sleep");
    if (word === "taught") forms.push("teach");
    if (forms.some((form) => STOP_WORDS.has(form))) words.delete(word);
    else for (const form of forms) words.add(form);
    if (forms.some((form) => WEAK_WORDS.has(form))) for (const form of forms) weak.add(form);
  }
  for (const word of [...words]) if (STOP_WORDS.has(word)) words.delete(word);
  const bigrams = new Set<string>();
  // Separate function phrases before cutting pairs, so removing 觉得 cannot leave a spurious 我觉.
  const runs = normalized.replace(CJK_FUNCTIONS, " ").match(/\p{Script=Han}+/gu) ?? [];
  for (const run of runs) {
    const chars = [...run];
    for (let i = 1; i < chars.length; i++) bigrams.add(chars[i - 1] + chars[i]);
  }
  const concepts = new Set<string>();
  const employmentExit = /\b(?:resign(?:ed|ing)?|quit(?:ting)?|leav(?:e|ing)|left)\s+(?:from\s+)?(?:(?:my|your|our|their|his|her|the|a|an|this|that)\s+)?(?:(?!at\b|in\b|on\b|and\b|but\b|after\b|before\b|with\b|while\b)\w+\s+)?(?:job|work|employment|employer|firm|company|position|committees?)\b/;
  if (employmentExit.test(normalized) || /辞职|离职|离开工作/u.test(normalized)) concepts.add("employment-exit");
  return { words, weak, bigrams, runs, concepts };
}
type Terms = ReturnType<typeof terms>;
const shared = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].filter((word) => b.has(word));
function match(query: Terms, memory: Terms, bridge = false): Set<string> {
  const words = shared(query.words, memory.words).filter((word) => bridge || (!query.weak.has(word) && !memory.weak.has(word)));
  const pairs = shared(query.bigrams, memory.bigrams);
  const short = pairs.filter((pair) => query.runs.some((run) => run.startsWith(pair) || run.endsWith(pair))
    && memory.runs.some((run) => run.startsWith(pair) || run.endsWith(pair)));
  const accepted = pairs.length >= 2 || bridge ? pairs : short;
  return new Set([...words.map((word) => `w:${word}`), ...accepted.map((pair) => `c:${pair}`),
    ...shared(query.concepts, memory.concepts).map((concept) => `s:${concept}`)]);
}

type RecentTerms = { all: Terms; clauses: Terms[] };
function evidence(memory: Terms, current: Terms, recent: readonly RecentTerms[], ambiguous: boolean,
  directTopic: boolean): { band: number; features: Set<string> } {
  const direct = match(current, memory);
  if (direct.size) return { band: 2, features: direct };
  if (directTopic) return { band: 0, features: new Set() };
  for (const turn of recent) {
    for (const clause of turn.clauses) {
      const anchors = match(clause, memory);
      if (anchors.size && match(current, clause).size) return { band: 1, features: anchors };
    }
  }
  if (!ambiguous && recent.length) {
    const anchors = match(recent.at(-1)!.all, memory);
    if (anchors.size) return { band: 1, features: anchors };
  }
  return { band: 0, features: new Set() };
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
export function selectMemoryContext(characterId: string, rows: readonly Memory[], conversation: MemoryConversation): MemoryContext {
  const currentText = conversation.current.map((message) => message.content).join("\n");
  const query = terms(currentText);
  const recent = conversation.recent.map((turn) => ({ all: terms(turn.map((message) => message.content).join("\n")),
    clauses: turn.flatMap((message) => message.content.split(/[.!?;。！？；\n]|\band\b/iu).filter((text) => text.trim()).map(terms)) }));
  const earlier = terms(conversation.earlier.map((message) => message.content).join("\n"));
  const all = [...conversation.earlier, ...conversation.recent.flat(), ...conversation.current];
  const present = new Set(all.map((message) => memoryFingerprint(message.content)));
  const eligible = rows.filter((row) => row.characterId === characterId && row.status === "active" && row.origin !== "journal"
    && row.text.length <= MEMORY_CONTEXT_LIMITS.characters)
    .map((row) => ({ row, fingerprint: memoryFingerprint(row.text), tokens: terms(row.text) }));
  const frequency = new Map<string, number>();
  for (const { tokens } of eligible) for (const feature of [...tokens.words].map((word) => `w:${word}`)
    .concat([...tokens.bigrams].map((pair) => `c:${pair}`), [...tokens.concepts].map((concept) => `s:${concept}`)))
    frequency.set(feature, (frequency.get(feature) ?? 0) + 1);

  // Only generic follow-ups can borrow a unique latest topic; explicit new nouns block pronoun guessing.
  const shortPronounQuestion = /^[它他她]/u.test(currentText.trim())
    && currentText.replace(CJK_FUNCTIONS, "").replace(/[它他她的了吗呢还真]/gu, "").replace(/[^\p{Script=Han}]/gu, "").length <= 2;
  const thin = ![...query.words].some((word) => !query.weak.has(word)) && (!query.bigrams.size || shortPronounQuestion);
  const followup = /\b(?:it|her|him|he|she|they|them|that)\b|它|他|她|之前|你们/u.test(currentText.toLowerCase());
  const sleepFollowup = query.words.has("rest") && recent.at(-1)?.all.words.has("sleep");
  // Competition detection is deliberately looser than admission, including a short topic inside a sentence.
  const latestAnchors = recent.length ? eligible.map(({ tokens }) => match(recent.at(-1)!.all, tokens, true)).filter((set) => set.size) : [];
  const commonAnchor = latestAnchors.length ? [...latestAnchors[0]].some((word) => latestAnchors.every((set) => set.has(word))) : false;
  const latestText = conversation.recent.at(-1)?.map((message) => message.content).join("\n") ?? "";
  // Multiple referents can be mentioned without a corresponding Memory row. Decline generic pronouns then.
  const coordinated = /\b(?:both|or)\b|和|与|以及|或/u.test(latestText.toLowerCase())
    || [...latestText.toLowerCase().matchAll(/\b(\w+)\s+and\s+(the\s+)?(\w+)\b/gu)].some(([, left, article, right]) =>
      article || (![left, right].some((word) => STOP_WORDS.has(word) || WEAK_WORDS.has(word)
        || (word.length > 4 && /(?:ed|ing)$/.test(word)))));
  const ambiguous = !thin || (!followup && !sleepFollowup) || !commonAnchor || coordinated;
  const directTopic = eligible.some(({ tokens }) => match(query, tokens).size > 0);
  const candidates = eligible.flatMap(({ row, fingerprint, tokens }) => {
    if (!fingerprint || present.has(fingerprint)) return [];
    const hit = evidence(tokens, query, recent, ambiguous, directTopic);
    if (!hit.band) return [];
    const score = [...hit.features].reduce((sum, feature) => sum + 1 / (frequency.get(feature) ?? 1), 0);
    return [{ row, fingerprint, score, band: hit.band, earlierScore: match(earlier, tokens).size,
      priority: row.origin === "manual" ? 2 : row.kind === "ongoing" ? 1 : 0 }];
  }).sort((a, b) => b.band - a.band || b.priority - a.priority || b.score - a.score
    || b.earlierScore - a.earlierScore || b.row.updatedAt - a.row.updatedAt || compare(a.row.id, b.row.id));
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
