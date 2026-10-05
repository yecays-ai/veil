import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultChatFormatting, formatAssistantMessage, normalizeChatFormatting } from "../lib/chat/formatting";
import { applyRegex } from "../lib/regex-engine";
import { newRegexGroup, newRegexRule, newRegexDraft, canSaveRegexGroup } from "../lib/regex";
import { createRegexStorage } from "../lib/regex-storage";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { evaluateWorldBooks } from "../lib/worldbook-activation";
import { normalizeWorldBook } from "../lib/worldbook";

test("Chat Formatting defaults ON and persists toggles in existing chat settings storage", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  assert.deepEqual(await storage.readChatFormatting(), defaultChatFormatting());
  assert.deepEqual(normalizeChatFormatting({ hideActions: false }), {
    ...defaultChatFormatting(), hideActions: false,
  });
  await storage.updateChatFormatting({ hideActions: false, hideSpeakerName: false });
  assert.deepEqual(await new ChatStorage(() => factory).readChatFormatting(), {
    ...defaultChatFormatting(), hideActions: false, hideSpeakerName: false,
  });
});

test("Hide Actions removes only a leading standalone action before real speech", () => {
  const settings = defaultChatFormatting();
  const sample = "*He rubs the back of his neck.*\n\nHey, Simba.";
  assert.equal(formatAssistantMessage(sample, "Peter", settings), "Hey, Simba.");
  assert.equal(formatAssistantMessage(sample, "Peter", { ...settings, hideActions: false }), sample);
  for (const ordinary of ["*Hey, Simba.*", "I *really* mean it.",
    "*He rubs the back of his neck.*", "Hey.\n\n*He rubs the back of his neck.*"])
    assert.equal(formatAssistantMessage(ordinary, "Peter", settings), ordinary);
});

test("Hide Speaker Name recognizes the current Character only at message start", () => {
  const settings = defaultChatFormatting();
  assert.equal(formatAssistantMessage("Peter: Hey, Simba.", "Peter", settings), "Hey, Simba.");
  assert.equal(formatAssistantMessage("May Parker： Hello.", "May Parker", settings), "Hello.");
  assert.equal(formatAssistantMessage("Peter: Hey.", "Peter", { ...settings, hideSpeakerName: false }), "Peter: Hey.");
  assert.equal(formatAssistantMessage("Hey Peter: how are you?", "Peter", settings), "Hey Peter: how are you?");
  assert.equal(formatAssistantMessage("Peter is here.", "Peter", settings), "Peter is here.");
  assert.equal(formatAssistantMessage("May: Hello.", "Peter", settings), "May: Hello.");
});

test("outer matching quotes and narrow text wrappers are cleaned without touching ordinary content", () => {
  const settings = defaultChatFormatting();
  assert.equal(formatAssistantMessage('"Hey, Simba."', "Peter", settings), "Hey, Simba.");
  assert.equal(formatAssistantMessage("“Hey, Simba.”", "Peter", settings), "Hey, Simba.");
  assert.equal(formatAssistantMessage('"Hey, Simba."', "Peter", { ...settings, hideQuotesAroundReplies: false }), '"Hey, Simba."');
  for (const ordinary of ['He said "hello" to me.', '"Unfinished', "It's fine.", '"He said "hello"."'])
    assert.equal(formatAssistantMessage(ordinary, "Peter", settings), ordinary);
  const wrapped = "```text\nHey, Simba.\n```";
  assert.equal(formatAssistantMessage(wrapped, "Peter", settings), "Hey, Simba.");
  assert.equal(formatAssistantMessage(wrapped, "Peter", { ...settings, cleanFormattingArtifacts: false }), wrapped);
  for (const ordinary of ["```js\nconst x = 1;\n```", "A ```text\nblock\n``` inside", "```text\n{ code };\n```"])
    assert.equal(formatAssistantMessage(ordinary, "Peter", settings), ordinary);
});

test("formatting precedes Advanced Display Regex and never changes stored, prompt, edit or WorldBook data", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const foundation = defaultFoundation();
  foundation.runtime.timeAware = false;
  foundation.characters = [{ characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) }];
  const session = await storage.openSession("p");
  const original = "Peter: Hey, Simba.";
  const assistant = await storage.send(session.id, original);
  // A User message stays literal even when it resembles the Character's label.
  assert.equal((await storage.readSession(session.id)).messages[0].content, original);
  const groups = [{ ...newRegexGroup(), rules: [{ ...newRegexRule(), find: "Hey", replace: "Hi",
    mode: "display" as const, appliesTo: ["assistant" as const] }] }];
  const shown = applyRegex(formatAssistantMessage(original, "Peter", defaultChatFormatting()), groups, "assistant", "display");
  assert.equal(shown, "Hi, Simba.");
  assert.equal(applyRegex(original, groups, "user", "display"), original);
  assert.equal((await storage.readSession(session.id)).messages[0].content, original);
  const prompt = assembleChatPrompt(foundation, foundation.characters[0], [assistant], [assistant]);
  assert(prompt.messages.some((turn) => turn.content === original));
  const book = normalizeWorldBook({ name: "Lore", entries: [{ content: "Found", key: ["Peter:"] }] });
  assert.equal(evaluateWorldBooks([book], [assistant], null).before.length, 1);
  const edited = await storage.editMessage(assistant.id, "Peter: Edited.");
  assert.equal(edited.content, "Peter: Edited.");
});

test("New Regex draft can hold Rules before final save and cancellation leaves storage empty", async () => {
  const data = new Map<string, string>();
  const storage = createRegexStorage(() => ({ getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); } }));
  const draft = newRegexDraft();
  assert.equal(canSaveRegexGroup(draft), false);
  draft.rules.push(newRegexRule());
  assert.equal(draft.rules.length, 1);
  assert.deepEqual(await storage.load(), { version: 1, groups: [] });
  // Leaving the draft page performs no storage write.
  assert.equal(data.size, 0);
  draft.name = "Formatting";
  assert.equal(canSaveRegexGroup(draft), true);
  await storage.transact((current) => ({ ...current, groups: [...current.groups, draft] }));
  assert.deepEqual((await storage.load()).groups[0].rules, draft.rules);
});

test("Regex UI keeps creation, test empty state and test context labels visible", () => {
  const list = readFileSync("components/settings/regex/regex-list.tsx", "utf8");
  const draft = readFileSync("components/settings/regex/regex-new.tsx", "utf8");
  const shell = readFileSync("components/page-shell.tsx", "utf8");
  const detail = readFileSync("components/settings/regex/regex-detail.tsx", "utf8");
  const editor = readFileSync("components/settings/regex/regex-rule-editor.tsx", "utf8");
  assert.match(list, /href="\/settings\/regex\/new"/);
  assert.match(draft, /setEditing\(newRegexRule\(\)\)/);
  assert.match(draft, /onBack=\{\(\) => \{ setEditing\(null\); setRuleTest\(""\); \}\}/);
  assert.match(shell, /onBack \? <button type="button" className="app-page-back"/);
  assert.match(draft, /disabled=\{!document \|\| busy \|\| !canSaveRegexGroup\(draft\)\}/);
  assert.match(detail, /<h2>Rules<\/h2>[\s\S]*Add Rule/);
  assert.match(detail, /<h2>Group Actions<\/h2>[\s\S]*Export Group[\s\S]*Delete Regex Group/);
  assert.match(detail, /<strong>Test as<\/strong>[\s\S]*Only matching rules in this group will run/);
  assert.match(detail, /<label>Message<select[\s\S]*<label>Stage<select/);
  assert.match(editor, /\{testInput\.trim\(\) && <div className="regex-test-flow"/);
  assert.match(draft, /\{ruleTest\.trim\(\) && <div className="regex-test-flow"/);
});
