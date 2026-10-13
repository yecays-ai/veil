import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { progressFixture, deferred } from "./memory-progress-fixture";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage, FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { buildMaintenanceInput } from "../lib/memory/maintenance-input";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";
import { type StateOperation } from "../lib/memory/state-maintenance";
import { readCharacterState, statePromptEntries, STATE_CONTEXT_LIMITS, STATE_AUTHORITY } from "../lib/memory/state-runtime";
import { memorySourceHash } from "../lib/memory/source-hash";
import { effectiveCharacterStates } from "../lib/memory/state-foundation";
import { resumeStartupClears } from "../lib/memory/startup";
import { cursorId, request } from "../lib/memory/storage";
import { runMaintenance, MAINTENANCE_IDLE_MS } from "../lib/memory/maintenance-runner";
import { packageFixture, backupData } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { IndexedDBDocumentStorage } from "../lib/core-document-storage";
import { addManualMemory, addJournalEntry } from "../lib/memory/bank";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { MemoryStorage } from "../lib/memory/storage";
import { lockOrigin } from "./generation-lock-fixture";
import { exportStaticBackup } from "../lib/backup/static-export";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, restoreIntoEmpty, replaceWithBackup, recoverRestore, RESTORE_JOURNAL_KEY } from "../lib/backup/restore";

async function fixture() {
  const f = await progressFixture();
  const character = { characterId: "c", ...normalizeCharacterInput({ name: "Peter", backstory: "Peter is a student in a fictional world." }) };
  await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, await f.core.read(FOUNDATION_STORAGE_KEY), JSON.stringify({ ...defaultFoundation(), characters: [character] }));
  const chat = new ChatStorage(() => f.factory, () => f.locks, f.gate, true, f.memory);
  const foundation = createIndexedDBFoundationStorage(f.core, f.memory);
  const source = { ...f.source, readChat: chat.readMemorySources.bind(chat), readStateSources: chat.readStateSources.bind(chat) };
  const protocol = new MemoryProgressProtocol(f.memory, source, f.locks, true);
  return { ...f, chat, source, protocol, foundation, character,
    send: (text = "Peter moved permanently to a new home.") => chat.send(f.session.id, text),
    view: () => f.memory.withExclusive((scope) => readCharacterState(f.memory, character, scope, (id, ids) => chat.readStateSources(id, ids, scope))) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function create(snapshot: Awaited<ReturnType<MemoryProgressProtocol["readInput"]>>, value = "Peter now lives in Queens."): StateOperation {
  return { op: "STATE_CREATE", key: "home", value, backgroundId: snapshot.state!.background.id,
    messageIds: [snapshot.messages[0].id], assessment: { subject: "character", reality: "actual", duration: "lasting", significance: "major" }, compatibility: "compatible" };
}
async function maintain(f: Fixture, operations: (snapshot: Awaited<ReturnType<MemoryProgressProtocol["readInput"]>>) => StateOperation[]) {
  return f.protocol.withOwner("c", async (owner) => {
    const through = (await f.progress())?.throughSeq ?? 0;
    const view = await f.memory.withExclusive((scope) => f.chat.readMemorySources(f.session.id, scope));
    const ticket = await f.protocol.prepare(owner, f.session.id, through + 1, view.session!.memorySequence!.nextSeq - 1);
    const snapshot = await f.protocol.readInput(ticket);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await f.protocol.commitAutomatic(ticket, { put: [], stateOperations: operations(snapshot) });
    return snapshot;
  });
}
async function marker(f: Fixture, ids: string[]) {
  const messages = (await f.snapshot()).messages.filter((m) => ids.includes(m.id));
  const hashes = await Promise.all(messages.map(async (m) => ({ messageId: m.id, hash: await memorySourceHash(m) })));
  await f.memory.transaction("readwrite", async (tx) => {
    const id = cursorId("c", f.session.id), old = await request(tx.store("cursors").get(id));
    await request(tx.store("cursors").put({ failureCount: 0, ...old, id, characterId: "c", sessionId: f.session.id,
      clearToken: "test-intent", clearRequestedAt: 100, clearMessageIds: ids,
      sourceInvalidation: { messages: hashes }, updatedAt: 100 }));
  });
}
function recovery(f: Fixture) {
  return resumeStartupClears(f.memory, {
    aliveCharacters: async () => new Set(["c"]), sessionIds: async () => new Set([f.session.id]),
    countMessages: (id, scope) => f.chat.countMessages(id, scope),
    existingMessageIds: (id, ids, scope) => f.chat.existingMessageIds(id, ids, scope),
    sourceHashes: async (id, ids, scope) => new Map(await Promise.all((await f.chat.readStateSources(id, ids, scope)).messages.map(async (m) => [m.id, await memorySourceHash(m)] as const))),
  });
}

test("saved Background creates an immutable initial version, and later changes append only that Character", async () => {
  const f = await fixture(); await f.foundation.load();
  const first = await f.memory.readStateFoundation("c"); assert.equal(first.backgrounds.length, 1);
  await f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "Peter is now an engineer." })) }));
  const data = await f.memory.readStateFoundation("c");
  assert.deepEqual(data.backgrounds.toSorted((a, b) => a.version - b.version).map((r) => r.text), [f.character.backstory, "Peter is now an engineer."]);
  assert.deepEqual(first.backgrounds[0], data.backgrounds.find((row) => row.id === first.backgrounds[0].id)); assert.deepEqual(await f.memory.readStateFoundation("other"), { backgrounds: [], states: [] });
});
test("Background repair/load waits for a concurrent save under the existing exclusive lease", async () => {
  const f = await fixture(); await f.foundation.load(); const entered = deferred(), release = deferred();
  const original = f.core.replaceIfCurrent.bind(f.core);
  f.core.replaceIfCurrent = async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; };
  const save = f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "A new basis" })) }));
  await entered.promise; let readFinished = false;
  const load = f.foundation.load().then((doc) => { readFinished = true; return doc; });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(readFinished, false);
  release.resolve(); await save; const current = await load;
  assert.equal((await f.memory.readStateFoundation("c")).backgrounds.toSorted((a, b) => b.version - a.version)[0].text, current.characters[0].backstory);
});
test("failed second-database write is detectable and load recovers from saved Foundation, retaining original", async () => {
  const f = await fixture(); await f.foundation.load(); await f.send(); await maintain(f, (s) => [create(s)]);
  const original = f.memory.transaction.bind(f.memory); let writes = 0;
  f.memory.transaction = ((mode, ...args) => { if (mode === "readwrite" && ++writes === 2) return Promise.reject(new Error("simulated interruption")); return original(mode, ...args); }) as typeof f.memory.transaction;
  await assert.rejects(f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "Changed basis" })) })), /interruption/);
  f.memory.transaction = original;
  const raw = JSON.parse((await f.core.read(FOUNDATION_STORAGE_KEY))!); assert.equal(raw.characters[0].backstory, "Changed basis");
  const before = await f.memory.withExclusive((scope) => readCharacterState(f.memory, raw.characters[0], scope, (id, ids) => f.chat.readStateSources(id, ids, scope)));
  assert.equal(before.entries[0].status, "pending"); assert.deepEqual(statePromptEntries(before, raw.characters[0]), []);
  await f.foundation.load(); assert.equal((await f.memory.readStateFoundation("c")).backgrounds.length, 2);
});
test("shared scoped Background mutation is rejected before writing, but signature changes remain permitted", async () => {
  const f = await fixture();
  await assert.rejects(f.memory.withShared((scope) => f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "unsafe" })) }), scope)), /coordination/);
  const doc = await f.memory.withShared((scope) => f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, statusMessage: "Hello" })) }), scope));
  assert.equal(doc.characters[0].statusMessage, "Hello"); assert.equal(doc.characters[0].backstory, f.character.backstory);
});
test("State CREATE shares the maintenance progress transaction and never adds manual Undo", async () => {
  const f = await fixture(); await f.send(); await maintain(f, (s) => { assert.ok(s.state, "normal maintenance must supply authorized State input"); return [create(s)]; });
  const data = await f.memory.readStateFoundation("c"); assert.equal(data.states[0].sources.length, 1); assert.equal(data.states[0].sourceHashes!.length, 1);
  assert.equal((await f.progress())!.throughSeq, 1); assert.equal((await f.view()).entries[0].status, "active");
  assert.deepEqual(await f.memory.transaction("readonly", (tx) => request(tx.store("operations").getAll())), []);
});
for (const [field, value] of [["subject", "user"], ["reality", "hypothetical"], ["reality", "joke"], ["duration", "temporary"], ["significance", "routine"]])
  test(`State rejects ${field}=${value} instead of treating it as a major lasting Character change`, async () => {
    const f = await fixture(); await f.send();
    await f.protocol.withOwner("c", async (owner) => {
      const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(ticket);
      const operation = create(snapshot); if (operation.op === "STATE_CREATE") Object.assign(operation.assessment, { [field]: value });
      assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [operation] }), snapshot));
    });
    assert.deepEqual((await f.memory.readStateFoundation("c")).states, []);
  });
test("State input explicitly excludes Presence/Ongoing and preserves Character self-experience authority", async () => {
  const f = await fixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const snapshot = await f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 1, 1));
    const input = buildMaintenanceInput(snapshot, { characterId: "c", context: "fictional world" });
    assert.match(input[0].content, /Character's own account is evidence/); assert.match(input[0].content, /Ongoing tasks, Presence, Last Seen or signatures/);
    assert.equal(JSON.parse(input[1].content).background.text, f.character.backstory); assert.doesNotMatch(input[1].content, /sourceHashes/);
  });
});
test("State UPDATE versions retain old sources; deleting its new evidence restores the independently supported ancestor", async () => {
  const f = await fixture(); const first = await f.send(); await maintain(f, (s) => [create(s)]);
  const second = await f.send("Peter now owns a permanent home.");
  await maintain(f, (s) => {
    const operation = create(s, "Peter owns his home."); if (operation.op !== "STATE_CREATE") throw new Error("Invalid test operation");
    const { key: _key, op: _op, ...value } = operation; void [_key, _op];
    return [{ ...value, op: "STATE_UPDATE", targetId: s.state!.foundation.states[0].id }];
  });
  assert.equal((await f.memory.readStateFoundation("c")).states.length, 2);
  await f.chat.deleteMessages(f.session.id, [second.id]);
  const data = await f.memory.readStateFoundation("c"); assert.equal(data.states.length, 1); assert.equal(data.states[0].sources[0].messageId, first.id);
  assert.equal((await f.progress())!.throughSeq, 2); await f.chat.deleteMessages(f.session.id, [second.id]); assert.equal((await f.memory.readStateFoundation("c")).states.length, 1);
});
for (const verdict of ["compatible", "conflict", "pending"] as const) test(`Background review persists ${verdict} against the exact new version`, async () => {
  const f = await fixture(); await f.send(); await maintain(f, (s) => [create(s)]);
  await f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "Updated setting" })) }));
  await f.send("Another ordinary conversation.");
  await maintain(f, (s) => [{ op: "STATE_REVIEW", targetId: s.state!.foundation.states[0].id, backgroundId: s.state!.background.id, verdict }]);
  const data = await f.memory.readStateFoundation("c"); assert.equal(effectiveCharacterStates(data, "c")[0].status, verdict === "compatible" ? "active" : verdict === "conflict" ? "suspended" : "pending");
});
test("explicit pending re-review cannot retain a previous compatible verdict", async () => {
  const f = await fixture(); await f.send(); await maintain(f, (s) => [create(s)]); await f.send();
  await maintain(f, (s) => [{ op: "STATE_REVIEW", targetId: s.state!.foundation.states[0].id, backgroundId: s.state!.background.id, verdict: "pending" }]);
  assert.deepEqual(statePromptEntries(await f.view(), f.character), []);
});
test("unlisted source, stale basis, stale head, foreign target, and unknown fields are rejected", async () => {
  const f = await fixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const snapshot = await f.protocol.readInput(await f.protocol.prepare(owner, f.session.id, 1, 1));
    for (const change of [{ messageIds: ["foreign-message"] }, { backgroundId: "old" }, { extra: true }, { op: "STATE_UPDATE", targetId: "foreign-head", key: undefined }]) {
      assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [{ ...create(snapshot), ...change }] }), snapshot));
    }
  });
});
test("modifying the returned input cannot forge ticket State authority", async () => {
  const f = await fixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(ticket);
    snapshot.state!.background.id = "invented";
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [], stateOperations: [create(snapshot)] }));
    assert.deepEqual((await f.memory.readStateFoundation("c")).states, []); assert.equal((await f.progress())!.throughSeq, 0);
  });
});
test("Background changes after dispatch reject the late State and do not advance progress", async () => {
  const f = await fixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(ticket);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await f.foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "New authority" })) }));
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [], stateOperations: [create(snapshot)] })); assert.equal((await f.progress())!.throughSeq, 0);
  });
});
test("State write failure rolls back State, Memory, and progress together", async () => {
  const f = await fixture(); await f.send();
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1), snapshot = await f.protocol.readInput(ticket);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) { if (this.name === "states") throw new Error("State write interrupted"); return original.apply(this, args); };
    try { await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [], stateOperations: [create(snapshot)] })); } finally { IDBObjectStore.prototype.add = original; }
    assert.deepEqual((await f.memory.readStateFoundation("c")).states, []); assert.equal((await f.progress())!.throughSeq, 0);
  });
});
test("same-ID edits withdraw State; a no-op edit preserves it", async () => {
  const f = await fixture(); const message = await f.send(); await maintain(f, (s) => [create(s)]);
  await f.chat.editMessage(message.id, message.content); assert.equal((await f.memory.readStateFoundation("c")).states.length, 1);
  await f.chat.editMessage(message.id, "The earlier claim was wrong."); assert.equal((await f.memory.readStateFoundation("c")).states.length, 0);
});
test("regeneration invalidates every replaced bubble, including the reused first ID, without nested-lease deadlock", { timeout: 5_000 }, async () => {
  const f = await fixture(); await f.send(); const first = await f.chat.beginReply(f.session.id); assert.ok(first);
  const reply = await f.chat.finalizeReply(first.assistant.id, "I moved home.");
  await f.foundation.load(); const background = (await f.memory.readStateFoundation("c")).backgrounds[0];
  const replyHash = await memorySourceHash(reply[0]);
  await f.memory.transaction("readwrite", async (tx) => request(tx.store("states").add({ id: "s", characterId: "c", key: "home", version: 1, value: "Old home", previousId: null,
    backgroundId: background.id, review: { backgroundId: background.id, verdict: "compatible" }, sources: [{ sessionId: f.session.id, messageId: reply[0].id }],
    sourceHashes: [{ sessionId: f.session.id, messageId: reply[0].id, hash: replyHash }], createdAt: 100 })));
  const regeneration = await f.chat.beginReply(f.session.id, reply[0].id); assert.ok(regeneration);
  const regenerated = await f.chat.finalizeReply(regeneration.assistant.id, "That earlier home was wrong.");
  assert.equal(regenerated[0].id, reply[0].id); assert.deepEqual((await f.memory.readStateFoundation("c")).states, []);
});
test("crash before chat mutation withdraws the marker and keeps still-supported State", async () => {
  const f = await fixture(); const message = await f.send(); await maintain(f, (s) => [create(s)]); await marker(f, [message.id]);
  const report = await recovery(f); assert.equal(report.cancelled, 1); assert.equal((await f.memory.readStateFoundation("c")).states.length, 1);
});
test("crash after same-ID edit resumes cleanup; Prompt cannot expose the old value before recovery", async () => {
  const f = await fixture(); const message = await f.send(); await maintain(f, (s) => [create(s)]); await marker(f, [message.id]);
  const oldTab = new ChatStorage(() => f.factory, () => f.locks, f.gate, true); await oldTab.editMessage(message.id, "Replacement source");
  assert.deepEqual((await f.view()).entries, []); assert.equal((await recovery(f)).completed, 1);
  assert.deepEqual((await f.memory.readStateFoundation("c")).states, []); assert.equal((await recovery(f)).completed, 0);
});
test("older-tab same-ID edits are hidden by persisted hashes and withdrawn at the next normal input preparation", async () => {
  const f = await fixture(); const message = await f.send(); await maintain(f, (s) => [create(s)]);
  const oldTab = new ChatStorage(() => f.factory, () => f.locks, f.gate, true); await oldTab.editMessage(message.id, "Old content removed");
  assert.deepEqual((await f.view()).entries, []); await f.send(); await maintain(f, () => []);
  assert.deepEqual((await f.memory.readStateFoundation("c")).states, []);
});
test("only active State fits the full overlay budget; no duplicate key, pending, suspended, or partial value", () => {
  const character = { characterId: "c", backstory: "Base" };
  const entries = Array.from({ length: 12 }, (_, index) => ({ id: String(index), key: `key_${index}`, value: "x".repeat(400), status: "active" as const }));
  const view = { characterId: "c", background: "Base", entries: [...entries, { ...entries[0], value: "pending secret", status: "pending" as const }] };
  const selected = statePromptEntries(view, character); assert.ok(selected.length < entries.length);
  assert.ok(JSON.stringify({ stateAuthority: STATE_AUTHORITY, currentState: selected }).length <= STATE_CONTEXT_LIMITS.characters);
  assert.ok(selected.every((entry) => entry.value.length === 400)); assert.deepEqual(statePromptEntries(view, { ...character, characterId: "other" }), []);
});
test("State CREATE and existing Memory processing use exactly one stub request and leave Presence untouched", async () => {
  const f = await fixture(); await f.send(); let calls = 0;
  const done = await runMaintenance("c", { protocol: f.protocol, memory: f.memory, enabled: () => true, now: () => Date.now() + MAINTENANCE_IDLE_MS + 10_000,
    sessions: (scope) => scope ? f.chat.listExistingSessions(scope) : f.chat.listSessions(), readChat: f.chat.readMemorySources.bind(f.chat),
    model: async () => ({ config: { id: "stub", baseUrl: "https://example.invalid", apiKey: "stub", model: "stub" }, context: "Peter" }),
    provider: async function* (_config, input) {
      calls++; const data = JSON.parse(input[1].content);
      yield JSON.stringify({ operations: [{ op: "STATE_CREATE", key: "home", value: "Peter now lives in Queens.", backgroundId: data.background.id,
        messageIds: [data.messages[0].id], assessment: { subject: "character", reality: "actual", duration: "lasting", significance: "major" }, compatibility: "compatible" }, { op: "IGNORE" }] });
    } }, new AbortController().signal);
  assert.equal(done, true); assert.equal(calls, 1); assert.equal((await f.memory.readStateFoundation("c")).states.length, 1);
  assert.equal(JSON.parse((await f.core.read(FOUNDATION_STORAGE_KEY))!).characters[0].statusMessage, null);
});
test("backup rejects altered hash shape, extra copied text, stale source content, and pending source cleanup", async () => {
  const data = backupData(), message = data.chat.messages[0];
  data.memory.backgrounds = [{ id: "b", characterId: "peter", version: 1, text: null, createdAt: 100 }];
  data.memory.states = [{ id: "s", characterId: "peter", key: "home", version: 1, value: "A lasting fact", previousId: null, backgroundId: "b",
    review: { backgroundId: "b", verdict: "compatible" }, sources: [{ sessionId: message.sessionId, messageId: message.id }],
    sourceHashes: [{ sessionId: message.sessionId, messageId: message.id, hash: await memorySourceHash(message) }], createdAt: 100 }];
  const good = await packageFixture(data); await validateBackupPackage(JSON.stringify(good.manifest), good.files);
  for (const mutation of ["shape", "text", "changed", "pending"]) {
    const bad = structuredClone(data);
    if (mutation === "shape") bad.memory.states[0].sourceHashes![0].hash = "wrong";
    if (mutation === "text") Object.assign(bad.memory.states[0].sourceHashes![0], { content: "copied source" });
    if (mutation === "changed") bad.chat.messages[0].content = "replaced";
    if (mutation === "pending") Object.assign(bad.memory.cursors[0], { clearRequestedAt: 100, clearMessageIds: [message.id], sourceInvalidation: { messages: [{ messageId: message.id, hash: await memorySourceHash(message) }] } });
    const fixture = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(fixture.manifest), fixture.files));
  }
});

test("State commit preserves the five manual Undo records and Journal body exactly", async () => {
  const f = await fixture(); await f.send();
  for (let i = 0; i < 4; i++) await addManualMemory(f.memory, "c", { kind: "fact", text: `Manual ${i}` });
  await addJournalEntry(f.memory, "c", { text: "Journal PRIVATE", keywords: ["private"] });
  const undo = await f.memory.listOperations("c"), records = await f.memory.listMemories("c"); assert.equal(undo.length, 5);
  await maintain(f, (s) => [create(s)]);
  assert.deepEqual(await f.memory.listOperations("c"), undo); assert.deepEqual(await f.memory.listMemories("c"), records);
});

test("Character's own completed account supports State without requiring user confirmation of that fact", async () => {
  const f = await fixture(); await f.send("How have you been?"); const batch = await f.chat.beginReply(f.session.id); assert.ok(batch);
  const reply = await f.chat.finalizeReply(batch.assistant.id, "I permanently moved to Queens and started a new life.");
  // Ordinary subsequent input confirms delivery/replacement eligibility, not the truth of the Character's account.
  await f.send("Tell me about your day.");
  await maintain(f, (s) => [{ ...create(s), messageIds: [reply[0].id] }]);
  assert.equal((await f.view()).entries[0].status, "active"); assert.equal((await f.memory.readStateFoundation("c")).states[0].sources[0].messageId, reply[0].id);
});

for (const protectedKind of ["manual", "suppression"] as const) test(`State cannot revive ${protectedKind} protected content`, async () => {
  const f = await fixture(); const m = await f.send();
  if (protectedKind === "manual") await addManualMemory(f.memory, "c", { kind: "fact", text: "Peter now lives in Queens." });
  else await f.memory.applyChange("c", "suppressed", { suppress: [{ id: "suppressed", fingerprint: memoryFingerprint("Other text"), reason: "deleted", sources: [{ sessionId: f.session.id, messageId: m.id }] }] });
  const records = await f.memory.listMemories("c"), undo = await f.memory.listOperations("c");
  await assert.rejects(maintain(f, (s) => [create(s)])); assert.deepEqual((await f.memory.readStateFoundation("c")).states, []);
  assert.deepEqual(await f.memory.listOperations("c"), undo); assert.deepEqual(await f.memory.listMemories("c"), records);
});

test("single-message deletion cleans State and is idempotent without affecting another Character", async () => {
  const f = await fixture(); const m = await f.send(); await maintain(f, (s) => [create(s)]);
  const other = await f.chat.openSession("other"); await f.chat.send(other.id, "Other role content");
  await f.chat.deleteMessages(f.session.id, [m.id]); await f.chat.deleteMessages(f.session.id, [m.id]);
  assert.deepEqual((await f.memory.readStateFoundation("c")).states, []); assert.equal((await f.chat.readSession(other.id)).messages.length, 1);
});

test("post-chat cleanup failure retains durable intent, hides stale State and resumes safely", async () => {
  const f = await fixture(); const m = await f.send(); await maintain(f, (s) => [create(s)]);
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (...args) { if (this.name === "states") throw Error("cleanup interrupted"); return original.apply(this, args); };
  try { await assert.rejects(f.chat.editMessage(m.id, "New source")); } finally { IDBObjectStore.prototype.delete = original; }
  assert.equal((await f.snapshot()).messages[0].content, "New source");
  assert.ok((await f.memory.listCursors("c"))[0].sourceInvalidation); assert.deepEqual((await f.view()).entries, []);
  assert.equal((await recovery(f)).completed, 1); assert.deepEqual((await f.memory.readStateFoundation("c")).states, []);
});

test("State result cannot commit after restore admission closes, or owner lifetime ends", async () => {
  const f = await fixture(); await f.send();
  let saved!: Parameters<MemoryProgressProtocol["commitAutomatic"]>[0], operation!: StateOperation;
  await f.protocol.withOwner("c", async (owner) => {
    saved = await f.protocol.prepare(owner, f.session.id, 1, 1); operation = create(await f.protocol.readInput(saved));
    await f.protocol.claim(saved, 2); await f.protocol.transition(saved, "in-flight"); await f.protocol.transition(saved, "commit-pending");
    f.raw.set(RESTORE_JOURNAL_KEY, "interrupted");
    try { await assert.rejects(f.protocol.commitAutomatic(saved, { put: [], stateOperations: [operation] })); } finally { f.raw.delete(RESTORE_JOURNAL_KEY); }
  });
  await assert.rejects(f.protocol.commitAutomatic(saved, { put: [], stateOperations: [operation] }));
  assert.deepEqual((await f.memory.readStateFoundation("c")).states, []); assert.equal((await f.progress())!.throughSeq, 0);
});

test("persistent source hashes survive export, preview, empty/cover restore, rollback and interrupted resume", async () => {
  const data = backupData(), message = data.chat.messages[0];
  data.memory.backgrounds = [{ id: "basis", characterId: "peter", version: 1, text: null, createdAt: 100 }];
  data.memory.states = [{ id: "state", characterId: "peter", key: "career", version: 1, value: "Lasting career", previousId: null, backgroundId: "basis",
    sources: [{ sessionId: message.sessionId, messageId: message.id }], sourceHashes: [{ sessionId: message.sessionId, messageId: message.id, hash: await memorySourceHash(message) }],
    review: { backgroundId: "basis", verdict: "compatible" }, createdAt: 100 }];
  const indexedDB = new IDBFactory(), raw = new Map<string, string>(), locks = lockOrigin().client();
  const localStorage = { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); }, removeItem: (k: string) => { raw.delete(k); } };
  const gate = createPersistenceWriteGate(() => locks, () => localStorage), memory = new MemoryStorage(() => indexedDB, () => 100, gate), d = { indexedDB, localStorage, locks, raw };
  const first = await packageFixture(data), manifest = JSON.stringify(first.manifest);
  assert.equal((await previewRestore(manifest, first.files, d, locks)).mode, "empty-restore"); await restoreIntoEmpty(manifest, first.files, d, locks);
  assert.deepEqual((await memory.readStateFoundation("peter")).states, data.memory.states);
  const exported = await exportStaticBackup(d, { backupId: "p2-hashes", createdAt: 100, sourceCommit: "a".repeat(40) });
  assert.deepEqual((await validateBackupPackage(exported.manifestJson, exported.files)).data.memory.states, data.memory.states);
  const changed = structuredClone(data); changed.memory.states[0].value = "Changed lasting career";
  changed.foundation!.user.aboutMe = "Force the later Foundation restore unit to run";
  const second = await packageFixture(changed), secondManifest = JSON.stringify(second.manifest);
  const preview = await previewRestore(secondManifest, second.files, d, locks); const writers = createUnitWriters(d), write = writers.foundation.write; let once = true;
  writers.foundation.write = async (s) => { if (once) { once = false; throw Error("post-Memory interruption"); } await write(s); };
  await assert.rejects(replaceWithBackup(secondManifest, second.files, d, locks, { confirmed: preview, writers }));
  assert.deepEqual((await memory.readStateFoundation("peter")).states, data.memory.states); assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
  await replaceWithBackup(secondManifest, second.files, d, locks, { confirmed: await previewRestore(secondManifest, second.files, d, locks) });
  assert.deepEqual((await memory.readStateFoundation("peter")).states, changed.memory.states);
  const interrupted = createUnitWriters(d), memoryWrite = interrupted.memory.write;
  interrupted.memory.write = async (s) => { await memoryWrite(s); throw Error("interrupted restore"); }; interrupted.chat.write = async () => { throw Error("rollback interrupted"); };
  await assert.rejects(replaceWithBackup(manifest, first.files, d, locks, { confirmed: await previewRestore(manifest, first.files, d, locks), writers: interrupted }));
  assert.ok(raw.has(RESTORE_JOURNAL_KEY)); await recoverRestore("resume", d, locks, { manifestJson: manifest, files: first.files });
  assert.deepEqual((await memory.readStateFoundation("peter")).states, data.memory.states); assert.equal(raw.has(RESTORE_JOURNAL_KEY), false);
});

test("without Web Locks ordinary reply and signature saves work, while Background/source changes fail closed", async () => {
  const factory = new IDBFactory(), gate = createPersistenceWriteGate(() => undefined), memory = new MemoryStorage(() => factory, () => 100, gate);
  const core = new IndexedDBDocumentStorage(() => factory, gate), character = { characterId: "c", ...normalizeCharacterInput({ name: "Peter", backstory: "Base" }) };
  await core.putIfAbsent(FOUNDATION_STORAGE_KEY, JSON.stringify({ ...defaultFoundation(), characters: [character] }));
  const foundation = createIndexedDBFoundationStorage(core, memory), chat = new ChatStorage(() => factory, () => undefined, gate, false, memory);
  assert.equal((await foundation.load()).characters[0].backstory, "Base");
  const session = await chat.openSession("c"); await chat.send(session.id, "Hello"); const reply = await chat.beginReply(session.id); assert.ok(reply);
  assert.equal((await chat.finalizeReply(reply.assistant.id, "Hello there"))[0].content, "Hello there");
  await foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, statusMessage: "New signature" })) }));
  assert.equal((await foundation.load()).characters[0].statusMessage, "New signature");
  await assert.rejects(foundation.transact((doc) => ({ ...doc, characters: doc.characters.map((c) => ({ ...c, backstory: "Unsafe change" })) })));
  await assert.rejects(chat.editMessage(reply.assistant.id, "Replacement")); assert.equal((await foundation.load()).characters[0].backstory, "Base");
});

test("source content digest survives annotations and delivery metadata, but changes with replaced text", async () => {
  const f = await fixture(); const m = await f.send(); const digest = await memorySourceHash(m);
  assert.equal(await memorySourceHash({ ...m, confirmed: !m.confirmed, outcome: "success", order: 999 }), digest);
  assert.notEqual(await memorySourceHash({ ...m, content: "Replaced content" }), digest);
});
