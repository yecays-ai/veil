import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { createBuiltinPreset, createPresetDocument, validatePreset } from "../lib/preset";
import { importPreset } from "../lib/preset-library";
import { createPresetStorage } from "../lib/preset-storage";
import { createBindingStorage } from "../lib/binding-storage";
import { resolveBindings, setBindingField } from "../lib/bindings";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

function input(id: string) {
  const preset = { ...createBuiltinPreset(), id, builtIn: false, name: "D6 contract test" };
  preset.prompts = preset.prompts.map((p) => p.source === "prompt" && p.identifier === "base"
    ? { ...p, content: "D6_IMPORTED_PRESET_SENTINEL" } : p);
  return JSON.stringify(preset);
}
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
test("phone fixtures are valid Presets with the documented import outcomes", () => {
  for (const name of ["long", "whitespace", "normal"]) {
    const json = readFileSync(`docs/fixtures/d6/preset-${name}-id-test.json`, "utf8");
    validatePreset(JSON.parse(json));
    if (name === "normal") assert.equal(importPreset(createPresetDocument(), json).presets.at(-1)?.id, "d6-phone-contract");
    else assert.throws(() => importPreset(createPresetDocument(), json), /Preset ID must/);
  }
});
for (const id of ["x".repeat(201), " padded", "padded ", " padded "]) {
  test(`new import rejects incompatible ID ${JSON.stringify(id)}`, () => {
    const document = createPresetDocument(), before = JSON.stringify(document);
    assert.throws(() => importPreset(document, input(id)), /Preset ID must be 1–200 characters with no leading or trailing whitespace/);
    assert.equal(JSON.stringify(document), before);
  });
}
test("collision replacement must also be bindable and cannot overwrite an existing ID", () => {
  const document = importPreset(createPresetDocument(), input("existing"));
  for (const id of ["x".repeat(201), " padded ", "existing"]) {
    assert.throws(() => importPreset(document, input("existing"), id));
  }
});
test("stored legacy IDs and contents stay unchanged through load and a new import", async () => {
  const raw = memory(), storage = createPresetStorage(() => raw);
  const legacy = ["x".repeat(201), " padded "].map((id) => JSON.parse(input(id)));
  const document = { ...createPresetDocument(), presets: [...createPresetDocument().presets, ...legacy] };
  await storage.save(document);
  const before = [...raw.values.entries()];
  assert.deepEqual(await storage.load(), document);
  assert.deepEqual([...raw.values.entries()], before);
  await storage.transact((current) => importPreset(current, input("normal")));
  assert.deepEqual((await storage.load()).presets.slice(1, 3), legacy);
});
for (const id of ["normal-id", "x".repeat(200), "existing"]) {
  test(`successful import ${id.slice(0, 20)} survives Binding storage and actual generation`, async () => {
    const raw = memory(), presets = createPresetStorage(() => raw);
    let original = createPresetDocument();
    if (id === "existing") original = importPreset(original, input(id));
    await presets.save(original);
    const saved = await presets.transact((current) => importPreset(current, input(id), "collision-copy"));
    assert.deepEqual(saved.presets.slice(0, original.presets.length), original.presets);
    const imported = saved.presets.at(-1)!;
    assert.equal(imported.id, id === "existing" ? "collision-copy" : id);
    const bindings = createBindingStorage(() => raw, () => undefined);
    await bindings.transact((current) => setBindingField(current, { characterId: "p" }, "presetId", imported.id));
    assert.equal(resolveBindings(await bindings.load(), "p", "messages").presetId, imported.id);
    const factory = new IDBFactory();
    const chat = new ChatStorage(() => factory), foundation = defaultFoundation();
    foundation.runtime.timeAware = false;
    foundation.characters = [{ characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) }];
    const captured: string[] = [];
    const engine = createChatEngine(chat, async () => foundation, async function* (_config, prompt) {
      captured.push(JSON.stringify(prompt)); yield "reply";
    }, () => presets.load(), undefined, undefined, undefined, () => bindings.load());
    const session = await chat.openSession("p");
    await engine.send(session.id, "D6 test"); await engine.requestReply(session.id);
    assert.equal(captured.length, 1);
    assert.match(captured[0], /D6_IMPORTED_PRESET_SENTINEL/);
  });
}
