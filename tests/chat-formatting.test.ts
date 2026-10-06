import assert from "node:assert/strict";
import test from "node:test";
import { applyRegex } from "../lib/regex-engine";
import { DEFAULT_REGEX_GROUP_ID, DEFAULT_RULE_IDS, defaultRegexGroup } from "../lib/regex-defaults";
import { browserRegexStorage } from "../lib/regex-storage";
import { newRegexGroup, newRegexRule, resolveRegexGroups } from "../lib/regex";

test("default display rules use the Regex pipeline and dynamic escaped names", () => {
  const group = defaultRegexGroup();
  assert.equal(group.id, DEFAULT_REGEX_GROUP_ID);
  assert.equal(group.rules.length, 4);
  assert(group.rules.every((rule) => rule.enabled && rule.mode === "display" &&
    rule.appliesTo.join() === "assistant"));
  const show = (text: string, character = "Peter") =>
    applyRegex(text, [group], "assistant", "display", { character, user: "Lan" });
  assert.equal(show("Peter: Hey."), "Hey.");
  assert.equal(show("May Parker： Hello.", "May Parker"), "Hello.");
  assert.equal(show("A.B (Q): Hey.", "A.B (Q)"), "Hey.");
  assert.equal(show("Axb (Q): Hey.", "A.B (Q)"), "Axb (Q): Hey.");
  assert.equal(show("Hey Peter: how are you?"), "Hey Peter: how are you?");
  assert.equal(show("*He smiles.*\n\nHey."), "Hey.");
  assert.equal(show('"Hey."'), "Hey.");
  assert.equal(show("“Hey.”"), "Hey.");
  assert.equal(show("```text\nHey.\n```"), "Hey.");
  assert.equal(show("Peter: Hey.", ""), "Peter: Hey.");
  assert.equal(applyRegex("Peter: Hey.", [group], "assistant", "prompt", { character: "Peter" }), "Peter: Hey.");
  assert.equal(applyRegex("Peter: Hey.", [group], "user", "display", { character: "Peter" }), "Peter: Hey.");
  const custom = { ...newRegexGroup(), rules: [{ ...newRegexRule(), find: "Hey", replace: "Hello",
    mode: "display" as const, appliesTo: ["assistant" as const] }] };
  const selected = resolveRegexGroups({ version: 1, groups: [group, custom] }, [custom.id]);
  assert.deepEqual(selected.map((item) => item.id), [DEFAULT_REGEX_GROUP_ID, custom.id]);
  assert.equal(applyRegex("Peter: Hey.", selected, "assistant", "display", { character: "Peter" }), "Hello.");
  const userRule = { ...newRegexRule(), find: String.raw`/^{{user}}: (.+)$/`, replace: "$1",
    mode: "prompt" as const, appliesTo: ["user" as const] };
  assert.equal(applyRegex("A+B: Hi", [{ ...group, rules: [userRule] }], "user", "prompt",
    { user: "A+B" }), "Hi");
  group.rules.find((rule) => rule.id === DEFAULT_RULE_IDS.hideSpeakerName)!.enabled = false;
  assert.equal(show("Peter: Hey."), "Peter: Hey.");
});

test("current default rules initialize once and edits survive reload", async () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, { window: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } } });
  const first = await browserRegexStorage.load();
  const defaults = first.groups[0];
  assert.equal(defaults.id, DEFAULT_REGEX_GROUP_ID);
  assert(defaults.rules.every((rule) => rule.enabled));
  await browserRegexStorage.transact((current) => ({ ...current, groups: current.groups.map((group) =>
    group.id === DEFAULT_REGEX_GROUP_ID ? { ...group, updatedAt: Date.now(), rules: group.rules.map((rule) =>
      rule.id === DEFAULT_RULE_IDS.hideSpeakerName ? { ...rule, find: "custom", enabled: false } : rule) } : group) }));
  const reloaded = await browserRegexStorage.load();
  assert.equal(reloaded.groups[0].rules.find((rule) => rule.id === DEFAULT_RULE_IDS.hideSpeakerName)?.find, "custom");
  assert.equal(reloaded.groups[0].rules.find((rule) => rule.id === DEFAULT_RULE_IDS.hideSpeakerName)?.enabled, false);
});
