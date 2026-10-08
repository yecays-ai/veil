import assert from "node:assert/strict";
import test from "node:test";
import { cleanupCharacterData, deleteCharacterWithData, previewCharacterDeletion, type CleanupDeps, type CleanupStep } from "../lib/character-deletion";
import { findLeftovers, hasLeftovers, reconcileInertReferences, removeLeftovers } from "../lib/character-leftovers";
import { ensureHereThereComment } from "../lib/here-there-comment";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import type { WeatherState } from "../lib/participant-config";
import type { Character } from "../lib/foundation-types";
import type { ThemeDocument } from "../lib/theme-types";
import { A, B, C, D, buildWorld, type Snapshot, type World } from "./character-deletion-fixture";

const without = (value: Snapshot, ...keys: (keyof Snapshot)[]) => { const copy = { ...value }; for (const key of keys) delete (copy as Partial<Snapshot>)[key]; return copy; };
const run = (world: World, id = A) => deleteCharacterWithData({ characterId: id, commitFoundation: world.commitFoundation, deps: world.deps });
const widgets = (theme: ThemeDocument) => theme.current.widgets;
const hereThere = (theme: ThemeDocument) => widgets(theme).filter((w) => w.type === "here-there");
const fails = (deps: CleanupDeps, step: CleanupStep): CleanupDeps => {
  const boom = () => Promise.reject(new Error(`${step} down`));
  switch (step) {
    case "widgets": return { ...deps, theme: { ...deps.theme, update: boom } };
    case "contact": return { ...deps, contacts: { ...deps.contacts, update: boom } };
    case "bindings": return { ...deps, bindings: { ...deps.bindings, update: boom } };
    case "groups": return { ...deps, chat: Object.assign(Object.create(deps.chat as object), { removeGroupMembers: boom }) };
    case "conversation": return { ...deps, chat: Object.assign(Object.create(deps.chat as object), { deleteSession: boom }) };
  }
};

test("deleting a Character removes all of its data and leaves every other Character and shared resource intact", async () => {
  const world = await buildWorld();
  const before = await world.snapshot();
  const report = await run(world);
  assert.deepEqual(report.failed, []);
  const after = await world.snapshot();

  assert.equal(JSON.stringify(after).includes(A), false, "no stored record may still mention the deleted Character");
  assert.equal(after.sessions.some((s) => (s as { id: string }).id === world.ids.sessionA.id), false);
  assert.equal((after.messages as { sessionId: string }[]).some((m) => m.sessionId === world.ids.sessionA.id), false);
  // Character B's conversation, the shared wallpaper asset and unrelated groups are untouched.
  assert.deepEqual((after.messages as { sessionId: string }[]).filter((m) => m.sessionId === world.ids.sessionB.id),
    (before.messages as { sessionId: string }[]).filter((m) => m.sessionId === world.ids.sessionB.id));
  assert.deepEqual(after.assets, before.assets);
  const group = (id: string) => after.sessions.find((s) => (s as { id: string }).id === id) as { participantIds: string[]; characterId: string };
  assert.deepEqual(group(world.ids.trio.id).participantIds, [B, C]);
  assert.equal(group(world.ids.trio.id).characterId, B);
  assert.deepEqual(group(world.ids.duo.id).participantIds, [B]);
  assert.deepEqual(group(world.ids.withDave.id).participantIds, [D]);
  assert.equal(group(world.ids.withDave.id).characterId, D);
  assert.deepEqual(group(world.ids.pair.id), (before.sessions.find((s) => (s as { id: string }).id === world.ids.pair.id)));
  // Widgets stay; only the deleted Character's link and remark go.
  assert.equal(widgets(after.theme).length, 3);
  assert.equal(widgets(after.theme).find((w) => w.id === "ht-a")?.config.characterId, undefined);
  assert.equal(widgets(after.theme).find((w) => w.id === "ht-a")?.config.comment, undefined);
  assert.deepEqual(widgets(after.theme).filter((w) => w.id !== "ht-a"), widgets(before.theme).filter((w) => w.id !== "ht-a"));
  assert.equal(after.theme.presets.length, 2);
  const presetWidget = after.theme.presets[0].snapshot.widgets.find((w) => w.id === "ht-a");
  assert.deepEqual([presetWidget?.config.characterId, presetWidget?.config.comment], [undefined, undefined]);
  assert.equal(after.theme.presets[0].snapshot.widgets.find((w) => w.id === "ht-b")?.config.characterId, B);
  assert.deepEqual(after.theme.presets[1], before.theme.presets[1]);
  assert.deepEqual(after.contacts.contacts.map((c) => c.characterId), [B]);
  assert.deepEqual(Object.keys(after.bindings.characters), [B]);
  assert.deepEqual(after.bindings.global, before.bindings.global);
  assert.deepEqual(after.foundation.characters.map((c) => c.characterId), [B, C, D]);
  assert.equal(after.foundation.universe.relations.length, 1);
  assert.deepEqual(without(after, "foundation", "theme", "contacts", "bindings", "sessions", "messages", "worldBookStates"),
    without(before, "foundation", "theme", "contacts", "bindings", "sessions", "messages", "worldBookStates"));
});

test("a group outlives its members: the last member leaving leaves an empty group with no dangling ID", async () => {
  const world = await buildWorld();
  await run(world, A);
  await run(world, D);
  const sessions = await world.chat.listSessions();
  const withDave = sessions.find((s) => s.id === world.ids.withDave.id)!;
  assert.deepEqual(withDave.participantIds, []);
  assert.equal(withDave.characterId, "");
  assert.equal(JSON.stringify(sessions).includes(D), false);
  assert.equal(sessions.filter((s) => s.type === "group").length, 4);
  // Re-reading and listing never throws on an empty group, and a repeat is a no-op.
  assert.deepEqual(await world.chat.removeGroupMembers([D]), []);
});

test("a background image only the deleted Character used is reclaimed; a shared one stays", async () => {
  const exclusive = await buildWorld({ aBackground: "exclusive" });
  const exclusiveBefore = (await exclusive.snapshot()).assets.length;
  await run(exclusive);
  assert.equal((await exclusive.snapshot()).assets.length, exclusiveBefore - 1);
  const shared = await buildWorld({ aBackground: "shared" });
  const sharedBefore = (await shared.snapshot()).assets;
  await run(shared);
  assert.deepEqual((await shared.snapshot()).assets, sharedBefore);
});

test("a Here & There remark still being generated cannot be written back after the Character is deleted", async () => {
  const world = await buildWorld();
  const foundation = await world.foundation.load();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const services = { bindings: async () => ({ global: {}, characters: {} }), foundation: async () => foundation, presets: async () => createPresetDocument(),
    api: async (id: string) => ({ id, apiKey: "test", model: "test", baseUrl: "https://example.test/v1" }),
    settings: async () => ({ hereThereEnabled: true }), claimOpportunity: async () => 1, scheduleRetry: async () => true,
    provider: async function* () { await gate; yield "I am a ghost."; } as TextProvider };
  const widget = hereThere((await world.themeStore.load()))[0];
  const context = { foundation, characterId: A, now: new Date("2026-10-08T12:00:00Z"),
    hereWeather: { status: "error", message: "x" } as WeatherState, thereWeather: { status: "error", message: "x" } as WeatherState };
  const pending = ensureHereThereComment(widget, context, (update) => world.deps.theme.update(update) as Promise<void>, services);
  await run(world);
  release();
  await pending;
  assert.equal(JSON.stringify(await world.themeStore.load()).includes("ghost"), false);
  assert.equal(JSON.stringify(await world.themeStore.load()).includes(A), false);
});

test("each cleanup step can fail on its own; the report names it, the rest finish, and a retry completes", async () => {
  for (const step of ["widgets", "groups", "conversation", "contact", "bindings"] as const) {
    const world = await buildWorld();
    const report = await deleteCharacterWithData({ characterId: A, commitFoundation: world.commitFoundation, deps: fails(world.deps, step) });
    assert.deepEqual(report.failed.map((f) => f.step), [step], step);
    assert.equal(report.completed.length, 4, step);
    assert.equal((await world.foundation.load()).characters.some((c) => c.characterId === A), false, "Foundation delete is already committed");
    const retried = await cleanupCharacterData(A, world.deps);
    assert.deepEqual(retried.failed, [], step);
    assert.equal(JSON.stringify(await world.snapshot()).includes(A), false, step);
    const settled = await world.snapshot();
    assert.deepEqual((await cleanupCharacterData(A, world.deps)).failed, []);
    assert.deepEqual(await world.snapshot(), settled, "a third run changes nothing");
  }
});

test("when the Foundation delete itself fails nothing is touched and no cleanup runs", async () => {
  const world = await buildWorld();
  const before = await world.snapshot();
  await assert.rejects(deleteCharacterWithData({ characterId: A, deps: world.deps, commitFoundation: () => Promise.reject(new Error("commit failed")) }), /commit failed/);
  assert.deepEqual(await world.snapshot(), before);
  const stored = { ...(await world.foundation.load()).characters.find((c) => c.characterId === A)! } as Partial<Character>;
  delete stored.characterId;
  const baseline = { ...stored, name: "edited in another tab" } as Omit<Character, "characterId">;
  await assert.rejects(deleteCharacterWithData({ characterId: A, baseline, deps: world.deps, commitFoundation: world.commitFoundation }));
  assert.deepEqual(await world.snapshot(), before);
});

test("a Character whose conversation is generating a reply is not deleted", async () => {
  const world = await buildWorld();
  await world.chat.claimGeneration(world.ids.sessionA.id);
  const before = await world.snapshot();
  await assert.rejects(run(world), /reply is being generated/);
  assert.deepEqual(await world.snapshot(), before);
});

test("the deletion preview counts exactly what the deletion will touch, without changing anything", async () => {
  const world = await buildWorld();
  const before = await world.snapshot();
  const impact = await previewCharacterDeletion(await world.foundation.load(), A, world.deps);
  assert.deepEqual(impact.conversation, { messages: 3, hasBackground: true });
  assert.deepEqual(impact.groups.map((g) => g.id).sort(), [world.ids.trio.id, world.ids.duo.id, world.ids.withDave.id].sort());
  assert.equal(impact.contact, true);
  assert.deepEqual(impact.widgets, { layout: 1, presets: 1 });
  assert.equal(impact.bindings, true);
  assert.equal(impact.relations, 1);
  assert.deepEqual(await world.snapshot(), before);
  const none = await previewCharacterDeletion(await world.foundation.load(), C, world.deps);
  assert.deepEqual([none.conversation, none.groups.length, none.contact, none.bindings], [null, 2, false, false]);
});

test("historical orphans: only references without user content are cleared automatically", async () => {
  const world = await buildWorld();
  // Simulate the old behaviour: Foundation delete only.
  await world.commitFoundation((document) => ({ ...document, characters: document.characters.filter((c) => c.characterId !== A),
    universe: { ...document.universe, relations: [], nodePositions: {} } as never }));
  const before = await world.snapshot();
  const report = await reconcileInertReferences(world.foundation, world.deps);
  assert.deepEqual(report.failed, []);
  const after = await world.snapshot();
  assert.deepEqual(after.sessions.filter((s) => (s as { type?: string }).type !== "group"), before.sessions.filter((s) => (s as { type?: string }).type !== "group"));
  assert.deepEqual(after.messages, before.messages);
  assert.deepEqual(after.contacts, before.contacts, "contact records hold user content and need confirmation");
  assert.equal(JSON.stringify(after.theme).includes(A), false);
  assert.equal(JSON.stringify(after.bindings).includes(A), false);
  assert.equal(JSON.stringify(after.sessions.filter((s) => (s as { type?: string }).type === "group")).includes(A), false);
  const settled = await world.snapshot();
  await reconcileInertReferences(world.foundation, world.deps);
  assert.deepEqual(await world.snapshot(), settled, "idempotent");

  const leftovers = await findLeftovers(world.foundation, world.deps);
  assert.deepEqual(leftovers.conversations.map((c) => [c.characterId, c.messages]), [[A, 3]]);
  assert.deepEqual(leftovers.contacts, [{ characterId: A }]);
  assert.equal(hasLeftovers(leftovers), true);
  assert.deepEqual(await world.snapshot(), settled, "finding leftovers deletes nothing");
  assert.deepEqual(await removeLeftovers(leftovers, world.foundation, world.deps), { removed: 2, skipped: 0, failed: 0 });
  assert.equal(JSON.stringify(await world.snapshot()).includes(A), false);
  assert.equal(hasLeftovers(await findLeftovers(world.foundation, world.deps)), false);
});

test("reconciliation does nothing when Foundation cannot be read, is empty, or the Character reappeared", async () => {
  const world = await buildWorld();
  await world.commitFoundation((document) => ({ ...document, characters: document.characters.filter((c) => c.characterId !== A) }));
  const before = await world.snapshot();
  const broken = { load: () => Promise.reject(new Error("db down")) };
  assert.deepEqual(await reconcileInertReferences(broken, world.deps), { completed: [], failed: [] });
  assert.equal(hasLeftovers(await findLeftovers(broken, world.deps)), false);
  const empty = { load: async () => ({ ...(await world.foundation.load()), characters: [] }) };
  assert.deepEqual(await reconcileInertReferences(empty, world.deps), { completed: [], failed: [] });
  assert.deepEqual(await world.snapshot(), before);

  const leftovers = await findLeftovers(world.foundation, world.deps);
  const everyone = { load: async () => { const doc = await world.foundation.load(); return { ...doc, characters: [...doc.characters, { ...doc.characters[0], characterId: A }] }; } };
  assert.deepEqual(await removeLeftovers(leftovers, everyone, world.deps), { removed: 0, skipped: 2, failed: 0 });
  assert.deepEqual(await world.snapshot(), before);
});
