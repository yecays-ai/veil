import assert from "node:assert/strict";
import test from "node:test";
import { progressFixture } from "./memory-progress-fixture";
import { backupData, packageFixture } from "./backup-fixture";
import { IDBFactory } from "fake-indexeddb";
import { validateBackupPackage } from "../lib/backup/validation";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { defaultFoundation } from "../lib/foundation-types";
import { planSummary, summaryDigest, summaryPossiblyDue, validSummary, RECENT_MESSAGES, SUMMARY_CHARACTERS, SUMMARY_CHUNK_CHARACTERS, SUMMARY_TRIGGER_MESSAGES } from "../lib/chat/summary";
import type { ChatMessage, ChatSession, ChatSummary } from "../lib/chat/types";

const message = (order: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${order}`, sessionId: "s", role: order % 2 ? "user" : "assistant",
  content: `message ${order}`, status: "complete", createdAt: order * 1000, order, ...extra });
const thread = (count: number) => Array.from({ length: count }, (_, i) => message(i + 1));
const session = (count: number, extra: Partial<ChatSession> = {}): ChatSession => ({ id: "s", characterId: "c", updatedAt: 5, autoReplyOnKeyboardDismiss: false, nextOrder: count + 1, ...extra });
const summaryOf = (messages: ChatMessage[], throughOrder: number, text = "I remember the first part."): ChatSummary =>
  ({ text, throughOrder, digest: summaryDigest(messages.filter((m) => m.order <= throughOrder)), updatedAt: 1 });

test("nothing is due until a full trigger's worth of messages has left the History window", () => {
  assert.equal(RECENT_MESSAGES, 40); assert.equal(SUMMARY_TRIGGER_MESSAGES, 20);
  assert.equal(planSummary(session(59), thread(59)).kind, "none");
  assert.equal(summaryPossiblyDue(session(59)), false);
  const plan = planSummary(session(60), thread(60));
  assert.equal(plan.kind, "due"); assert.equal(summaryPossiblyDue(session(60)), true);
  if (plan.kind !== "due") return;
  assert.equal(plan.chunk.length, 20); assert.equal(plan.throughOrder, 20); assert.equal(plan.previous, undefined);
  assert.equal(plan.digest, summaryDigest(thread(60).slice(0, 20)));
});
test("the next window starts after the stored summary and a request reads a bounded amount of text", () => {
  const messages = thread(130), stored = summaryOf(messages, 30);
  const plan = planSummary(session(130, { summary: stored }), messages);
  assert.equal(plan.kind, "due");
  if (plan.kind !== "due") return;
  assert.equal(plan.chunk[0].order, 31); assert.equal(plan.previous, stored.text); assert.equal(plan.expectedDigest, stored.digest);
  assert.equal(plan.throughOrder, 90, "everything older than the last 40 messages rolls in");
  const long = thread(100).map((m) => ({ ...m, content: "x".repeat(3000) }));
  const bounded = planSummary(session(100), long);
  assert.equal(bounded.kind === "due" && bounded.chunk.length, Math.floor(SUMMARY_CHUNK_CHARACTERS / 3000));
  assert.equal(planSummary(session(100, { generation: { id: "g", stage: "provider" } }), long).kind, "none", "never while a reply generates");
  assert.equal(planSummary(session(100, { type: "group" }), long).kind, "none");
});
test("a summary is only valid while every covered message is unchanged", () => {
  const messages = thread(80), stored = summaryOf(messages, 30);
  assert.equal(validSummary(stored, messages), true);
  assert.equal(validSummary(stored, messages.map((m) => m.order === 10 ? { ...m, content: "edited" } : m)), false, "edit inside the range");
  assert.equal(validSummary(stored, messages.filter((m) => m.order !== 10)), false, "deletion inside the range");
  assert.equal(validSummary(stored, messages.map((m) => m.order === 50 ? { ...m, content: "edited" } : m)), true, "edit after the range");
  assert.equal(validSummary({ ...stored, text: "x".repeat(SUMMARY_CHARACTERS + 1) }, messages), false);
  assert.equal(validSummary({ ...stored, text: "  " }, messages), false);
  assert.equal(planSummary(session(80, { summary: stored }), messages.map((m) => m.order === 10 ? { ...m, content: "edited" } : m)).kind, "invalid");
  // Streaming/placeholder and system rows are not summarized and cannot invalidate anything.
  assert.equal(validSummary(stored, [...messages, message(81, { role: "system" }), message(82, { status: "streaming" })]), true);
});

function prompt(messages: ChatMessage[], summary?: ChatSummary) {
  const document = defaultFoundation();
  const character = { characterId: "c", name: "C" } as never;
  return assembleChatPrompt(document, character, messages, [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, summary).messages;
}
test("the prompt shows a valid summary before the recent messages and drops an invalid one", () => {
  const messages = thread(80), stored = summaryOf(messages, 30, "I remember the harbor trip.");
  const turns = prompt(messages, stored), at = turns.findIndex((t) => t.content.includes("I remember the harbor trip."));
  assert.ok(at >= 0); assert.equal(turns[at].role, "system");
  assert.match(turns[at].content, /^\[conversation-summary\]/);
  assert.ok(at < turns.findIndex((t) => t.content.includes("message 41")), "summary comes before History");
  assert.equal(turns.filter((t) => /message \d+$/.test(t.content)).length, RECENT_MESSAGES, "the History window itself is unchanged");
  assert.ok(!prompt(messages.map((m) => m.order === 10 ? { ...m, content: "edited" } : m), stored).some((t) => t.content.includes("harbor trip")));
  assert.ok(!prompt(messages).some((t) => t.content.includes("conversation-summary")));
});

test("commit is compare-and-set, keeps updatedAt, and edits, deletes and clears discard a covering summary", async () => {
  const f = await progressFixture();
  for (let i = 0; i < 70; i++) await f.send(`message ${i}`);
  const read = () => f.memory.withExclusive((scope) => f.chat.readMemorySources(f.session.id, scope));
  const commit = (expected: string | undefined, next: ChatSummary | null) => f.memory.withExclusive((scope) => f.chat.commitSummary(f.session.id, expected, next, scope));
  const planned = async () => { const v = await read(); const p = planSummary(v.session!, v.messages); assert.equal(p.kind, "due"); return p as Extract<ReturnType<typeof planSummary>, { kind: "due" }>; };
  const next = (p: Awaited<ReturnType<typeof planned>>, text = "I remember the start."): ChatSummary => ({ text, throughOrder: p.throughOrder, digest: p.digest, updatedAt: 9 });
  const before = (await read()).session!;
  let plan = await planned(); assert.equal(plan.throughOrder, 30);
  assert.equal(await commit("wrong", next(plan)), false, "stale expectation");
  assert.equal(await commit(undefined, { ...next(plan), digest: "30:0" }), false, "covered messages do not hash to the digest");
  assert.equal(await commit(undefined, { ...next(plan), text: "x".repeat(SUMMARY_CHARACTERS + 1) }), false);
  assert.equal(await commit(undefined, null), false, "nothing to discard");
  assert.equal(await commit(undefined, next(plan)), true);
  let view = await read();
  assert.deepEqual(view.session!.summary, next(plan)); assert.equal(view.session!.updatedAt, before.updatedAt, "a background summary never reorders the chat list");
  assert.equal(view.session!.memorySequence?.nextSeq, before.memorySequence?.nextSeq);
  assert.equal(await commit(undefined, next(plan)), false, "a second writer from the same plan loses");
  const byOrder = (order: number) => view.messages.find((m) => m.order === order)!;
  await f.chat.editMessage(byOrder(50).id, "edited after the range");
  assert.ok((await read()).session!.summary, "an edit after the covered range keeps it");
  await f.chat.editMessage(byOrder(12).id, "edited inside the range");
  assert.equal((await read()).session!.summary, undefined, "an edit inside the range discards it");
  plan = await planned(); assert.equal(await commit(undefined, next(plan)), true); view = await read();
  await f.chat.deleteMessages(f.session.id, [byOrder(60).id]);
  assert.ok((await read()).session!.summary, "deleting a later message keeps it");
  await f.chat.deleteMessages(f.session.id, [byOrder(5).id]);
  assert.equal((await read()).session!.summary, undefined, "deleting a covered message discards it");
  for (let i = 0; i < 20; i++) await f.send(`more ${i}`);
  plan = await planned(); assert.equal(await commit(undefined, next(plan)), true);
  assert.equal(await commit("wrong", null), false, "discard must name the stored digest");
  assert.equal(await commit(plan.digest, null), true); assert.equal((await read()).session!.summary, undefined);
  assert.equal(await commit(undefined, next(plan)), true);
  await f.chat.clearSession(f.session.id);
  view = await read(); assert.equal(view.session!.summary, undefined, "clearing the chat removes the summary text with it");
  assert.equal(view.messages.length, 0);
});

const device = () => { const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); },
    removeItem: (k: string) => { raw.delete(k); } } } satisfies RestoreDevice; };
test("backup validates and restores the session summary and refuses damaged ones", async () => {
  const good = { text: "I remember.", throughOrder: 2, digest: "2:1a2b", updatedAt: 3 };
  const ok = backupData(); ok.chat.sessions[0].summary = good;
  const f = await packageFixture(ok), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(); await restoreIntoEmpty(manifest, f.files, d, lockOrigin().client());
  assert.deepEqual(((await readStaticBackupSource(d)).chat.sessions[0] as { summary?: unknown }).summary, good);
  const damaged: ((s: Record<string, unknown>) => void)[] = [
    (s) => { s.summary = { ...good, extra: "no" }; }, (s) => { s.summary = { ...good, text: "" }; }, (s) => { s.summary = { ...good, text: "x".repeat(SUMMARY_CHARACTERS + 1) }; },
    (s) => { s.summary = { ...good, throughOrder: 0 }; }, (s) => { s.summary = { ...good, throughOrder: 3 }; }, (s) => { s.summary = { ...good, digest: "not a digest" }; },
    (s) => { s.summary = { text: good.text, throughOrder: good.throughOrder, digest: good.digest }; }, (s) => { s.summary = "text"; },
  ];
  for (const mutate of damaged) { const bad = backupData(); mutate(bad.chat.sessions[0] as unknown as Record<string, unknown>);
    const p = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files)); }
});
