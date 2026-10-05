import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createBuiltinPreset, createPresetDocument, validatePresetDocument } from "../lib/preset";
import { normalizeWorldBook } from "../lib/worldbook";

async function setup(entries: object[]) {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation();
  document.runtime.timeAware = false;
  document.characters = [{ characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) }];
  const session = await storage.openSession("p");
  await storage.saveApiConfig({ id: "chat-default", baseUrl: "https://example.test/v1", apiKey: "key", model: "test" });
  const books = { version: 1 as const, books: [normalizeWorldBook({ name: "Lore", entries })] };
  return { storage, document, session, books };
}

test("current pending user activates Before/After now, with Universe independent and Preset order authoritative", async () => {
  const { storage, document, session, books } = await setup([
    { content: "Before Otto", key: ["Otto"], position: "before" },
    { content: "After Otto", key: ["Otto"], position: "after" },
  ]);
  document.universe.worldSetting = "Static Universe";
  await storage.send(session.id, "Otto arrived");
  const prompts: string[] = [];
  const preset = createPresetDocument();
  const active = preset.presets[0];
  const beforeIndex = active.promptOrder.findIndex((item) => item.identifier === "world-info-before");
  const afterIndex = active.promptOrder.findIndex((item) => item.identifier === "world-info-after");
  [active.promptOrder[beforeIndex], active.promptOrder[afterIndex]] = [active.promptOrder[afterIndex], active.promptOrder[beforeIndex]];
  // A reordered custom copy is valid; the official built-in remains immutable.
  preset.presets.push({ ...structuredClone(active), id: "custom", name: "Custom", builtIn: false });
  preset.presets[0] = createBuiltinPreset();
  preset.activePresetId = "custom";
  const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
    prompts.push(turns.map((turn) => turn.content).join("\n"));
    yield "First\n\nSecond\n\nThird";
  }, async () => preset, undefined, async () => books);
  await engine.requestReply(session.id);
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].indexOf("After Otto") < prompts[0].indexOf("Before Otto"));
  assert.match(prompts[0], /Static Universe/);
  assert.deepEqual((await storage.readSession(session.id)).messages.slice(1).map((message) => message.content),
    ["First", "Second", "Third"]);
  assert.equal((await storage.readWorldBookState(session.id))?.cycle, 1);
});

test("empty World Info markers produce no prompt content, and disabled bindings suppress books", async () => {
  const { storage, document, session, books } = await setup([{ content: "Hidden Lore", key: ["Other"] }]);
  await storage.send(session.id, "Hello");
  const prompts: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
    prompts.push(turns.map((turn) => turn.content).join("\n")); yield "Okay";
  }, undefined, undefined, async () => books);
  await engine.requestReply(session.id);
  assert.doesNotMatch(prompts[0], /world-info-before|world-info-after|Hidden Lore/);
  document.bindings.global.worldBookIds = [];
  await storage.send(session.id, "Other");
  await engine.requestReply(session.id);
  assert.doesNotMatch(prompts[1], /Hidden Lore/);
});

test("Regenerate discards future lore; failure and Stop never commit timed state", async () => {
  const { storage, document, session, books } = await setup([{ content: "LORE_X", key: ["trigger"], sticky: 4 }]);
  await storage.send(session.id, "hello");
  let output = "A\n\nB\n\ntrigger";
  const prompts: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
    prompts.push(turns.map((turn) => turn.content).join("\n"));
    yield output;
  }, undefined, undefined, async () => books);
  await engine.requestReply(session.id);
  const initial = await storage.readSession(session.id);
  assert.equal(initial.messages.length, 4);
  output = "New B";
  await engine.regenerateMessage(initial.messages[2].id, undefined, session.id);
  const after = await storage.readSession(session.id);
  assert.deepEqual(after.messages.map((item) => item.content), ["hello", "A", "New B"]);
  assert.doesNotMatch(prompts[1], /trigger|LORE_X/);
  assert.equal((await storage.readWorldBookState(session.id))?.cycle, 1);

  await storage.send(session.id, "trigger");
  const stateBeforeFailure = await storage.readWorldBookState(session.id);
  const failing = createChatEngine(storage, async () => document, async function* () { throw new Error("offline"); },
    undefined, undefined, async () => books);
  assert.equal((await failing.requestReply(session.id))?.status, "error");
  assert.deepEqual(await storage.readWorldBookState(session.id), stateBeforeFailure);
  await storage.send(session.id, "again");
  const stopped = createChatEngine(storage, async () => document, async function* () {
    stopped.stop(session.id); yield "partial";
  }, undefined, undefined, async () => books);
  assert.equal((await stopped.requestReply(session.id))?.status, "cancelled");
  assert.deepEqual(await storage.readWorldBookState(session.id), stateBeforeFailure);
});

test("existing official and custom Presets gain World Info markers while retaining prior prompt order", () => {
  const old = createBuiltinPreset();
  old.prompts = old.prompts.filter((item) => !item.identifier.startsWith("world-info-"));
  old.promptOrder = old.promptOrder.filter((item) => !item.identifier.startsWith("world-info-"));
  const custom = { ...structuredClone(old), id: "custom", name: "Personal", builtIn: false };
  const document = validatePresetDocument({ version: 3, presets: [old, custom], activePresetId: "custom" });
  assert.equal(document.presets[0].prompts.filter((item) => item.identifier.startsWith("world-info-")).length, 2);
  assert.equal(document.presets[1].prompts.filter((item) => item.identifier.startsWith("world-info-")).length, 2);
  assert.deepEqual(document.presets[1].promptOrder.filter((item) => !item.identifier.startsWith("world-info-")), old.promptOrder);
});

test("editing and deleting real history invalidate sticky lore, and Clear removes timed state", async () => {
  for (const mutation of ["edit", "delete"] as const) {
    const { storage, document, session, books } = await setup([{ content: "Old Lore", key: ["Otto"], sticky: 6 }]);
    const first = await storage.send(session.id, "Otto");
    const prompts: string[] = [];
    const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
      prompts.push(turns.map((turn) => turn.content).join("\n")); yield "reply";
    }, undefined, undefined, async () => books);
    await engine.requestReply(session.id);
    assert.ok(await storage.readWorldBookState(session.id));
    if (mutation === "edit") await storage.editMessage(first.id, "Different topic");
    else await storage.deleteMessages(session.id, [first.id]);
    await storage.send(session.id, "Hello again");
    await engine.requestReply(session.id);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[1], /Old Lore/);
    assert.equal((await storage.readWorldBookState(session.id))?.cycle, 1);
    await storage.clearSession(session.id);
    assert.equal(await storage.readWorldBookState(session.id), null);
  }
});

test("Book and Entry toggles are read again for the next generation", async () => {
  const { storage, document, session, books } = await setup([{ content: "Active Lore", constant: true }]);
  const prompts: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
    prompts.push(turns.map((turn) => turn.content).join("\n")); yield "reply";
  }, undefined, undefined, async () => books);
  await storage.send(session.id, "one"); await engine.requestReply(session.id);
  assert.match(prompts[0], /Active Lore/);
  books.books[0].entries[0].enabled = false;
  await storage.send(session.id, "two"); await engine.requestReply(session.id);
  assert.doesNotMatch(prompts[1], /Active Lore/);
  books.books[0].entries[0].enabled = true;
  books.books[0].enabled = false;
  await storage.send(session.id, "three"); await engine.requestReply(session.id);
  assert.doesNotMatch(prompts[2], /Active Lore/);
});
