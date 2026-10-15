import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import {
  PROACTIVE_DAILY_MAX, PROACTIVE_INSTRUCTION, PROACTIVE_MIN_GAP_MS, SILENCE_TAG, attemptsAllow, isSilence, maybeSilence, statusMayInitiate,
} from "../lib/chat/proactive";
import { createProactiveScheduler, runProactiveCheck, type ProactiveCheckDeps } from "../lib/chat/proactive-scheduler";
import { backupData, packageFixture } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";
import type { ChatSession } from "../lib/chat/types";

const HOUR = 3_600_000;

function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const prompts: { role: string; content: string }[][] = [];
  const reply = (...chunks: string[]) => createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push([...prompt] as never); for (const chunk of chunks) yield chunk; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  return { storage, document, prompts, reply };
}
/** Runs `body` with Date.now() pinned, so the budget (stored with Date.now) can be moved through days. */
async function at<T>(time: number, body: () => Promise<T>): Promise<T> {
  const real = Date.now; Date.now = () => time;
  try { return await body(); } finally { Date.now = real; }
}
const T0 = Date.UTC(2026, 9, 14, 12);
/** The page dies: its lock goes away, but the stored generation and draft stay behind. */
async function crash(storage: ChatStorage, id: string) {
  const locks = (storage as unknown as { generationLocks: Map<string, () => Promise<void>> }).generationLocks;
  await locks.get(id)!(); locks.delete(id);
}

test("the budget is two attempts a day, three hours apart, and old attempts expire", () => {
  assert.equal(PROACTIVE_DAILY_MAX, 2); assert.equal(PROACTIVE_MIN_GAP_MS, 3 * HOUR);
  assert.equal(attemptsAllow(undefined, T0), true);
  assert.equal(attemptsAllow([T0 - HOUR], T0), false, "too soon");
  assert.equal(attemptsAllow([T0 - 3 * HOUR], T0), true);
  assert.equal(attemptsAllow([T0 - 10 * HOUR, T0 - 4 * HOUR], T0), false, "two in a day");
  assert.equal(attemptsAllow([T0 - 25 * HOUR, T0 - 4 * HOUR], T0), true, "the older one has expired");
  assert.equal(attemptsAllow([T0 + HOUR], T0), false, "a stored future time is never treated as free");
});

test("only Online, Away, or no routine yet may write first; silence is exactly the tag or nothing", () => {
  for (const status of ["online", "away", null] as const) assert.equal(statusMayInitiate(status), true);
  for (const status of ["busy", "dnd", "offline"] as const) assert.equal(statusMayInitiate(status), false);
  assert.equal(isSilence(SILENCE_TAG), true); assert.equal(isSilence("  \n"), true); assert.equal(isSilence(`${SILENCE_TAG} hi`), false);
  assert.equal(maybeSilence("<veil-si"), true); assert.equal(maybeSilence("hello"), false);
});

test("a Character that writes first leaves a normal reply, with one provider request and one spent attempt", async () => {
  const { storage, prompts, reply } = setup();
  const session = await storage.openSession("a");
  const engine = reply("Hey, ", "I was thinking of you.");
  const sent = await at(T0, () => engine.initiate(session.id));
  assert.equal(sent?.content, "Hey, I was thinking of you.");
  assert.equal(sent?.status, "complete");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].at(-1)?.role, "system");
  assert.match(prompts[0].at(-1)!.content, /has not written to you/);
  const { session: stored, messages } = await storage.readSession(session.id);
  assert.deepEqual(stored.proactiveAttempts, [T0]);
  assert.equal(stored.generation, undefined);
  assert.deepEqual(messages.map((m) => [m.role, m.status]), [["assistant", "complete"]]);
});

test("a silent Character leaves no message, no preview change, no stream flash, and still spends the attempt", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  const first = await reply("Hi").requestReply(session.id);
  assert.equal(first?.content, "Hi");
  const before = (await storage.readSession(session.id)).session;
  const seen: string[] = [];
  const unsubscribe = storage.subscribe((change) => { if (change.domain === "messages") void storage.readSession(session.id).then((data) =>
    data.messages.forEach((m) => { if (m.role === "assistant" && m.content) seen.push(m.content); })).catch(() => {}); });
  const result = await at(T0, () => reply("<veil-", "silence/>").initiate(session.id));
  unsubscribe();
  assert.equal(result, null);
  const { session: after, messages } = await storage.readSession(session.id);
  assert.deepEqual(messages.map((m) => m.content), ["hello", "Hi"]);
  assert.deepEqual(seen.filter((text) => text.includes("silence")), []);
  assert.equal(after.generation, undefined);
  assert.equal(after.lastMessageId, before.lastMessageId);
  assert.equal(after.lastMessagePreview, before.lastMessagePreview);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.deepEqual(after.proactiveAttempts, [T0]);
});

test("the budget blocks early or excess attempts before any provider request, and frees after a day", async () => {
  const { storage, prompts, reply } = setup();
  const session = await storage.openSession("a");
  const engine = reply("one");
  const outcomes: (string | null)[] = [];
  for (const time of [T0, T0 + HOUR, T0 + 3 * HOUR, T0 + 6 * HOUR, T0 + 26 * HOUR])
    outcomes.push((await at(time, () => engine.initiate(session.id)))?.content ?? null);
  assert.deepEqual(outcomes, ["one", null, "one", null, "one"]);
  assert.equal(prompts.length, 3);
  assert.deepEqual((await storage.readSession(session.id)).session.proactiveAttempts, [T0 + 3 * HOUR, T0 + 26 * HOUR]);
});

test("an unanswered user message, a group chat, or a missing conversation never spends an attempt", async () => {
  const { storage, prompts, reply } = setup();
  const session = await storage.openSession("a");
  await storage.send(session.id, "are you there?");
  assert.equal(await at(T0, () => reply("hi").initiate(session.id)), null);
  const { session: stored, messages } = await storage.readSession(session.id);
  assert.equal(stored.proactiveAttempts, undefined);
  assert.equal(stored.generation, undefined);
  assert.deepEqual(messages.map((m) => [m.role, m.requestedBy ?? null]), [["user", null]], "the user's message is left for Request Reply");
  assert.equal(prompts.length, 0, "no provider request");
  await assert.rejects(reply("hi").initiate("missing"));
});

test("a failed request leaves no error marker or draft, is not retried, and still counts", async () => {
  const { storage, document } = setup();
  const session = await storage.openSession("a");
  let requests = 0;
  const engine = createChatEngine(storage, async () => document, async function* () { requests++; throw new Error("provider down"); },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  assert.equal(await at(T0, () => engine.initiate(session.id)), null);
  assert.equal(requests, 1);
  const { session: stored, messages } = await storage.readSession(session.id);
  assert.deepEqual(messages, []);
  assert.equal(stored.generation, undefined);
  assert.deepEqual(stored.proactiveAttempts, [T0]);
});

test("a user message whose reply was deleted still counts as unanswered", async () => {
  const { storage, prompts, reply } = setup();
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  const answer = await reply("Hi").requestReply(session.id);
  await storage.deleteMessages(session.id, [answer!.id]);
  assert.equal(await at(T0, () => reply("hello again").initiate(session.id)), null);
  assert.equal(prompts.length, 1, "only the earlier requested reply reached the provider");
  assert.equal((await storage.readSession(session.id)).session.proactiveAttempts, undefined);
});

test("recovery drops an interrupted initiated draft but keeps partial text as an interrupted reply", async () => {
  for (const partial of [false, true]) {
    const factory = new IDBFactory();
    const dying = new ChatStorage(() => factory), reopened = new ChatStorage(() => factory);
    const session = await dying.openSession("a");
    await dying.send(session.id, "hello");
    const answered = await createChatEngine(dying, async () => setup().document, async function* () { yield "Hi"; },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined).requestReply(session.id);
    assert.equal(answered?.content, "Hi");
    const settled = (await dying.readSession(session.id)).session;
    const id = await dying.claimGeneration(session.id, undefined, "initiate");
    const batch = await at(T0, () => dying.beginReply(session.id, undefined, id, "initiate"));
    assert.ok(batch);
    if (partial) await dying.updateReply(batch.assistant.id, { content: "I was going to say", status: "streaming" }, undefined, id);
    await crash(dying, id);
    assert.equal(await reopened.recoverGeneration(session.id), true);
    const { session: after, messages } = await reopened.readSession(session.id);
    assert.equal(after.generation, undefined);
    assert.deepEqual(after.proactiveAttempts, [T0]);
    if (partial) {
      assert.deepEqual(messages.map((m) => [m.content, m.status]), [["hello", "sent"], ["Hi", "complete"], ["I was going to say", "error"]]);
    } else {
      assert.deepEqual(messages.map((m) => m.content), ["hello", "Hi"]);
      assert.equal(after.lastMessageId, settled.lastMessageId);
      assert.equal(after.lastMessagePreview, settled.lastMessagePreview);
      assert.ok(after.updatedAt <= settled.updatedAt, "the abandoned attempt does not move the conversation up");
    }
  }
});

test("a claim interrupted before any draft exists does not turn unanswered user messages into answered ones", async () => {
  const factory = new IDBFactory();
  const dying = new ChatStorage(() => factory), reopened = new ChatStorage(() => factory);
  const session = await dying.openSession("a");
  const user = await dying.send(session.id, "still waiting");
  await crash(dying, await dying.claimGeneration(session.id, undefined, "initiate"));
  assert.equal(await reopened.recoverGeneration(session.id), true);
  const { session: after, messages } = await reopened.readSession(session.id);
  assert.equal(after.generation, undefined);
  assert.deepEqual(messages.map((m) => [m.id, m.role, m.requestedBy ?? null]), [[user.id, "user", null]]);
});

test("clearing the conversation keeps the budget", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  await at(T0, () => reply("hello").initiate(session.id));
  await storage.clearSession(session.id);
  const { session: stored, messages } = await storage.readSession(session.id);
  assert.deepEqual(messages, []);
  assert.deepEqual(stored.proactiveAttempts, [T0]);
});

const direct = (id: string, extra: Partial<ChatSession> = {}): ChatSession =>
  ({ id: `s-${id}`, characterId: id, updatedAt: 1, autoReplyOnKeyboardDismiss: false, nextOrder: 1, ...extra });
function checkDeps(sessions: ChatSession[], statuses: Record<string, "online" | "away" | "busy" | "dnd" | "offline" | null | undefined>,
  extra: Partial<ProactiveCheckDeps> = {}) {
  const started: string[] = [];
  const deps: ProactiveCheckDeps = {
    sessions: async () => sessions, status: async (id) => statuses[id], isGenerating: () => false, now: () => T0,
    initiate: async (id) => { started.push(id); }, ...extra,
  };
  return { deps, started };
}

test("a pass starts one attempt per eligible Character, in turn, and skips everyone else", async () => {
  const sessions = [direct("on"), direct("away"), direct("none"), direct("busy"), direct("dnd"), direct("off"), direct("gone"),
    direct("spent", { proactiveAttempts: [T0 - HOUR] }), direct("live", { generation: { id: "g", stage: "provider" } }),
    { ...direct("group"), type: "group" as const }];
  const statuses = { on: "online", away: "away", none: null, busy: "busy", dnd: "dnd", off: "offline", gone: undefined, spent: "online", live: "online", group: "online" } as const;
  const { deps, started } = checkDeps(sessions, statuses);
  assert.equal(await runProactiveCheck(deps, () => true), 3);
  assert.deepEqual(started, ["s-on", "s-away", "s-none"]);
});

test("the clock and each Character's status are read fresh for every attempt", async () => {
  let clock = T0; const seen: [string, number][] = [];
  const { deps } = checkDeps([direct("a"), direct("b")], {}, { now: () => (clock += HOUR),
    status: async (id, now) => { seen.push([id, now]); return "online"; } });
  await runProactiveCheck(deps, () => true);
  assert.deepEqual(seen, [["a", T0 + HOUR], ["b", T0 + 2 * HOUR]]);
});

test("a pass skips a Character whose chat is generating, stops when no longer alive, and survives a failed attempt", async () => {
  const live = checkDeps([direct("a")], { a: "online" }, { isGenerating: () => true });
  assert.equal(await runProactiveCheck(live.deps, () => true), 0);
  let alive = true;
  const stopping = checkDeps([direct("a"), direct("b")], { a: "online", b: "online" },
    { initiate: async (id) => { stopping.started.push(id); alive = false; throw new Error("provider down"); } });
  assert.equal(await runProactiveCheck(stopping.deps, () => alive), 1);
  assert.deepEqual(stopping.started, ["s-a"]);
});

test("being away builds no backlog: a pass after a long gap starts the same single attempt per Character", async () => {
  const { deps, started } = checkDeps([direct("a", { proactiveAttempts: [T0 - 200 * HOUR] })], { a: "online" });
  await runProactiveCheck(deps, () => true);
  assert.deepEqual(started, ["s-a"]);
});

test("the trigger runs a first pass, then every 15 minutes, only while visible, never overlapping, and stops cleanly", async () => {
  const tasks = new Map<number, { run: () => void; repeat: boolean }>(); let nextId = 1;
  const timers = {
    setTimeout: (run: () => void) => { tasks.set(nextId, { run, repeat: false }); return nextId++; },
    setInterval: (run: () => void) => { tasks.set(nextId, { run, repeat: true }); return nextId++; },
    clearTimeout: (id: unknown) => { tasks.delete(id as number); }, clearInterval: (id: unknown) => { tasks.delete(id as number); },
  };
  let visible = true, passes = 0, release!: () => void;
  const scheduler = createProactiveScheduler(async () => { passes++; await new Promise<void>((done) => { release = done; }); }, () => visible, timers);
  scheduler.start(); scheduler.start();
  assert.equal(tasks.size, 2, "starting twice does not double the timers");
  const [first, every] = [...tasks.values()];
  assert.equal(first.repeat, false); assert.equal(every.repeat, true);
  first.run(); assert.equal(passes, 1);
  scheduler.wake(); every.run(); assert.equal(passes, 1, "a running pass is never overlapped");
  release(); await new Promise((resolve) => setImmediate(resolve));
  visible = false; scheduler.wake(); every.run(); assert.equal(passes, 1, "hidden pages do not run passes");
  visible = true; scheduler.wake(); assert.equal(passes, 2);
  release(); await new Promise((resolve) => setImmediate(resolve));
  scheduler.stop(); assert.equal(tasks.size, 0);
  scheduler.wake(); assert.equal(passes, 2, "stopped means stopped");
});

const device = () => { const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); },
    removeItem: (k: string) => { raw.delete(k); } } } satisfies RestoreDevice; };
test("backup validates and restores proactiveAttempts and refuses damaged ones", async () => {
  const good = [T0 - 5 * HOUR, T0];
  const ok = backupData(); (ok.chat.sessions[0] as unknown as Record<string, unknown>).proactiveAttempts = good;
  const f = await packageFixture(ok), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(); await restoreIntoEmpty(manifest, f.files, d, lockOrigin().client());
  assert.deepEqual(((await readStaticBackupSource(d)).chat.sessions[0] as { proactiveAttempts?: unknown }).proactiveAttempts, good);
  for (const damaged of [[], "x", [1.5], [-1], ["1"], Array.from({ length: 11 }, (_, i) => i), [1, null]]) {
    const bad = backupData(); (bad.chat.sessions[0] as unknown as Record<string, unknown>).proactiveAttempts = damaged;
    const p = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files));
  }
});

test("the contact decision names something that happened in the Character's day as a possible, never required, reason", () => {
  assert.match(PROACTIVE_INSTRUCTION, /already happened in your day can be that reason, but it is never required/);
  assert.ok(PROACTIVE_INSTRUCTION.includes(SILENCE_TAG), "silence stays the way to decline");
});
