import assert from "node:assert/strict";
import test from "node:test";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { BACKGROUND_LIMITS, chunkParagraph, selectBackground, splitBackground } from "../lib/chat/character-background";
import type { ChatMessage } from "../lib/chat/types";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createBuiltinPreset } from "../lib/preset";
import type { StateView } from "../lib/memory/state-runtime";

const IDENTITY = "Peter Parker is a 24-year-old photographer in Queens who secretly lives a double life and trusts only a few people. He is warm, anxious and loyal to his Aunt May.";
const SPIDER = "Spider-Man history: Peter was bitten by a radioactive spider in high school and gained wall-crawling, super strength and a spider-sense. He patrols Queens most nights, swinging between rooftops and stopping muggers.\n关键词：Spidey, 蜘蛛侠, web-slinging, patrol";
const FOOD = "Food: Peter survives on cheap pizza and Aunt May's lasagna, and he is allergic to shellfish.";
const CAREER = "Career: he sells photographs to the Daily Bugle, argues with the editor Jameson about payment and struggles to pay rent on time.";
const SECRET = "[常驻] Never reveal the secret identity: Peter denies being the masked hero to strangers.";
const BACKSTORY = [IDENTITY, SPIDER, FOOD, CAREER, SECRET].join("\n\n");
const build = (backstory: string | null, id = "peter") => ({ characterId: id,
  ...normalizeCharacterInput({ name: id === "peter" ? "Peter" : "Mary", backstory, personality: "Witty and kind", speakingStyle: "Short, playful sentences" }) });
const foundationOf = (...characters: ReturnType<typeof build>[]) =>
  ({ ...defaultFoundation(), runtime: { ...defaultFoundation().runtime, timeAware: false }, characters });
const message = (order: number, role: "user" | "assistant", content: string, status: ChatMessage["status"] = role === "user" ? "sent" : "complete"): ChatMessage =>
  ({ id: `m${order}`, sessionId: "s", role, content, status, createdAt: order, order });
function prompt(user: string, options: { backstory?: string | null; history?: ChatMessage[]; state?: StateView; mutate?: (preset: ReturnType<typeof createBuiltinPreset>) => void;
  memory?: string[] } = {}) {
  const character = build(options.backstory === undefined ? BACKSTORY : options.backstory);
  const history = options.history ?? [];
  const pending = message(history.length + 1, "user", user);
  const preset = createBuiltinPreset();
  options.mutate?.(preset);
  const result = assembleChatPrompt(foundationOf(character), character, [...history, pending], [pending], { entries: options.memory ?? [] },
    preset, new Date(0), undefined, [], undefined, undefined, options.state);
  return { ...result, text: result.messages.map((turn) => turn.content).join("\n"),
    block: result.messages.find((turn) => turn.content.startsWith("[background]"))?.content };
}

test("everyday chat keeps identity, Personality and Speaking Style but injects no Background excerpt", () => {
  const { text, block, diagnostics } = prompt("What are you having for lunch?");
  assert.equal(block, undefined);
  for (const kept of ["double life", "Never reveal the secret identity", "Witty and kind", "Short, playful sentences", "Peter"]) assert.match(text, new RegExp(kept));
  for (const dropped of ["radioactive spider", "Daily Bugle", "Spidey", "关键词", "[常驻]"]) assert.doesNotMatch(text, new RegExp(dropped.replace(/[[\]]/g, "\\$&")));
  assert.ok(!diagnostics.some((section) => section.identifier === "background"));
});

test("a Background event question injects only the related paragraph after History, keywords stay out of the prompt", () => {
  const { messages, block, text } = prompt("How was your patrol as Spider-Man last night?", { memory: ["MEMORY-ENTRY"] });
  assert.match(block!, /radioactive spider/);
  assert.doesNotMatch(block!, /cheap pizza|Daily Bugle|double life/);
  assert.doesNotMatch(text, /Spidey|web-slinging|关键词/);
  assert.match(text, /MEMORY-ENTRY/);
  // Character section is stable and the excerpt comes after it and after History, before the pending input.
  const at = (needle: string) => messages.findIndex((turn) => turn.content.includes(needle));
  assert.ok(at("double life") < at("[background]") && at("[background]") < at("How was your patrol"));
});

test("aliases, nicknames and mixed Chinese/English inputs retrieve through the keyword line", () => {
  for (const input of ["Hey Spidey, any news?", "How is the web-slinging going", "蜘蛛侠昨晚怎么样", "你昨晚的 web-slinging 怎么样？"])
    assert.match(prompt(input).block ?? "", /radioactive spider/, input);
  // ASCII keywords respect word boundaries.
  assert.equal(prompt("The patrolling dogs of the park").block, undefined);
});

test("a follow-up without any keyword stays on topic through the last two turns", () => {
  const history = [message(1, "user", "Tell me about your patrol"),
    message(2, "assistant", "Last night I chased two muggers across the Queens rooftops before sunrise.")];
  assert.match(prompt("and then what happened?", { history }).block ?? "", /radioactive spider/);
  assert.equal(prompt("and then what happened?", { history: [message(1, "user", "hello"), message(2, "assistant", "hi there")] }).block, undefined);
});

test("unrelated paragraphs are not pulled in by a related topic", () => {
  const { block } = prompt("I am craving pizza and lasagna tonight");
  assert.match(block!, /cheap pizza/);
  assert.doesNotMatch(block!, /radioactive spider|Daily Bugle/);
});

test("State keeps its authority over the core while excerpts stay separate", () => {
  const character = build(BACKSTORY);
  const state: StateView = { characterId: "peter", background: character.backstory, entries: [{ id: "s", key: "career", value: "Now a full-time scientist", status: "active" }] };
  const { messages, text } = prompt("How was your patrol as Spider-Man?", { state });
  const characterTurn = messages.find((turn) => turn.content.includes("[character]\n"))!.content;
  assert.match(characterTurn, /backgroundBaseline/); assert.match(characterTurn, /stateAuthority/); assert.match(characterTurn, /Now a full-time scientist/);
  assert.match(characterTurn, /Never reveal the secret identity/); assert.doesNotMatch(characterTurn, /radioactive spider/);
  assert.match(characterTurn, /\[background\] section/);
  assert.equal(text.split("Now a full-time scientist").length - 1, 1);
});

test("Preset: a disabled or non-system Character marker never produces an excerpt", () => {
  const input = "How was your patrol as Spider-Man last night?";
  const off = prompt(input, { mutate: (preset) => { for (const entry of preset.prompts) if (entry.source === "marker" && entry.marker === "character") entry.enabled = false; } });
  assert.equal(off.block, undefined); assert.doesNotMatch(off.text, /double life/);
  const user = prompt(input, { mutate: (preset) => { for (const entry of preset.prompts) if (entry.source === "marker" && entry.marker === "character") entry.role = "user"; } });
  assert.equal(user.block, undefined); assert.match(user.text, /double life/);
});

test("Characters are isolated: another Character's Background never appears", () => {
  const mary = build("Mary Jane acts on Broadway and keeps a secret garden.\n\nBroadway: she once played Lady Macbeth for a full season.", "mary");
  const peter = build(BACKSTORY);
  const pending = message(1, "user", "Tell me about Broadway");
  const result = assembleChatPrompt(foundationOf(peter, mary), peter, [pending], [pending], undefined, createBuiltinPreset(), new Date(0));
  assert.doesNotMatch(result.messages.map((turn) => turn.content).join("\n"), /Lady Macbeth|Mary Jane|secret garden/);
});

test("Backstory compatibility: short, single-block, title-first, empty and CRLF text are preserved as core", () => {
  const short = "A quiet librarian.\n\nShe loves tea.";
  assert.deepEqual(splitBackground(short), { core: short, retrievable: [] });
  // A short Backstory is otherwise untouched, but a keyword line (never sent) is removed.
  assert.equal(splitBackground("Quiet librarian.\nKeywords: reader, 书虫\n\nLoves tea.").core, "Quiet librarian.\n\nLoves tea.");
  assert.doesNotMatch(prompt("hello", { backstory: "Quiet librarian.\n关键词：书虫" }).text, /关键词|书虫/);
  const single = "x".repeat(900);
  assert.deepEqual(splitBackground(single), { core: single, retrievable: [] });
  assert.equal(splitBackground(null).core, null); assert.equal(splitBackground("").core, "");
  const titled = splitBackground(`Background:\n\n${IDENTITY}\n\n${FOOD}\n\n${CAREER}\n\n${SPIDER}`);
  assert.match(titled.core!, /Background:[\s\S]*double life/); assert.equal(titled.retrievable.length, 3);
  const crlf = splitBackground(BACKSTORY.replace(/\n/g, "\r\n"));
  assert.equal(crlf.retrievable.length, 3); assert.match(crlf.core!, /Never reveal/); assert.doesNotMatch(crlf.core!, /\[常驻\]|\r/);
  // A single backstory the old way yields the same Character section as before.
  const legacy = prompt("hello", { backstory: short }).messages.find((turn) => turn.content.includes("[character]\n"))!.content;
  assert.ok(legacy.includes(JSON.stringify(short).slice(1, -1)));
});

test("keyword lines parse in either language, are capped, and never appear in core or excerpts", () => {
  const many = Array.from({ length: 15 }, (_, i) => `k${i}word`).join(", ");
  const split = splitBackground([IDENTITY, `Chapter one has a long enough body text to count as a retrievable paragraph for this test.\nKeywords: ${many}`, FOOD, CAREER].join("\n\n"));
  assert.equal(split.retrievable[0].keywords.length, 10);
  assert.doesNotMatch((split.core ?? "") + split.retrievable.map((item) => item.text).join(), /Keywords/i);
});

test("budget: at most 3 whole paragraphs within 1500 characters, none truncated", () => {
  const paragraphs = Array.from({ length: 6 }, (_, i) => ({ index: i + 1, keywords: [], text: `Garden notes ${i}: the old garden has roses tulips and quiet corners ${"x".repeat(380)}.` }));
  const picked = selectBackground(paragraphs, "tell me about the garden roses", "");
  assert.ok(picked.entries.length <= BACKGROUND_LIMITS.items && picked.characters <= BACKGROUND_LIMITS.characters);
  for (const entry of picked.entries) assert.ok(paragraphs.some((paragraph) => paragraph.text === entry));
});

test("oversize paragraph: sentence-boundary chunks keep order and text, and a keyword does not inject every chunk", () => {
  const sentences = Array.from({ length: 40 }, (_, i) => `Sentence ${i} describes the harbour lighthouse with marker${i}x in some detail here.`);
  const paragraph = { index: 1, keywords: ["warden"], text: sentences.join(" ") };
  assert.ok(paragraph.text.length > BACKGROUND_LIMITS.characters);
  const { chunks, skipped } = chunkParagraph(paragraph);
  assert.equal(skipped, 0); assert.ok(chunks.length >= 3);
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), paragraph.text);
  for (const chunk of chunks) { assert.ok(chunk.text.length <= BACKGROUND_LIMITS.chunk); assert.match(chunk.text, /\.$/); }
  // Keyword only: just the opening chunk. Own-text hit: that chunk (plus at most one sibling), never all.
  const byKeyword = selectBackground([paragraph], "the warden arrived", "");
  assert.equal(byKeyword.entries.length, 1); assert.equal(byKeyword.entries[0], chunks[0].text);
  const byText = selectBackground([paragraph], "what is marker35x", "");
  assert.ok(byText.entries.join("\n").includes("marker35x")); assert.ok(byText.entries.join("\n").length <= BACKGROUND_LIMITS.chunk * BACKGROUND_LIMITS.chunksPerParagraph);
});

test("a single sentence longer than the budget is reported in diagnostics, never silently dropped", () => {
  const huge = `Long legend ${"of the old city ".repeat(130)}ends here.`;
  assert.ok(huge.length > BACKGROUND_LIMITS.characters);
  const backstory = [IDENTITY, `${huge}\n关键词：legend`, FOOD, CAREER].join("\n\n");
  const result = prompt("tell me the legend of the old city", { backstory });
  assert.equal(result.block, undefined);
  const skipped = result.diagnostics.find((section) => section.identifier === "background-skipped-oversize");
  assert.equal(skipped?.characterLength, huge.length);
});
