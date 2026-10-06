import { createBindingStorage } from "../lib/binding-storage";
import type { BindingDocument } from "../lib/bindings";
import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { applyRegex, parseRegexPattern, regexPatternError, testRegexGroups, testRegexRule } from "../lib/regex-engine";
import { emptyRegexDocument, importRegexGroup, importRegexRule, newRegexGroup, newRegexRule,
  resolveRegexGroups, validateRegexDocument, type RegexGroup, type RegexRule } from "../lib/regex";
import { createRegexStorage, deleteRegexGroupAndBindings } from "../lib/regex-storage";
import { resolveBindings } from "../lib/bindings";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine as baseChatEngine } from "./chat-engine-fixture";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { evaluateWorldBooks } from "../lib/worldbook-activation";
import { normalizeWorldBook } from "../lib/worldbook";

function group(rules: RegexRule[], name = "Group"): RegexGroup {
  return { ...newRegexGroup(), name, rules };
}
function rule(find: string, replace: string, mode: RegexRule["mode"] = "stored"): RegexRule {
  return { ...newRegexRule(), find, replace, mode };
}

test("Regex engine isolates roles and modes, honors order, and skips disabled or empty rules", () => {
  const first = rule("A", "B");
  const second = rule("B", "C");
  const prompt = rule("C", "P", "prompt");
  const visual = rule("C", "V", "display");
  const assistant = { ...rule("C", "X"), appliesTo: ["assistant" as const] };
  const groups = [group([first, second, prompt, visual, assistant, rule("", "bad")]),
    { ...group([rule("C", "Z")]), enabled: false }];
  assert.equal(applyRegex("A", groups, "user", "stored"), "C");
  assert.equal(applyRegex("A", groups, "assistant", "stored"), "X");
  assert.equal(applyRegex("A", groups, "user", "prompt"), "A");
  assert.equal(applyRegex("C", groups, "user", "prompt"), "P");
  assert.equal(applyRegex("C", groups, "user", "display"), "V");
  assert.equal(applyRegex("A", [group([first, { ...second, enabled: false }])], "user", "stored"), "B");
  assert.equal(applyRegex("A", [group([first]), group([second])], "user", "stored"), "C");
  assert.equal(applyRegex("A", [group([second]), group([first])], "user", "stored"), "B");
  const trace = testRegexGroups("A", groups, "user", "stored");
  assert.deepEqual(trace.steps.map((step) => step.status), ["matched", "matched", "unchanged"]);
  assert.deepEqual(trace.steps.map((step) => step.before), ["A", "B", "C"]);
});

test("patterns parse literal flags, captures and named groups; invalid rules do not stop the chain", () => {
  assert.deepEqual(parseRegexPattern("/a\\/b/gi"), { pattern: "a\\/b", flags: "gi" });
  assert.equal(applyRegex("Aa", [group([rule("/a/g", "X")])], "user", "stored"), "AX");
  assert.equal(applyRegex("abc", [group([rule("(a)(b)", "$0:$1:$2")])], "user", "stored"), "ab:a:bc");
  assert.equal(applyRegex("a", [group([rule("(?<name>a)", "$<name>!")])], "user", "stored"), "a!");
  const invalid = rule("/[/g", "bad");
  assert(regexPatternError(invalid.find));
  const result = testRegexGroups("A", [group([invalid, rule("A", "B")])], "user", "stored");
  assert.equal(result.output, "B");
  assert.deepEqual(result.steps.map((step) => step.status), ["invalid", "matched"]);
  assert.equal(testRegexRule(invalid, "A").output, "A");
  for (let index = 0; index < 100; index++) applyRegex("x", [group([rule(`x${index}`, "y")])], "user", "stored");
  assert.equal(applyRegex("A", [group([rule("A", "B")])], "user", "stored"), "B");
});

test("Regex storage, native and legacy import retain strict IDs and warnings", async () => {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const storage = createRegexStorage(() => backend);
  const native = group([rule("cat", "dog")]);
  const imported = importRegexGroup(emptyRegexDocument(), JSON.stringify(native));
  assert.notEqual(imported.document.groups[0].id, native.id);
  assert.notEqual(imported.document.groups[0].rules[0].id, native.rules[0].id);
  const added = importRegexRule(imported.document, imported.document.groups[0].id,
    JSON.stringify(native.rules[0]));
  assert.notEqual(added.document.groups[0].rules[1].id, native.rules[0].id);
  await storage.save(added.document);
  assert.deepEqual(await storage.load(), added.document);
  const legacy = importRegexGroup(emptyRegexDocument(), JSON.stringify({ name: "Old", disabled: true, rules: [{
    scriptName: "Old Rule", findRegex: "cat", replaceString: "dog", disabled: true,
    placement: [1, 2, 4], promptOnly: true, tags: ["chat"],
  }] }));
  assert.deepEqual(legacy.document.groups[0].rules[0].appliesTo, ["user", "assistant"]);
  assert.equal(legacy.document.groups[0].rules[0].enabled, false);
  assert.equal(legacy.document.groups[0].enabled, false);
  assert.equal(legacy.document.groups[0].rules[0].mode, "stored");
  assert(legacy.warnings.some((warning) => warning.includes("Mode")));
  assert(legacy.warnings.some((warning) => warning.includes("placement")));
  assert(legacy.warnings.some((warning) => warning.includes("promptOnly")));
  assert.throws(() => importRegexGroup(added.document, "{"), /could not be read/);
  assert.throws(() => importRegexGroup(added.document, JSON.stringify({ rules: [null] })), /unsupported/);
  assert.deepEqual(await storage.load(), added.document);
  assert.throws(() => validateRegexDocument({ version: 1, groups: [native, native] }), /duplicate/);
});

test("Regex bindings keep override order and group deletion removes only Regex references", async () => {
  const values = new Map<string, string>();
  const backend = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const foundation = createBindingStorage(() => backend);
  const storage = createRegexStorage(() => backend);
  const a = group([rule("a", "b")], "A"), b = group([rule("b", "c")], "B");
  await storage.save({ version: 1, groups: [a, b] });
  await foundation.save({
    global: { regexIds: [b.id, a.id], worldBookIds: ["lore"] },
    characters: { p: { defaults: { regexIds: [a.id] }, apps: { messages: { regexIds: [b.id, a.id] } } } },
  });
  const before = await foundation.load();
  assert.deepEqual(resolveRegexGroups(await storage.load(), resolveBindings(before, "p", "messages").regexIds).map((item) => item.id), [b.id, a.id]);
  assert.deepEqual(resolveBindings(before, "p", "appearance").regexIds, [a.id]);
  assert.deepEqual(resolveBindings(before, null, "messages").regexIds, [b.id, a.id]);
  await deleteRegexGroupAndBindings(b.id, storage, foundation);
  const after = await foundation.load();
  assert.deepEqual(resolveBindings(after, "p", "messages").regexIds, [a.id]);
  assert.deepEqual(after.global.worldBookIds, ["lore"]);
  assert.deepEqual((await storage.load()).groups.map((item) => item.id), [a.id]);
});

async function chatSetup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const foundation = testFoundation();
  foundation.runtime.timeAware = false;
  foundation.characters = [{ characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) }];
  const session = await storage.openSession("p");
  return { storage, foundation, session };
}

test("Chat stores user and each final assistant bubble, while prompt/display remain copies", async () => {
  const { storage, foundation, session } = await chatSetup();
  const groups = { version: 1 as const, groups: [group([
    { ...rule("cat", "dog"), appliesTo: ["user"] },
    { ...rule("dog", "pet", "prompt"), appliesTo: ["user"] },
    { ...rule("A", "Saved A"), appliesTo: ["assistant"] },
    { ...rule("B", "Saved B"), appliesTo: ["assistant"] },
    { ...rule("Saved A", "History A", "prompt"), appliesTo: ["assistant"] },
    { ...rule("Saved", "Shown", "display"), appliesTo: ["assistant"] },
  ])] };
  bindings.global.regexIds = [groups.groups[0].id];
  const prompts: string[] = [];
  const engine = createChatEngine(storage, async () => foundation, async function* (_config, turns) {
    prompts.push(turns.map((turn) => turn.content).join("\n"));
    yield "A\n\nB";
  }, undefined, undefined, undefined, async () => groups);
  await engine.send(session.id, "cat");
  assert.equal((await storage.readSession(session.id)).messages[0].content, "dog");
  await engine.requestReply(session.id);
  const saved = (await storage.readSession(session.id)).messages;
  assert.deepEqual(saved.map((message) => message.content), ["dog", "Saved A", "Saved B"]);
  assert.match(prompts[0], /pet/);
  assert.doesNotMatch(prompts[0], /Shown A|Shown B/);
  assert.equal(applyRegex(saved[1].content, groups.groups, "assistant", "display"), "Shown A");
  assert.equal(saved[1].content, "Saved A");
  assert.deepEqual(saved.slice(1).map((item) => item.status), ["complete", "complete"]);
  await engine.send(session.id, "again");
  await engine.requestReply(session.id);
  assert.match(prompts[1], /History A/);
  assert.doesNotMatch(prompts[1], /Shown A/);
  assert.equal((await storage.readSession(session.id)).messages[1].content, "Saved A");
});

test("pending and history Prompt Regex never activate WorldBook or mutate real messages", async () => {
  const { storage, foundation, session } = await chatSetup();
  const groups = [group([{ ...rule("cat", "trigger", "prompt"), appliesTo: ["user"] }])];
  const user = await storage.send(session.id, "cat");
  const messages = (await storage.readSession(session.id)).messages;
  const book = normalizeWorldBook({ name: "Lore", entries: [{ content: "Secret", key: ["trigger"] }] });
  const activation = evaluateWorldBooks([book], messages, null);
  assert.equal(activation.before.length, 0);
  const prompt = assembleChatPrompt(foundation, foundation.characters[0], messages, [user],
    undefined, undefined, undefined, activation, groups);
  assert(prompt.messages.some((turn) => turn.content === "trigger"));
  assert.equal((await storage.readSession(session.id)).messages[0].content, "cat");
});

test("Regenerate uses current Regex; provider failure and Stop never apply Stored to partial assistant", async () => {
  const { storage, foundation, session } = await chatSetup();
  const groups = { version: 1 as const, groups: [group([{ ...rule("A", "Stored A"), appliesTo: ["assistant"] }])] };
  const engine = createChatEngine(storage, async () => foundation, async function* () { yield "A\n\nB"; },
    undefined, undefined, undefined, async () => groups);
  await engine.send(session.id, "hello");
  await engine.requestReply(session.id);
  const original = (await storage.readSession(session.id)).messages;
  await engine.regenerateMessage(original[1].id, undefined, session.id);
  assert.deepEqual((await storage.readSession(session.id)).messages.map((item) => item.content), ["hello", "Stored A", "B"]);
  await engine.send(session.id, "again");
  const failing = createChatEngine(storage, async () => foundation, async function* () { yield "A"; throw new Error("offline"); },
    undefined, undefined, undefined, async () => groups);
  assert.equal((await failing.requestReply(session.id))?.status, "error");
  assert.equal((await storage.readSession(session.id)).messages.at(-1)?.content, "A");
  await engine.send(session.id, "last");
  const stopped = createChatEngine(storage, async () => foundation, async function* () {
    stopped.stop(session.id); yield "A";
  }, undefined, undefined, undefined, async () => groups);
  assert.equal((await stopped.requestReply(session.id))?.status, "cancelled");
  assert.notEqual((await storage.readSession(session.id)).messages.at(-1)?.content, "Stored A");
});

let bindings: BindingDocument = { global: {}, characters: {} };
function testFoundation() { bindings = { global: {}, characters: {} }; return defaultFoundation(); }
function createChatEngine(...args: Parameters<typeof baseChatEngine>) { args[7] = async () => bindings; return baseChatEngine(...args); }
