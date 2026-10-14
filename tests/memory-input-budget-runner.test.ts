import assert from "node:assert/strict";
import test from "node:test";
import { progressFixture } from "./memory-progress-fixture";
import { MemoryProgressProtocol } from "../lib/memory/progress";
import { ChatStorage } from "../lib/chat/storage";
import { createIndexedDBFoundationStorage, FOUNDATION_STORAGE_KEY } from "../lib/foundation-storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { runMaintenance, type MaintenanceRunnerDependencies } from "../lib/memory/maintenance-runner";
import { MAINTENANCE_LIMITS } from "../lib/memory/maintenance-input";
import type { TextProvider } from "../lib/chat/provider";

const ignore = JSON.stringify({ operations: [{ op: "IGNORE" }] });
const longBackstory = (n: number) => ["Peter is a quiet student who keeps a notebook.", ...Array.from({ length: 80 }, (_, i) => `Chapter ${i}: ${"He remembers the old town and its streets. ".repeat(4)}`)].join("\n\n").slice(0, n);

async function fixture(options: { backstory?: number; state?: boolean; budget?: () => string } = {}) {
  const f = await progressFixture(); let calls = 0; const inputs: string[] = [];
  const character = { characterId: "c", ...normalizeCharacterInput({ name: "Peter", backstory: longBackstory(options.backstory ?? 12_000), personality: "p".repeat(2_000), speakingStyle: "s".repeat(2_000) }) };
  await f.core.replaceIfCurrent(FOUNDATION_STORAGE_KEY, await f.core.read(FOUNDATION_STORAGE_KEY), JSON.stringify({ ...defaultFoundation(), characters: [character] }));
  const chat = new ChatStorage(() => f.factory, () => f.locks, f.gate, true, f.memory);
  createIndexedDBFoundationStorage(f.core, f.memory);
  const source = { ...f.source, readChat: chat.readMemorySources.bind(chat), readStateSources: chat.readStateSources.bind(chat) };
  const protocol = new MemoryProgressProtocol(f.memory, source, f.locks, options.state ?? true);
  const deps: MaintenanceRunnerDependencies = { protocol, memory: f.memory, readChat: chat.readMemorySources.bind(chat),
    sessions: (scope) => scope ? chat.listExistingSessions(scope) : chat.listSessions(),
    model: async () => ({ config: { id: "selected", baseUrl: "https://example.invalid/v1", apiKey: "stub-only", model: "stub" }, context: JSON.stringify({ name: "Peter", personality: character.personality, speakingStyle: character.speakingStyle }),
      ...(options.budget ? { budget: options.budget() } : {}) }),
    enabled: () => true, now: () => Date.now() + 310_000, triggerSequences: 1,
    provider: (async function* (_c, messages) { calls++; inputs.push(messages.map((m) => m.content).join("\n")); yield ignore; }) as TextProvider };
  const progress = async () => (await f.memory.listCursors("c"))[0]?.extraction;
  return { ...f, chat, protocol, deps, calls: () => calls, inputs, progress, send: (text: string) => chat.send(f.session.id, text),
    run: () => runMaintenance("c", deps, new AbortController().signal) };
}

/** A user message is capped at 12,000 characters; an oversized batch can only come from a long Character reply. */
async function bigReply(f: Awaited<ReturnType<typeof fixture>>, size: number) {
  await f.send("short"); const reply = await f.chat.beginReply(f.session.id); assert.ok(reply);
  await f.chat.finalizeReply(reply.assistant.id, "x".repeat(size)); await f.send("confirm");
  assert.equal(await f.run(), true, "the short opening message is processed on its own"); assert.equal((await f.progress())!.throughSeq, 1);
  return reply.assistant;
}

test("State reservation advances maintenance under a 12,000-character Backstory: one request, State lane present, range done", async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++) await f.send(`Message ${i}: Peter walked to the harbour and thought about his mother. `.repeat(8));
  assert.equal(await f.run(), true);
  assert.equal(f.calls(), 1, "exactly one provider request and no size pre-check requests");
  const p = (await f.progress())!;
  assert.ok(p.throughSeq >= 1 && p.batches.length === 0, "the range was committed, not parked");
  const sent = f.inputs[0];
  assert.ok(sent.length <= MAINTENANCE_LIMITS.inputCharacters);
  assert.ok(sent.includes("Message 0") && sent.includes('"background"') && sent.includes("Character State records only major"), "messages and the State lane were both sent");
});

test("a single ordinary message always goes through, with State on and the longest Backstory", async () => {
  const f = await fixture();
  await f.send("Peter says: I finally moved to a new city and started a new job there. ".repeat(60));
  assert.equal(await f.run(), true); assert.equal(f.calls(), 1); assert.equal((await f.progress())!.throughSeq, 1);
});

test("too-large keeps the range: two evaluations, then a pause that records why, never done, then recovery when the budget changes", async () => {
  let budget = "profile-v1";
  const f = await fixture({ state: false, backstory: 0, budget: () => budget });
  await bigReply(f, 40_000);
  for (const attempt of [1, 2]) {
    await f.run();
    const batch = (await f.progress())!.batches[0];
    assert.equal(batch.state, "too-large"); assert.equal(batch.sizeAttempts, attempt); assert.ok(batch.budgetKey);
  }
  // Paused: further normal triggers do not re-evaluate and do not spend a request, but the range stays and is never marked done.
  const paused = (await f.progress())!.batches[0], base = f.calls();
  assert.equal(await f.run(), false);
  assert.deepEqual((await f.progress())!.batches[0], paused);
  assert.equal(f.calls(), base); assert.equal((await f.progress())!.throughSeq, 1); assert.deepEqual((await f.progress())!.completed, [[3, 3]]);
  // Budget inputs changed (profile edit): evaluated again from one; still too large, still kept.
  budget = "profile-v2";
  await f.send("Peter says hello again.");
  await f.run();
  const again = (await f.progress())!.batches[0];
  assert.equal(again.state, "too-large"); assert.equal(again.sizeAttempts, 1); assert.notEqual(again.budgetKey, paused.budgetKey);
  assert.equal(f.calls(), base + 1, "only the new ordinary message cost a request");
});

test("a paused too-large range is processed after the message that blocked it is edited and the budget changes", async () => {
  let budget = "v1";
  const f = await fixture({ state: false, backstory: 0, budget: () => budget });
  const big = await bigReply(f, 40_000);
  await f.run(); await f.run(); const base = f.calls();
  assert.equal((await f.progress())!.batches[0].sizeAttempts, 2);
  await f.chat.editMessage(big.id, "Peter adopted a rescue kitten and named her Biscuit.");
  budget = "v2";
  // Recovery happens on the next normal trigger, which a new message provides; nothing runs on its own.
  assert.equal(await f.run(), false, "no trigger yet: no evaluation and no request"); assert.equal(f.calls(), base);
  await f.send("Peter says hello again.");
  assert.equal(await f.run(), true); assert.ok(f.calls() >= base + 1);
  const p = (await f.progress())!; assert.equal(p.batches.length, 0); assert.ok(p.throughSeq >= 3);
});

test("a too-large range does not starve later messages", async () => {
  const f = await fixture({ state: false, backstory: 0 });
  await bigReply(f, 40_000); await f.send("Peter adopted a rescue kitten and named her Biscuit.");
  for (let i = 0; i < 4; i++) await f.run();
  const p = (await f.progress())!;
  assert.equal(p.batches.length, 1); assert.equal(p.batches[0].state, "too-large"); assert.equal(p.batches[0].fromSeq, 2);
  assert.deepEqual(p.completed, [[3, 4]], "the later messages were processed past the hole");
});

test("a committed batch must have carried the State lane: with State on, a commit that never read the State snapshot is refused", async () => {
  const f = await fixture();
  await f.send("Peter moved permanently to a new home.");
  await f.protocol.withOwner("c", async (owner) => {
    const ticket = await f.protocol.prepare(owner, f.session.id, 1, 1);
    await f.protocol.claim(ticket, 2); await f.protocol.transition(ticket, "in-flight"); await f.protocol.transition(ticket, "commit-pending");
    await assert.rejects(f.protocol.commitAutomatic(ticket, { put: [] }));
  });
  assert.equal((await f.progress())!.throughSeq, 0);
});
