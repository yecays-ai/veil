import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { appendBackgroundSnapshot, appendCharacterState, reviewCharacterState, effectiveCharacterStates,
  cleanCharacterStates, stateFoundationValid, type StateFoundation, type CharacterStateVersion } from "../lib/memory/state-foundation";
import { MemoryStorage, request } from "../lib/memory/storage";
import { completeClear, deleteCharacterMemory, recordClearIntent } from "../lib/memory/lifecycle";
import { createPersistenceWriteGate } from "../lib/backup/persistence-write-gate";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { exportStaticBackup } from "../lib/backup/static-export";
import { previewRestore } from "../lib/backup/restore-preview";
import { createUnitWriters, digestUnits, restoreIntoEmpty, replaceWithBackup, recoverRestore, RESTORE_JOURNAL_KEY } from "../lib/backup/restore";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture, replacePayload, TEST_COMMIT, TEST_NOW } from "./backup-fixture";
import { lockOrigin } from "./generation-lock-fixture";
import { progressFixture } from "./memory-progress-fixture";
import { parseMaintenanceOperations } from "../lib/memory/maintenance-operations";

const source = (messageId = "user-test", sessionId = "character:peter") => ({ sessionId, messageId });
const row = (id = "s1", extra: Partial<CharacterStateVersion> = {}): CharacterStateVersion => ({ id, characterId: "peter", key: "occupation",
  version: 1, value: "A sustained change", previousId: null, backgroundId: "b1", sources: [source()],
  review: { backgroundId: "b1", verdict: "compatible" }, createdAt: TEST_NOW, ...extra });
function foundation(): StateFoundation {
  return appendCharacterState(appendBackgroundSnapshot({ backgrounds: [], states: [] }, "peter", "Original Background", null, "b1", TEST_NOW), row(), null);
}
async function device() {
  const indexedDB = new IDBFactory(), raw = new Map<string, string>(), locks = lockOrigin().client();
  const localStorage = { getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); }, removeItem: (key: string) => { raw.delete(key); } };
  const gate = createPersistenceWriteGate(() => locks, () => localStorage), memory = new MemoryStorage(() => indexedDB, () => TEST_NOW, gate);
  return { indexedDB, localStorage, locks, raw, memory, gate };
}
/** Deliberate test-only seeding; production has no State writer or maintenance capability. */
async function seed(memory: MemoryStorage, data = foundation()) {
  await memory.transaction("readwrite", async (tx) => {
    for (const r of data.backgrounds) await request(tx.store("backgrounds").add(r));
    for (const r of data.states) await request(tx.store("states").add(r));
  });
}
async function pack(data = foundation()) {
  const payload = backupData(); payload.memory.backgrounds = data.backgrounds; payload.memory.states = data.states;
  return packageFixture(payload);
}
const validate = async (f: Awaited<ReturnType<typeof pack>>) => validateBackupPackage(JSON.stringify(f.manifest), f.files);

test("D1 immutable original, new basis requires explicit review and compatible/conflicting states differ", () => {
  const before = foundation();
  const second = appendCharacterState(before, row("location", { key: "location", value: "Lives elsewhere" }), null);
  const changed = appendBackgroundSnapshot(second, "peter", "New Background", "b1", "b2", TEST_NOW + 1);
  assert.equal(before.backgrounds.length, 1); assert.equal(changed.backgrounds[0].text, "Original Background");
  assert.deepEqual(effectiveCharacterStates(changed, "peter").map((r) => r.status), ["pending", "pending"]);
  const reviewed = reviewCharacterState(changed, "peter", "b2", [{ stateId: "s1", verdict: "conflict" }, { stateId: "location", verdict: "compatible" }]);
  assert.deepEqual(effectiveCharacterStates(reviewed, "peter").map((r) => r.status), ["suspended", "active"]);
  assert.equal(reviewed.states.length, 2); assert.deepEqual(reviewed.states[0].sources, before.states[0].sources);
  assert.throws(() => reviewCharacterState(changed, "peter", "b1", []), /Stale/);
  assert.throws(() => appendBackgroundSnapshot(changed, "peter", "Late", "b1", "b3", TEST_NOW), /Stale/);
  assert.throws(() => appendCharacterState(changed, row("late", { key: "new-key" }), null), /Stale State basis/);
  assert.deepEqual(appendBackgroundSnapshot(changed, "peter", "New Background", "b2", "unused", TEST_NOW), changed);
});
test("D1 review cannot guess authority across Character or change a value", () => {
  assert.throws(() => reviewCharacterState(foundation(), "pep", "b1", [{ stateId: "s1", verdict: "compatible" }]));
  assert.throws(() => reviewCharacterState(foundation(), "peter", "b1", [{ stateId: "missing", verdict: "compatible" }]));
  const f = foundation(); assert.equal(reviewCharacterState(f, "peter", "b1", [{ stateId: "s1", verdict: "conflict" }]).states[0].value, f.states[0].value);
});
test("D2 deleted latest source physically removes value and restores independent ancestor, idempotently", () => {
  const f = appendCharacterState(foundation(), row("s2", { version: 2, previousId: "s1", value: "PRIVATE-DELETED-VALUE", sources: [source("reply-test")] }), "s1");
  const cleaned = cleanCharacterStates(f, (s) => s.messageId === "reply-test");
  assert.deepEqual(cleaned.states.map((r) => r.id), ["s1"]); assert.equal(effectiveCharacterStates(cleaned, "peter")[0].status, "active");
  assert.equal(JSON.stringify(cleaned).includes("PRIVATE-DELETED-VALUE"), false);
  assert.deepEqual(cleanCharacterStates(cleaned, (s) => s.messageId === "reply-test"), cleaned);
});
test("D2 mixed contributors invalidate all prose; independent descendant remains and skips erased ancestor", () => {
  let f = appendCharacterState(foundation(), row("s2", { version: 2, previousId: "s1", sources: [source(), source("reply-test")] }), "s1");
  f = appendCharacterState(f, row("s3", { version: 3, previousId: "s2", sources: [source("independent")] }), "s2");
  const cleaned = cleanCharacterStates(f, (s) => s.messageId === "user-test");
  assert.deepEqual(cleaned.states.map((r) => [r.id, r.previousId]), [["s3", null]]);
  assert.equal(cleanCharacterStates(f, () => true).states.length, 0);
});
test("State contract rejects copied source text, duplicate ids, fork, missing/cross-character ancestor and cyclic versions", () => {
  for (const change of [
    (f: StateFoundation) => { Object.assign(f.states[0].sources[0], { content: "copied chat" }); },
    (f: StateFoundation) => { f.states.push(structuredClone(f.states[0])); },
    (f: StateFoundation) => { f.states.push(row("fork")); },
    (f: StateFoundation) => { f.states[0].previousId = "gone"; },
    (f: StateFoundation) => { f.states[0].previousId = "s1"; },
    (f: StateFoundation) => { f.states[0].characterId = "pep"; },
  ]) { const f = foundation(); change(f); assert.equal(stateFoundationValid(f), false); }
  assert.throws(() => appendCharacterState(foundation(), row("s2", { version: 2, previousId: "s1" }), null), /Stale/);
});
test("State/Foundation reads and Character deletion isolate owners, including state-only orphan owners", async () => {
  const d = await device(); await seed(d.memory);
  const other = { backgrounds: [{ ...foundation().backgrounds[0], id: "pep-b", characterId: "pep" }],
    states: [row("pep-s", { characterId: "pep", backgroundId: "pep-b", review: null })] };
  await seed(d.memory, other);
  assert.deepEqual(await d.memory.readStateFoundation("peter"), foundation());
  assert.deepEqual(await d.memory.readStateFoundation("missing"), { backgrounds: [], states: [] });
  assert.deepEqual((await d.memory.listCharacterIds()).sort(), ["pep", "peter"]);
  await deleteCharacterMemory(d.memory, "peter"); await deleteCharacterMemory(d.memory, "peter");
  assert.deepEqual(await d.memory.readStateFoundation("peter"), { backgrounds: [], states: [] });
  assert.deepEqual(await d.memory.readStateFoundation("pep"), other);
});
test("durable clear targets include State sources, targeted cleanup preserves newer sources and commits with cursor", async () => {
  const d = await device(); let f = appendCharacterState(foundation(), row("s2", { version: 2, previousId: "s1", sources: [source("reply-test")] }), "s1");
  await seed(d.memory, f); await recordClearIntent(d.memory, "peter", "character:peter");
  assert.deepEqual((await d.memory.listCursors("peter"))[0].clearMessageIds, ["reply-test", "user-test"]);
  await completeClear(d.memory, "peter", "character:peter", new Set(["reply-test"]));
  f = await d.memory.readStateFoundation("peter"); assert.deepEqual(f.states.map((r) => r.id), ["s1"]);
  assert.equal((await d.memory.listCursors("peter")).length, 0);
  await completeClear(d.memory, "peter", "character:peter", new Set(["reply-test"])); assert.deepEqual(await d.memory.readStateFoundation("peter"), f);
});
test("State cleanup failure aborts all writes and retains durable intent", async () => {
  const d = await device(); await seed(d.memory); await recordClearIntent(d.memory, "peter", "character:peter");
  await d.memory.transaction("readwrite", (tx) => request(tx.store("states").put({ ...row(), previousId: "damaged" })));
  await assert.rejects(completeClear(d.memory, "peter", "character:peter"));
  await assert.rejects(d.memory.readStateFoundation("peter"), /unavailable/);
  assert.equal(await d.memory.transaction("readonly", (tx) => request(tx.store("states").count())), 1);
  assert.ok((await d.memory.listCursors("peter"))[0].clearRequestedAt);
});
test("a transaction failing after State writes leaves neither State nor snapshot", async () => {
  const d = await device(); await assert.rejects(d.memory.transaction("readwrite", async (tx) => {
    await request(tx.store("backgrounds").add(foundation().backgrounds[0]));
    await request(tx.store("states").add(row())); throw Error("injected");
  }));
  assert.deepEqual(await d.memory.readStateFoundation("peter"), { backgrounds: [], states: [] });
});
test("restoration journal blocks old handles from opening or writing State stores; clear reopens admission", async () => {
  const d = await device(); await seed(d.memory); d.raw.set(RESTORE_JOURNAL_KEY, "corrupt");
  await assert.rejects(seed(d.memory, { backgrounds: [{ ...foundation().backgrounds[0], id: "blocked" }], states: [] }));
  const other = new MemoryStorage(() => d.indexedDB, () => TEST_NOW, d.gate);
  await assert.rejects(other.readStateFoundation("peter"));
  d.raw.delete(RESTORE_JOURNAL_KEY); assert.deepEqual(await d.memory.readStateFoundation("peter"), foundation());
});
test("automatic Memory operations cannot mutate or accept State/Background operations, and user Undo is untouched", async () => {
  const d = await device(); await seed(d.memory);
  await assert.rejects(d.memory.applyChange("peter", "auto", { put: [{ id: "b1", characterId: "peter", kind: "fact", subject: "character", text: "ordinary memory",
    status: "active", origin: "auto", sources: [source()], lineage: {} }] }, { auto: true }), /manual memory/);
  assert.deepEqual(await d.memory.listOperations("peter"), []);
  assert.deepEqual(await d.memory.readStateFoundation("peter"), foundation());
  const p = await progressFixture(); const m = await p.send();
  await p.protocol.withOwner("c", async (owner) => {
    const ticket = await p.protocol.prepare(owner, p.session.id, 1, 1), snapshot = await p.protocol.readInput(ticket);
    assert.throws(() => parseMaintenanceOperations(JSON.stringify({ operations: [{ op: "STATE", messageIds: [m.id] }] }), snapshot));
  });
});
test("v1 database is upgraded additively; old rows survive exactly and old connections close on versionchange", async () => {
  const d = await device(); const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = d.indexedDB.open("veil-memory-v1", 1);
    opening.onupgradeneeded = () => { for (const name of ["memories", "suppressions", "operations", "cursors"]) {
      const store = opening.result.createObjectStore(name, { keyPath: "id" }); store.createIndex("characterId", "characterId");
      if (name === "memories") store.createIndex("characterFingerprint", ["characterId", "fingerprint"]);
    } }; opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
  old.onversionchange = () => old.close();
  const legacy = backupData().memory.memories[0];
  await new Promise<void>((resolve) => { const tx = old.transaction("memories", "readwrite"); tx.objectStore("memories").put(legacy); tx.oncomplete = () => resolve(); });
  const before = await readStaticBackupSource(d); assert.equal((await d.indexedDB.databases()).find((x) => x.name === "veil-memory-v1")!.version, 1);
  assert.deepEqual(before.memory.memories, [legacy]); assert.deepEqual(before.memory.states, []);
  assert.deepEqual(await d.memory.listMemories("peter"), [legacy]);
  assert.equal((await d.indexedDB.databases()).find((x) => x.name === "veil-memory-v1")!.version, 2);
});
test("blocked additive upgrade safely rejects and retry succeeds without dropping v1 rows", async () => {
  const d = await device(); const old = await new Promise<IDBDatabase>((resolve) => {
    const r = d.indexedDB.open("veil-memory-v1", 1); r.onupgradeneeded = () => { for (const n of ["memories", "suppressions", "operations", "cursors"]) {
      const store = r.result.createObjectStore(n, { keyPath: "id" }); store.createIndex("characterId", "characterId");
      if (n === "memories") store.createIndex("characterFingerprint", ["characterId", "fingerprint"]);
    } };
    r.onsuccess = () => resolve(r.result);
  });
  await assert.rejects(d.memory.readStateFoundation("peter"), /Close other/); old.close();
  assert.deepEqual(await d.memory.readStateFoundation("peter"), { backgrounds: [], states: [] });
});
test("unsupported v1 schema aborts upgrade and retains both its version and existing values", async () => {
  const d = await device(); const original = { id: "legacy-value", characterId: "peter", text: "preserve exactly" };
  const old = await new Promise<IDBDatabase>((resolve) => {
    const r = d.indexedDB.open("veil-memory-v1", 1); r.onupgradeneeded = () => r.result.createObjectStore("memories", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
  });
  await new Promise<void>((resolve) => { const tx = old.transaction("memories", "readwrite"); tx.objectStore("memories").put(original); tx.oncomplete = () => resolve(); });
  old.close(); await assert.rejects(d.memory.listMemories("peter"));
  assert.equal((await d.indexedDB.databases())[0].version, 1);
  const reopened = await new Promise<IDBDatabase>((resolve) => { const r = d.indexedDB.open("veil-memory-v1", 1); r.onsuccess = () => resolve(r.result); });
  assert.deepEqual(await request(reopened.transaction("memories").objectStore("memories").get(original.id)), original); reopened.close();
});
test("adding empty State stores preserves legacy restore digests, while any new State or Background changes it", async () => {
  const d = await device(); const p = await packageFixture(); await restoreIntoEmpty(JSON.stringify(p.manifest), p.files, d, d.locks);
  const before = await readStaticBackupSource(d); const legacy = structuredClone(before);
  delete (legacy.memory as Partial<typeof legacy.memory>).backgrounds; delete (legacy.memory as Partial<typeof legacy.memory>).states;
  assert.deepEqual(await digestUnits(before), await digestUnits(legacy));
  const changed = structuredClone(before); changed.memory.backgrounds = foundation().backgrounds;
  assert.notEqual((await digestUnits(changed)).memory, (await digestUnits(before)).memory);
});
test("backup v2/Memory-domain v2 round-trips State graph, suspended reviews and immutable Backgrounds", async () => {
  const f = await pack(reviewCharacterState(foundation(), "peter", "b1", [{ stateId: "s1", verdict: "conflict" }]));
  const d = await device(), v = await validate(f); assert.equal(f.manifest.domains.find((x) => x.domain === "memory")!.version, 2);
  const preview = await previewRestore(JSON.stringify(f.manifest), f.files, d, d.locks);
  assert.equal(preview.mode, "empty-restore");
  await restoreIntoEmpty(JSON.stringify(f.manifest), f.files, d, d.locks);
  const stored = await d.memory.readStateFoundation("peter"); assert.deepEqual(stored.states, v.data.memory.states); assert.deepEqual(stored.backgrounds, v.data.memory.backgrounds);
  const exported = await exportStaticBackup(d, { backupId: "state-export", createdAt: TEST_NOW, sourceCommit: TEST_COMMIT });
  const result = await validateBackupPackage(exported.manifestJson, exported.files); assert.deepEqual(result.data.memory.states, stored.states);
  assert.equal(JSON.parse(exported.manifestJson).domains.find((x: { domain: string }) => x.domain === "memory").records, 7);
});
test("legacy backup Memory-domain v1 is explicit, normalized in imported copy only; new missing stores refused", async () => {
  const f = await pack(); const old = backupData().memory;
  const { backgrounds: _b, states: _s, ...legacy } = old; void [_b, _s];
  await replacePayload(f, "memory", legacy); const section = f.manifest.domains.find((x) => x.domain === "memory")!; section.records = 5; section.version = 1;
  const v = await validate(f); assert.deepEqual(v.data.memory.backgrounds, []); assert.deepEqual(v.data.memory.states, []);
  assert.equal(Object.hasOwn(legacy, "states"), false); section.version = 2; await assert.rejects(validate(f));
});
for (const [name, mutate] of [
  ["extra plaintext source field", (f: StateFoundation) => { Object.assign(f.states[0].sources[0], { text: "secret" }); }],
  ["cross Character Background", (f: StateFoundation) => { f.backgrounds[0].characterId = "pep"; }],
  ["unknown Character", (f: StateFoundation) => { f.backgrounds[0].characterId = f.states[0].characterId = "missing"; }],
  ["dangling predecessor", (f: StateFoundation) => { f.states[0].previousId = "missing"; }],
  ["deleted State source", (f: StateFoundation) => { f.states[0].sources[0].messageId = "gone"; }],
  ["wrong session", (f: StateFoundation) => { f.states[0].sources[0].sessionId = "empty-group"; }],
] as const) test(`strict backup rejects ${name} before writes`, async () => {
  const f = foundation(); mutate(f); const p = await pack(f), d = await device();
  await assert.rejects(restoreIntoEmpty(JSON.stringify(p.manifest), p.files, d, d.locks));
  assert.deepEqual(await d.indexedDB.databases(), []); assert.equal(d.raw.size, 0);
});
test("cover restore failure rolls back State, reviews and original Background values exactly", async () => {
  const d = await device(), first = await pack(); await restoreIntoEmpty(JSON.stringify(first.manifest), first.files, d, d.locks);
  const before = await d.memory.readStateFoundation("peter");
  const changed = appendBackgroundSnapshot(foundation(), "peter", "New basis", "b1", "b2", TEST_NOW+1), second = await pack(changed);
  const changedFoundation = backupData().foundation!; changedFoundation.user.aboutMe = "Changed user profile for failure injection";
  await replacePayload(second, "foundation", changedFoundation);
  const preview = await previewRestore(JSON.stringify(second.manifest), second.files, d, d.locks);
  const writers = createUnitWriters(d); let once = true; const foundationWrite = writers.foundation.write;
  writers.foundation.write = async (s) => { if (once) { once = false; throw Error("injected failure after Memory"); } await foundationWrite(s); };
  await assert.rejects(replaceWithBackup(JSON.stringify(second.manifest), second.files, d, d.locks, { confirmed: preview, writers }));
  assert.deepEqual(await d.memory.readStateFoundation("peter"), before); assert.equal(d.raw.has(RESTORE_JOURNAL_KEY), false);
});
test("interrupted State restore keeps journal, continues without model calls and preserves snapshot identity", async () => {
  const d = await device(), p = await pack(), writers = createUnitWriters(d); const write = writers.memory.write;
  writers.memory.write = async (s) => { await write(s); throw Error("interrupted"); }; writers.chat.clear = async () => { throw Error("rollback also interrupted"); };
  await assert.rejects(restoreIntoEmpty(JSON.stringify(p.manifest), p.files, d, d.locks, { writers }));
  assert.ok(d.raw.has(RESTORE_JOURNAL_KEY));
  await recoverRestore("resume", d, d.locks, { manifestJson: JSON.stringify(p.manifest), files: p.files });
  assert.deepEqual(await d.memory.readStateFoundation("peter"), foundation()); assert.equal(d.raw.has(RESTORE_JOURNAL_KEY), false);
});
