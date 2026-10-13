import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { backupData, packageFixture } from "./backup-fixture";
import { createChatEngine } from "./chat-engine-fixture";
import { lockOrigin } from "./generation-lock-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { ChatStorage } from "../lib/chat/storage";
import { addJournalEntry, addManualMemory, deleteMemory, editMemory, memoryHistoryOf } from "../lib/memory/bank";
import { memoryEntry, memoryEntryHash } from "../lib/memory/context";
import { resolveInjected } from "../lib/memory/injected";
import { MemoryStorage } from "../lib/memory/storage";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import type { MemoryRef } from "../lib/chat/types";
import type { Memory } from "../lib/memory/types";

const store = () => new MemoryStorage(() => new IDBFactory(), (() => { let t = 1_700_000_000_000; return () => (t += 1000); })(), { withWrite: (work) => work() });
const ref = async (row: Memory): Promise<MemoryRef> => ({ id: row.id, hash: await memoryEntryHash(row) });
const fact = (id: string, text: string, extra: Partial<Memory> = {}): Memory => ({ id, characterId: "c", kind: "fact", subject: "character", text,
  fingerprint: memoryFingerprint(text), status: "active", origin: "auto", sources: [], lineage: {}, createdAt: 86_400_000, updatedAt: 1, ...extra });

test("an injected entry carries the day it was recorded, and the hash ignores time and status", async () => {
  const row = fact("a", "I started learning the cello.");
  assert.equal(JSON.parse(memoryEntry(row)).recordedAt, "1970-01-02");
  assert.equal(await memoryEntryHash(row), await memoryEntryHash({ ...row, status: "archived", createdAt: 5 } as Memory));
  assert.notEqual(await memoryEntryHash(row), await memoryEntryHash({ ...row, text: "I stopped." }));
});

test("the panel shows the exact version that was injected, or says it is unavailable, never the current text", async () => {
  const memory = store();
  await addManualMemory(memory, "c", { kind: "fact", text: "I like green tea." });
  const [original] = await memory.listMemories("c"), injected = await ref(original);
  assert.equal((await resolveInjected([injected], [original], []))[0].state, "current");
  // The user edits it: the earlier text is available only while the edit is among the last five operations.
  await editMemory(memory, original, { kind: "fact", text: "I like oolong now." });
  let rows = await memory.listMemories("c");
  const [earlier] = await resolveInjected([injected], rows, await memory.listOperations("c"));
  assert.equal(earlier.state, "earlier"); assert.equal(earlier.state === "earlier" && earlier.text, "I like green tea.");
  for (let i = 0; i < 5; i++) await addManualMemory(memory, "c", { kind: "fact", text: `Filler ${i}` });
  rows = await memory.listMemories("c");
  const [gone] = await resolveInjected([injected], rows, await memory.listOperations("c"));
  assert.equal(gone.state, "unavailable");
  assert.ok(!JSON.stringify(gone).includes("oolong") && !JSON.stringify(gone).includes("green tea"));
});

test("deleting a memory leaves no earlier version readable, and removes its history with it", async () => {
  const memory = store();
  await addManualMemory(memory, "c", { kind: "fact", text: "I like green tea." });
  const [original] = await memory.listMemories("c"), injected = await ref(original);
  await editMemory(memory, original, { kind: "fact", text: "I like oolong now." });
  const edited = (await memory.listMemories("c"))[0];
  await deleteMemory(memory, edited);
  assert.deepEqual(await memory.listMemories("c"), []);
  const operations = await memory.listOperations("c");
  assert.equal(operations.length, 1, "older records about the deleted memory are dropped");
  assert.equal((await resolveInjected([injected], [], operations))[0].state, "deleted");
  // Undoing the delete is still possible and brings back exactly the memory.
  await memory.undoLastOperation("c");
  assert.equal((await memory.listMemories("c"))[0].text, "I like oolong now.");
});

test("deleting a merged memory also deletes the originals it replaced and suppresses all of them", async () => {
  const memory = store();
  const old1 = fact("o1", "I had a cat named Pip.", { status: "superseded", lineage: { supersededBy: "n" } });
  const old2 = fact("o2", "Pip is a grey cat.", { status: "superseded", lineage: { supersededBy: "o3" } });
  const mid = fact("o3", "Pip, my grey cat, lives with me.", { status: "superseded", lineage: { supersededBy: "n", mergedFrom: ["o2"] } });
  const latest = fact("n", "Pip died last spring.", { lineage: { mergedFrom: ["o1", "o3"] } });
  const other = fact("x", "Unrelated fact.");
  await memory.replaceAllRows({ memories: [old1, old2, mid, latest, other], suppressions: [], operations: [], cursors: [], backgrounds: [], states: [] });
  assert.deepEqual(memoryHistoryOf(latest, await memory.listMemories("c")).map((row) => row.id).sort(), ["o1", "o2", "o3"]);
  await deleteMemory(memory, (await memory.getMemory("n"))!);
  assert.deepEqual((await memory.listMemories("c")).map((row) => row.id), ["x"]);
  assert.equal((await memory.listSuppressions("c")).length, 4);
  await memory.undoLastOperation("c");
  assert.equal((await memory.listMemories("c")).length, 5);
});

test("Journal entries are resolved under their own tab and a replaced automatic memory still shows what it said", async () => {
  const memory = store();
  await addJournalEntry(memory, "c", { text: "Her birthday is in May.", keywords: ["birthday"] });
  const [entry] = await memory.listMemories("c");
  assert.equal((await resolveInjected([{ ...await ref(entry), journal: true }], [entry], []))[0].state, "current");
  const replaced = fact("r", "I live in Osaka.", { status: "superseded", lineage: { supersededBy: "s" } });
  const [shown] = await resolveInjected([await ref(replaced)], [replaced, fact("s", "I live in Kyoto.")], []);
  assert.equal(shown.state, "current"); assert.equal(shown.state === "current" && shown.row.status, "superseded");
});

test("a finished reply stores which entries it was given, as ids and hashes only", async () => {
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory);
  const row = fact("a", "I grow orchids in a greenhouse", { characterId: "a", origin: "manual" });
  const document = defaultFoundation();
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "a" }) }];
  document.runtime = { ...document.runtime, timeAware: false };
  const provider: TextProvider = async function* () { yield "A reply"; };
  const presets = createPresetDocument(), preset = createBuiltinPreset();
  presets.presets = [preset]; presets.activePresetId = preset.id;
  const engine = createChatEngine(storage, async () => document, provider, async () => presets, () => new Date(0), undefined, undefined, undefined,
    undefined, undefined, async () => {}, async () => undefined, async () => {}, async () => [row]);
  const session = await storage.openSession("a");
  await engine.send(session.id, "How are your orchids?");
  const reply = (await engine.requestReply(session.id))!;
  const stored = ((await storage.readSession(session.id)).messages).find((m) => m.id === reply.id)!;
  assert.deepEqual(stored.memoryRefs, [await ref(row)]);
  assert.ok(!JSON.stringify(stored.memoryRefs).includes("orchids"));
  await engine.send(session.id, "Nothing relevant here");
  const next = (await engine.requestReply(session.id))!;
  assert.deepEqual(((await storage.readSession(session.id)).messages).find((m) => m.id === next.id)!.memoryRefs, []);
  const again = (await engine.regenerateMessage(next.id))!;
  assert.deepEqual(((await storage.readSession(session.id)).messages).find((m) => m.id === again.id)!.memoryRefs, [], "a regenerated reply records its own request");
});

const device = () => { const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); },
    removeItem: (k: string) => { raw.delete(k); } } } satisfies RestoreDevice; };
test("backup keeps reply memory references, restores them, and refuses damaged ones", async () => {
  const good = [{ id: "m1", hash: "0123456789abcdef" }, { id: "j1", hash: "fedcba9876543210", journal: true as const }];
  const ok = backupData(); (ok.chat.messages[1] as Record<string, unknown>).memoryRefs = good;
  const f = await packageFixture(ok), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(); await restoreIntoEmpty(manifest, f.files, d, lockOrigin().client());
  assert.deepEqual((await readStaticBackupSource(d)).chat.messages.find((m) => (m as { id: string }).id === "reply-test") && ((await readStaticBackupSource(d)).chat.messages.find((m) => (m as { id: string }).id === "reply-test") as { memoryRefs?: unknown }).memoryRefs, good);
  const damaged: ((m: Record<string, unknown>) => void)[] = [
    (m) => { m.memoryRefs = "text"; }, (m) => { m.memoryRefs = [{ id: "m1" }]; }, (m) => { m.memoryRefs = [{ id: "m1", hash: "short" }]; },
    (m) => { m.memoryRefs = [{ id: "m1", hash: "0123456789abcdef", text: "leak" }]; }, (m) => { m.memoryRefs = [{ id: "m1", hash: "0123456789abcdef", journal: false }]; },
    (m) => { m.memoryRefs = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, hash: "0123456789abcdef" })); },
  ];
  for (const mutate of damaged) { const bad = backupData(); mutate(bad.chat.messages[1] as Record<string, unknown>);
    const p = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files)); }
  const onUser = backupData(); (onUser.chat.messages[0] as Record<string, unknown>).memoryRefs = good;
  const p = await packageFixture(onUser); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files));
});
