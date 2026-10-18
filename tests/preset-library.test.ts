import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { activePreset, BUILTIN_PRESET_ID, createBuiltinPreset, createPresetDocument, validatePresetDocument } from "../lib/preset";
import { buildDisplayedPrompts, copyPreset, deletePreset, deletePrompt, exportPreset, importPreset, movePrompt,
  newPreset, promptEnabled, savePrompt, setActivePreset, setPromptEnabled, updatePreset } from "../lib/preset-library";
import { createPresetStorage } from "../lib/preset-storage";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { createChatEngine } from "./chat-engine-fixture";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import type { GenerationParameters } from "../lib/preset";

function memory() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  return { values, storage: createPresetStorage(() => storage) };
}

function custom() {
  const document = copyPreset(createPresetDocument(), BUILTIN_PRESET_ID, "Custom", "custom");
  return { document, preset: document.presets[1] };
}

test("invalid library IDs, active choice, fields, and built-in mutations fail closed", () => {
  const { document } = custom();
  for (const invalid of [
    { ...document, activePresetId: "missing" },
    { ...document, presets: [...document.presets, document.presets[1]] },
    { ...document, presets: document.presets.slice(1) },
    { ...document, extra: "unknown" },
    { ...document, presets: document.presets.map((entry) => ({ ...entry, builtIn: true })) },
  ]) assert.throws(() => validatePresetDocument(invalid));
  assert.equal(activePreset({ ...document, activePresetId: "missing" }).id, BUILTIN_PRESET_ID);
});

test("New and Copy create independent runnable custom pipelines", () => {
  const source = createPresetDocument();
  const created = newPreset(source);
  const copy = created.presets[1];
  assert.equal(copy.name, "New Preset");
  assert.equal(copy.builtIn, false);
  assert.notEqual(copy.id, BUILTIN_PRESET_ID);
  assert.deepEqual(copy.prompts, source.presets[0].prompts);
  assert.deepEqual(copy.promptOrder, source.presets[0].promptOrder);
  copy.prompts[0].name = "Independent";
  copy.promptOrder[0].enabled = false;
  copy.generation.temperature = 0.8;
  assert.equal(source.presets[0].prompts[0].name, "Base Instruction");
  assert.equal(source.presets[0].promptOrder[0].enabled, true);
  assert.deepEqual(source.presets[0].generation, {});
  const { document, preset } = custom();
  preset.description = "description";
  preset.generation = { maxTokens: 500 };
  const duplicated = copyPreset(document, "custom", undefined, "copy").presets[2];
  assert.deepEqual(duplicated, { ...preset, id: "copy", name: "Custom Copy" });
});

test("storage refuses built-in edits/deletion and invalid saves without changing raw data", async () => {
  const { storage } = memory();
  const document = await storage.load();
  const raw = await storage.readRaw();
  const edited = structuredClone(document); edited.presets[0].generation.temperature = 1;
  await assert.rejects(storage.save(edited), /read-only/);
  await assert.rejects(storage.transact((current) => ({ ...current, presets: [] })), /invalid active/);
  assert.throws(() => deletePreset(document, BUILTIN_PRESET_ID), /read-only/);
  assert.throws(() => updatePreset(document, document.presets[0]), /read-only/);
  assert.equal(await storage.readRaw(), raw);
});

test("Set Active and deleting active custom fall back safely to VEIL Default", () => {
  const { document } = custom();
  const active = setActivePreset(document, "custom");
  assert.equal(activePreset(active).id, "custom");
  assert.throws(() => setActivePreset(document, "missing"));
  assert.deepEqual(deletePreset(active, "custom"), createPresetDocument());
  assert.deepEqual(deletePreset(document, "custom"), createPresetDocument());
});

test("custom Info and Generation edits validate ranges and reset to Default", () => {
  const { document, preset } = custom();
  const edited = { ...preset, name: "Renamed", description: "Changed", generation: { temperature: 0, maxTokens: 1000000 } };
  const updated = updatePreset(document, edited);
  assert.deepEqual(updated.presets[1], edited);
  assert.deepEqual(updatePreset(updated, { ...edited, generation: {} }).presets[1].generation, {});
  for (const generation of [ { temperature: -1 }, { temperature: 2.1 }, { temperature: NaN },
    { maxTokens: 0 }, { maxTokens: 1.5 }, { maxTokens: 1000001 }, { topP: 1 } ])
    assert.throws(() => updatePreset(document, { ...preset, generation: generation as GenerationParameters }));
  assert.throws(() => updatePreset(document, { ...preset, name: " " }));
});

test("Prompt editing and renaming keep order references and enabled layers independent", () => {
  const { document, preset } = custom();
  const prompt = preset.prompts.find((entry) => entry.identifier === "response-directive")!;
  assert(prompt.source === "prompt");
  const edited = savePrompt(preset, prompt.identifier, { ...prompt, identifier: "my-directive", content: "NEW RD", name: "My Directive", role: "assistant", enabled: false });
  assert.equal(edited.prompts.some((entry) => entry.identifier === "response-directive"), false);
  assert.equal(edited.promptOrder.at(-1)?.identifier, "my-directive");
  assert.equal(edited.promptOrder.at(-1)?.enabled, true);
  assert.equal(edited.prompts.find((entry) => entry.identifier === "my-directive")?.enabled, false);
  assert.equal(updatePreset(document, edited).presets[1].prompts.find((entry) => entry.identifier === "my-directive")?.name, "My Directive");
  assert.throws(() => savePrompt(preset, prompt.identifier, { ...prompt, identifier: "base" }), /unique/);
  assert.throws(() => savePrompt(preset, prompt.identifier, { ...prompt, identifier: " " }));
});

test("adding/deleting ordinary Prompt changes both arrays and preserves marker identities", async () => {
  const { document, preset } = custom();
  const entry = { identifier: "extra", name: "Extra", source: "prompt" as const, role: "system" as const, enabled: true, content: "Extra instructions" };
  const added = savePrompt(preset, undefined, entry);
  assert.deepEqual(added.prompts.at(-1), entry);
  assert.deepEqual(added.promptOrder.at(-1), { identifier: "extra", enabled: true });
  assert.deepEqual(deletePrompt(added, "extra"), preset);
  assert.throws(() => savePrompt(preset, undefined, { ...entry, content: " " }));
  assert.throws(() => deletePrompt(preset, "history"), /ordinary/);
  assert.throws(() => deletePrompt(createBuiltinPreset(), "base"), /read-only/);
  const marker = preset.prompts.find((item) => item.source === "marker")!;
  const renamed = savePrompt(preset, marker.identifier, { ...marker, name: "My User", role: "user", enabled: false });
  assert.equal(renamed.prompts.find((item) => item.identifier === marker.identifier)?.name, "My User");
  assert.throws(() => updatePreset(document, { ...preset, prompts: preset.prompts.filter((item) => item !== marker) }), /marker|order/);
  assert.throws(() => savePrompt(preset, marker.identifier, { ...marker, source: "marker", marker: "history" }), /identities/);
  const { storage } = memory(); await storage.save(document);
  const removed = { ...preset, prompts: preset.prompts.filter((item) => item !== marker), promptOrder: preset.promptOrder.filter((item) => item.identifier !== marker.identifier) };
  await assert.rejects(storage.save({ ...document, presets: [document.presets[0], removed] }), /marker identities/);
});

test("validator rejects unknown fields, malformed role/marker, duplicate and orphan orders", () => {
  const { document, preset } = custom();
  const invalids = [
    { ...preset, prompts: [...preset.prompts, preset.prompts[0]] },
    { ...preset, promptOrder: [...preset.promptOrder, preset.promptOrder[0]] },
    { ...preset, promptOrder: [...preset.promptOrder, { identifier: "missing", enabled: true }] },
    { ...preset, prompts: preset.prompts.map((entry, i) => i === 0 ? { ...entry, role: ["system"] } : entry) },
    { ...preset, prompts: preset.prompts.map((entry) => entry.source === "marker" ? { ...entry, marker: "time" } : entry) },
    { ...preset, prompts: preset.prompts.map((entry) => entry.source === "marker" ? { ...entry, content: "snapshot" } : entry) },
    { ...preset, unexpected: true },
  ];
  for (const invalid of invalids) assert.throws(() => validatePresetDocument({ ...document, presets: [document.presets[0], invalid] }));
});

test("reordering changes promptOrder, and runtime respects both enabled flags", () => {
  const { preset } = custom();
  let ordered = movePrompt(preset, "base", 1);
  assert.equal(ordered.promptOrder[1].identifier, "base");
  assert.deepEqual(ordered.prompts, preset.prompts);
  assert.deepEqual(movePrompt(ordered, "base", -1), preset);
  const document = defaultFoundation();
  document.runtime.timeAware = false;
  const character = { characterId: "a", ...normalizeCharacterInput({ name: "A" }) };
  document.characters = [character];
  ordered = savePrompt(ordered, undefined, { identifier: "extra", name: "Extra", source: "prompt", role: "system", content: "UNIQUE EXTRA", enabled: true });
  ordered.promptOrder.find((entry) => entry.identifier === "extra")!.enabled = false;
  assert(!JSON.stringify(assembleChatPrompt(document, character, [], [], undefined, ordered)).includes("UNIQUE EXTRA"));
  ordered.promptOrder.find((entry) => entry.identifier === "extra")!.enabled = true;
  ordered.prompts.find((entry) => entry.identifier === "extra")!.enabled = false;
  assert(!JSON.stringify(assembleChatPrompt(document, character, [], [], undefined, ordered)).includes("UNIQUE EXTRA"));
  ordered.prompts.find((entry) => entry.identifier === "extra")!.enabled = true;
  assert(JSON.stringify(assembleChatPrompt(document, character, [], [], undefined, ordered)).includes("UNIQUE EXTRA"));
});

test("displayed Prompt pipeline follows order, de-duplicates, and safely appends orphans", () => {
  const { preset } = custom();
  const orphan = { identifier: "orphan", name: "Orphan", source: "prompt" as const,
    role: "system" as const, enabled: false, content: "orphan content" };
  const withOrphan = { ...preset,
    prompts: [...preset.prompts, orphan],
    promptOrder: [preset.promptOrder[2], preset.promptOrder[0], ...preset.promptOrder.slice(3)],
  };
  const displayed = buildDisplayedPrompts(withOrphan);
  assert.deepEqual(displayed.map((entry) => entry.identifier), [
    preset.promptOrder[2].identifier, preset.promptOrder[0].identifier,
    ...preset.promptOrder.slice(3).map((entry) => entry.identifier),
    preset.promptOrder[1].identifier, "orphan",
  ]);
  assert.equal(new Set(displayed.map((entry) => entry.identifier)).size, displayed.length);
  const moved = movePrompt(withOrphan, "orphan", -1);
  assert.equal(moved.promptOrder.at(-2)?.identifier, "orphan");
  const movedOrphan = moved.prompts.at(-1);
  assert(movedOrphan?.source === "prompt");
  assert.equal(movedOrphan.content, "orphan content");
  assert.equal(moved.prompts.at(-1)?.enabled, false);
  assert.equal(moved.promptOrder.at(-2)?.enabled, false);
});

test("effective enabled state keeps prompt and order layers synchronized", () => {
  const { preset } = custom();
  const identifier = preset.prompts[0].identifier;
  preset.promptOrder[0].enabled = false;
  assert.equal(promptEnabled(preset, identifier), false);
  const enabled = setPromptEnabled(preset, identifier, true);
  assert.equal(enabled.prompts[0].enabled, true);
  assert.equal(enabled.promptOrder[0].enabled, true);
  assert.equal(promptEnabled(enabled, identifier), true);
  const disabled = setPromptEnabled(enabled, identifier, false);
  assert.equal(disabled.prompts[0].enabled, false);
  assert.equal(disabled.promptOrder[0].enabled, false);
  assert.equal(promptEnabled(disabled, identifier), false);
  assert.throws(() => setPromptEnabled(createBuiltinPreset(), identifier, false), /read-only/);
});

test("Export/Import preserves configuration, handles ID collisions and never impersonates built-in", () => {
  const { document, preset } = custom();
  const exported = exportPreset(preset);
  const imported = importPreset(createPresetDocument(), exported);
  assert.deepEqual(imported.presets[1], preset);
  assert.equal(imported.activePresetId, BUILTIN_PRESET_ID);
  assert.equal(importPreset(document, exported, "collision-copy").presets[2].id, "collision-copy");
  const official = importPreset(document, exportPreset(createBuiltinPreset()), "official-copy");
  assert.equal(official.presets[2].builtIn, false);
  assert.equal(official.presets[2].id, "official-copy");
  const fake = { ...createBuiltinPreset(), name: "Fake", description: "Fake instructions" };
  const safe = importPreset(document, JSON.stringify(fake), "fake-copy");
  assert.deepEqual(safe.presets[0], createBuiltinPreset());
  assert.equal(safe.presets[2].builtIn, false);
  assert.throws(() => importPreset(document, "{broken"), /not valid Preset JSON/);
  assert.throws(() => importPreset(document, "{}"), /invalid/);
});

test("stale editor save rejects concurrent edits while unrelated active switch survives", async () => {
  const { storage } = memory();
  const { document, preset } = custom();
  await storage.save(document);
  await storage.transact((current) => setActivePreset(current, "custom"));
  await storage.transact((current) => updatePreset(current, { ...preset, description: "First edit" }, preset));
  assert.equal((await storage.load()).activePresetId, "custom");
  await assert.rejects(storage.transact((current) => updatePreset(current, { ...preset, name: "Stale" }, preset)), /changed elsewhere/);
  assert.equal((await storage.load()).presets[1].description, "First edit");
});

test("Chat re-reads active library choice next generation without altering existing messages", async () => {
  const { storage: presets } = memory();
  const { document, preset } = custom();
  const rd = preset.prompts.find((entry) => entry.identifier === "response-directive")!;
  assert(rd.source === "prompt"); rd.content = "CUSTOM ACTIVE DIRECTIVE";
  preset.generation = { temperature: 0.4, maxTokens: 123 };
  await presets.save(document);
  const factory = new IDBFactory();
  const chat = new ChatStorage(() => factory);
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const session = await chat.openSession("a");
  const captured: { prompt: string; generation?: GenerationParameters }[] = [];
  const engine = createChatEngine(chat, async () => foundation, async function* (_config, prompt, _signal, generation) {
    captured.push({ prompt: JSON.stringify(prompt), generation }); yield "reply";
  }, () => presets.load());
  await engine.send(session.id, "first"); await engine.requestReply(session.id);
  const before = await chat.readSession(session.id);
  await presets.transact((current) => setActivePreset(current, "custom"));
  assert.deepEqual(await chat.readSession(session.id), before);
  await engine.send(session.id, "second"); await engine.requestReply(session.id);
  await presets.transact((current) => setActivePreset(current, BUILTIN_PRESET_ID));
  await engine.send(session.id, "third"); await engine.requestReply(session.id);
  assert(!captured[0].prompt.includes("CUSTOM ACTIVE DIRECTIVE"));
  assert(captured[1].prompt.includes("CUSTOM ACTIVE DIRECTIVE"));
  assert.deepEqual(captured[1].generation, preset.generation);
  assert(!captured[2].prompt.includes("CUSTOM ACTIVE DIRECTIVE"));
  assert.equal((await chat.readSession(session.id)).messages.length, 6);
});
