import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { lifeReplyPlan } from "../lib/chat/life-reply";
import { createLifeReplyWatcher, LIFE_REPLY_QUIET_MS, LIFE_REPLY_RECHECK_MS, type LifeReplyDeps } from "../lib/chat/life-reply-watcher";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import type { PresenceInputs, RoutineBlock } from "../lib/presence/compute";
import type { PresenceRecord } from "../lib/presence/storage";
import type { ChatMessage, ChatSession } from "../lib/chat/types";
import { validateBackupPackage } from "../lib/backup/validation";
import { backupData, packageFixture } from "./backup-fixture";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { hasComposingDraft, setComposingDraft, subscribeComposing } from "../lib/chat/composition";
import { lockOrigin } from "./generation-lock-fixture";

const MIN = 60_000, HOUR = 60 * MIN;
const DAY0 = Date.UTC(2026, 9, 14); // a Wednesday, UTC
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const block = (startHour: number, endHour: number, status: RoutineBlock["status"]): RoutineBlock =>
  ({ days: ALL_DAYS, startMinute: startHour * 60, endMinute: endHour * 60, status });
const presence = (blocks: RoutineBlock[], defaultStatus: RoutineBlock["status"] = "online"): PresenceInputs =>
  ({ characterId: "a", timezone: null, routine: { blocks, defaultStatus, jitterMinutes: 0 }, situations: [] });
const workDay = presence([block(13, 15, "busy")]);

test("a free Character answers within seconds, and the time never moves", () => {
  const plan = lifeReplyPlan({ pendingId: "m1", pendingAt: DAY0 + 10 * HOUR, lastReplyAt: null, presence: workDay });
  assert.equal(plan.kind, "due");
  if (plan.kind !== "due") return;
  assert.ok(plan.at >= DAY0 + 10 * HOUR + 2000 && plan.at < DAY0 + 10 * HOUR + 8000);
  assert.deepEqual(lifeReplyPlan({ pendingId: "m1", pendingAt: DAY0 + 10 * HOUR, lastReplyAt: null, presence: workDay }), plan);
  const none = lifeReplyPlan({ pendingId: "m1", pendingAt: DAY0, lastReplyAt: null,
    presence: { characterId: "a", timezone: null, routine: null, situations: [] } });
  assert.equal(none.kind === "due" && none.at - DAY0 < 8000, true, "no routine and no situation: nothing to be busy with");
});

test("Busy sometimes peeks quickly and otherwise waits a varying time, never past the end of the busy block", () => {
  const pendingAt = DAY0 + 13 * HOUR + 30 * MIN;   // well after the grace window
  const delays: number[] = [];
  for (let index = 0; index < 200; index++) {
    const plan = lifeReplyPlan({ pendingId: `m${index}`, pendingAt, lastReplyAt: null, presence: workDay });
    assert.equal(plan.kind, "due");
    if (plan.kind === "due") delays.push(plan.at - pendingAt);
  }
  const quick = delays.filter((delay) => delay <= 8 * MIN);
  assert.ok(quick.length > 30 && quick.length < 90, `about three in ten peek (${quick.length}/200)`);
  assert.ok(quick.every((delay) => delay >= 1 * MIN));
  assert.ok(new Set(delays.map((delay) => Math.round(delay / MIN))).size > 20, "no fixed wait");
  // The block ends at 15:00, 90 minutes after the message: nobody waits longer than the block plus a minute.
  assert.ok(delays.every((delay) => delay <= 90 * MIN + MIN), "capped by the end of Busy");
  const late = DAY0 + 14 * HOUR + 50 * MIN;      // ten minutes of Busy left
  for (let index = 0; index < 50; index++) {
    const plan = lifeReplyPlan({ pendingId: `n${index}`, pendingAt: late, lastReplyAt: null, presence: workDay });
    assert.ok(plan.kind === "due" && plan.at <= DAY0 + 15 * HOUR + MIN + 5000, "answered right after Busy ends at the latest");
  }
});

test("a chat already under way keeps going briefly when Busy starts, then falls back to the normal wait", () => {
  const justBusy = DAY0 + 13 * HOUR + 3 * MIN;
  for (let index = 0; index < 30; index++) {
    const plan = lifeReplyPlan({ pendingId: `c${index}`, pendingAt: justBusy, lastReplyAt: justBusy - 2 * MIN, presence: workDay });
    assert.ok(plan.kind === "due" && plan.at - justBusy >= 10_000 && plan.at - justBusy < 60_000 + 1);
  }
  const stale = lifeReplyPlan({ pendingId: "c1", pendingAt: justBusy, lastReplyAt: justBusy - 30 * MIN, presence: workDay });
  assert.ok(stale.kind === "due" && stale.at - justBusy >= MIN, "no recent reply: not a chat under way");
  const later = DAY0 + 13 * HOUR + 40 * MIN;
  const plan = lifeReplyPlan({ pendingId: "c1", pendingAt: later, lastReplyAt: later - MIN, presence: workDay });
  assert.ok(plan.kind === "due" && plan.at - later >= MIN, "Busy for a while: the grace is over");
});

test("Offline and Do Not Disturb wait for an available status; with none ahead the message is parked", () => {
  const sleeping = presence([block(0, 8, "offline")]);
  const plan = lifeReplyPlan({ pendingId: "s1", pendingAt: DAY0 + 2 * HOUR, lastReplyAt: null, presence: sleeping });
  assert.ok(plan.kind === "due" && plan.at >= DAY0 + 8 * HOUR + 30_000 && plan.at < DAY0 + 8 * HOUR + 4 * MIN, "back online, not at a time cap");
  const quiet = presence([block(20, 22, "dnd")]);
  const dnd = lifeReplyPlan({ pendingId: "s1", pendingAt: DAY0 + 21 * HOUR, lastReplyAt: null, presence: quiet });
  assert.ok(dnd.kind === "due" && dnd.at >= DAY0 + 22 * HOUR, "Do Not Disturb never peeks");
  const forever: PresenceInputs = { characterId: "a", timezone: null, routine: { blocks: [], defaultStatus: "offline", jitterMinutes: 0 }, situations: [] };
  assert.deepEqual(lifeReplyPlan({ pendingId: "s1", pendingAt: DAY0, lastReplyAt: null, presence: forever }), { kind: "parked" });
});

// ---- the watcher ----

type Row = { id: string; characterId: string; type?: "group"; lifeMode?: true; generation?: object };
function user(id: string, order: number, createdAt: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, sessionId: "s", role: "user", content: id, status: "sent", createdAt, order, ...extra } as ChatMessage;
}
function harness(options: { sessions?: Row[]; messages?: ChatMessage[]; inputs?: PresenceInputs | undefined; now?: number; visible?: boolean } = {}) {
  const state = { sessions: options.sessions ?? [{ id: "s", characterId: "a", lifeMode: true as const }],
    messages: options.messages ?? [user("m1", 1, DAY0 + 10 * HOUR)], now: options.now ?? DAY0 + 10 * HOUR + 30_000,
    visible: options.visible ?? true, generating: false, composing: false, inputs: "inputs" in options ? options.inputs : workDay };
  const replies: string[] = [];
  const hooks = { onSessionRead: async () => {} };
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const deps: LifeReplyDeps = {
    sessions: async () => state.sessions as unknown as ChatSession[],
    session: async (id) => { await hooks.onSessionRead();
      return { session: state.sessions.find((row) => row.id === id) as unknown as ChatSession, messages: state.messages }; },
    presence: async () => state.inputs,
    isGenerating: () => state.generating,
    composing: () => state.composing,
    reply: async (id) => { replies.push(id); if (fail) throw new Error("provider down"); },
    now: () => state.now, visible: () => state.visible,
  };
  let fail = false;
  const watcher = createLifeReplyWatcher(deps, {
    setTimeout: (run, ms) => { const timer = { run, ms, live: true }; timers.push(timer); return timer; },
    clearTimeout: (handle) => { (handle as { live: boolean }).live = false; },
  });
  return { state, replies, timers, watcher, hooks, failNext: () => { fail = true; },
    live: () => timers.filter((timer) => timer.live),
    async fire() { const next = timers.filter((timer) => timer.live).at(-1); if (!next) return false; next.live = false; next.run(); await settle(); return true; } };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a due message is answered once through the normal reply path", async () => {
  const h = harness();
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, ["s"]);
  h.watcher.touch("s"); await h.fire();
  assert.deepEqual(h.replies, ["s"], "the same unanswered message is not asked for twice");
  h.watcher.stop();
});

test("a failed reply is not retried by the scheduler, but a new message from the user is a new ask", async () => {
  const h = harness(); h.failNext();
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, ["s"]);
  for (let round = 0; round < 3; round++) { h.watcher.touch("s"); await h.fire(); await h.watcher.wake(); }
  assert.deepEqual(h.replies, ["s"], "no loop while the message is still there");
  h.state.messages = [...h.state.messages, user("m2", 2, h.state.now)];
  h.state.now += 20_000;
  h.watcher.touch("s"); await h.fire();
  assert.deepEqual(h.replies, ["s", "s"]);
  h.watcher.stop();
});

test("Busy schedules one timer; waiting messages merge; a long wait is re-checked in pieces", async () => {
  const busyAt = DAY0 + 13 * HOUR + 30 * MIN;
  const h = harness({ messages: [user("m1", 1, busyAt)], now: busyAt + 1000 });
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, []);
  assert.equal(h.live().length, 1);
  assert.ok(h.live()[0].ms <= LIFE_REPLY_RECHECK_MS);
  h.state.messages = [...h.state.messages, user("m2", 2, busyAt + 2 * MIN)];
  h.watcher.touch("s"); await h.fire();            // settle timer -> check -> one waiting timer again
  assert.equal(h.live().length, 1, "still exactly one timer for the conversation");
  assert.deepEqual(h.replies, []);
  h.state.now = busyAt + 95 * MIN; await h.fire();  // past the end of Busy
  assert.deepEqual(h.replies, ["s"], "one reply for both messages");
  h.watcher.stop();
  assert.equal(h.live().length, 0, "stop leaves no timer behind");
});

test("nothing happens for a conversation without Life Mode, a group, a vanished Character or a hidden page", async () => {
  const cases: Array<[string, Parameters<typeof harness>[0]]> = [
    ["off", { sessions: [{ id: "s", characterId: "a" }] }],
    ["group", { sessions: [{ id: "s", characterId: "a", type: "group", lifeMode: true }] }],
    ["gone", { inputs: undefined }],
    ["hidden", { visible: false }],
    ["generating elsewhere", { sessions: [{ id: "s", characterId: "a", lifeMode: true, generation: { id: "g" } }] }],
    ["already asked", { messages: [user("m1", 1, DAY0 + 10 * HOUR, { requestedBy: "r" })] }],
  ];
  for (const [name, options] of cases) {
    const h = harness(options);
    h.watcher.start(); await settle(); h.watcher.touch("s"); await h.fire();
    assert.deepEqual(h.replies, [], name); assert.equal(h.live().length, 0, `${name}: no timer`);
    h.watcher.stop();
  }
});

test("a parked message is looked at again now and then, and a message stored during a reply is not forgotten", async () => {
  const offline: PresenceInputs = { characterId: "a", timezone: null, routine: { blocks: [], defaultStatus: "offline", jitterMinutes: 0 }, situations: [] };
  const parked = harness({ inputs: offline });
  parked.watcher.start(); await settle();
  assert.deepEqual(parked.replies, []);
  assert.equal(parked.live().length, 1); assert.equal(parked.live()[0].ms, LIFE_REPLY_RECHECK_MS);
  parked.state.inputs = workDay; await parked.fire();   // a changed situation or routine unparks it
  assert.deepEqual(parked.replies, ["s"]);
  parked.watcher.stop();

  const h = harness({ messages: [user("m1", 1, DAY0 + 10 * HOUR, { requestedBy: "r" })] });
  h.state.generating = true;
  h.watcher.start(); await settle();
  h.state.messages = [...h.state.messages, user("m2", 2, h.state.now)];
  h.watcher.touch("s"); await h.fire();                 // still generating: looked at again, not dropped
  assert.deepEqual(h.replies, []); assert.equal(h.live().length, 1, "re-armed");
  h.state.generating = false; h.state.now += 20_000; await h.fire();
  assert.deepEqual(h.replies, ["s"]);
  h.watcher.stop();
});

test("a check that was waiting when Life Mode got turned off does not reply", async () => {
  const h = harness();
  const read = h.state.sessions;
  h.watcher.start(); h.state.sessions = [{ id: "s", characterId: "a" }]; await settle();
  assert.deepEqual(h.replies, []); void read;
  h.watcher.stop();
});

test("turning Life Mode off leaves the waiting message for Request Reply and schedules nothing", async () => {
  const busyAt = DAY0 + 13 * HOUR + 30 * MIN;
  const h = harness({ messages: [user("m1", 1, busyAt)], now: busyAt + 1000 });
  h.watcher.start(); await settle();
  assert.equal(h.live().length, 1);
  h.state.sessions = [{ id: "s", characterId: "a" }];
  h.watcher.touch("s"); await h.fire(); h.state.now = busyAt + 3 * HOUR; await h.watcher.wake();
  assert.deepEqual(h.replies, []);
  assert.equal(h.live().length, 0);
  h.watcher.stop();
});

test("a hidden page keeps no timer and a returning page answers what is overdue", async () => {
  const busyAt = DAY0 + 13 * HOUR + 30 * MIN;
  const h = harness({ messages: [user("m1", 1, busyAt)], now: busyAt + 1000 });
  h.watcher.start(); await settle();
  h.state.visible = false; h.watcher.suspend();
  assert.equal(h.live().length, 0);
  h.state.visible = true; h.state.now = busyAt + 4 * HOUR; await h.watcher.wake();
  assert.deepEqual(h.replies, ["s"]);
  h.watcher.stop();
});

// ---- storage, engine and context ----

function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  let failing = false; const prompts: { role: string; content: string }[][] = [];
  const engine = createChatEngine(storage, async () => document,
    async function* (_config, prompt) { prompts.push([...prompt] as never); if (failing) throw new Error("provider down"); yield "ok"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  return { storage, engine, prompts, fail: () => { failing = true; } };
}

test("the setting is stored only while on, refused for groups, and kept when the history is cleared", async () => {
  const { storage } = setup();
  const session = await storage.openSession("a");
  assert.equal("lifeMode" in session, false);
  await storage.updateSessionSettings(session.id, { lifeMode: true });
  assert.equal((await storage.readSession(session.id)).session.lifeMode, true);
  await storage.updateSessionSettings(session.id, { lifeMode: false });
  assert.equal("lifeMode" in (await storage.readSession(session.id)).session, false, "absent again, like a session that never had it");
  await assert.rejects(storage.updateSessionSettings(session.id, { lifeMode: "yes" as never }), /Invalid/);
  const group = await storage.createGroupSession(["a", "b"], "Friends");
  await assert.rejects(storage.updateSessionSettings(group.id, { lifeMode: true }), /direct/);
});

test("a started reply marks every waiting message as asked, even when the provider fails, so nothing is left to loop on", async () => {
  const { storage, engine, fail } = setup();
  const session = await storage.openSession("a");
  await engine.send(session.id, "one"); await engine.send(session.id, "two");
  fail();
  await engine.requestReply(session.id, undefined, "life-reply").catch(() => undefined);
  const { messages } = await storage.readSession(session.id);
  assert.deepEqual(messages.filter((m) => m.role === "user").map((m) => !!m.requestedBy), [true, true]);
  assert.equal(messages.some((m) => m.role === "user" && m.status === "sent" && !m.requestedBy), false);
});

test("the Character is told it may wrap up only when Busy is about to start or just started, and only in Life Mode", () => {
  const record = (over: Partial<PresenceRecord> = {}): PresenceRecord => ({ characterId: "a", routine: { routine: workDay.routine!, source: "test", updatedAt: 0 } as never,
    situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null, ...over });
  const character = { characterId: "a", ...normalizeCharacterInput({ name: "A" }) };
  const at = (offset: number, life = true) => selfState(character, undefined, record(), DAY0 + 13 * HOUR + offset, null, true, true, undefined, life);
  assert.equal(at(-5 * MIN).leaving, "soon");
  assert.equal(at(5 * MIN).leaving, "now");
  assert.equal(at(-40 * MIN).leaving, undefined);
  assert.equal(at(40 * MIN).leaving, undefined);
  assert.equal(at(-5 * MIN, false).leaving, undefined, "ordinary chats do not get the line");
  assert.match(selfStateContent(at(-5 * MIN))!, /busy time is about to start.*may say naturally that you have to go/);
  assert.doesNotMatch(selfStateContent(at(-40 * MIN))!, /have to go/);
  assert.equal(selfState(character, undefined, record({ routine: null }), DAY0, null, true, true, undefined, true).leaving, undefined);
});

const device = () => { const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); },
    removeItem: (k: string) => { raw.delete(k); } } } satisfies RestoreDevice; };
test("a backup keeps Life Mode when it is on and refuses any other value", async () => {
  const ok = backupData(); (ok.chat.sessions[0] as unknown as Record<string, unknown>).lifeMode = true;
  const f = await packageFixture(ok), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(); await restoreIntoEmpty(manifest, f.files, d, lockOrigin().client());
  assert.equal(((await readStaticBackupSource(d)).chat.sessions[0] as { lifeMode?: unknown }).lifeMode, true);
  for (const damaged of [false, 0, "true", null]) {
    const bad = backupData(); (bad.chat.sessions[0] as unknown as Record<string, unknown>).lifeMode = damaged;
    const p = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files));
  }
});

test("a run of short messages is one turn: the quiet window counts from the newest message", async () => {
  const T = DAY0 + 10 * HOUR;
  const h = harness({ messages: [user("m1", 1, T), user("m2", 2, T + 7000)], now: T + 9000 }); // m1 alone was due by T + 8 s
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, [], "m2 is only 2 s old");
  const wait = h.live().at(-1)!;
  assert.ok(wait.ms > 0 && wait.ms <= LIFE_REPLY_QUIET_MS, `waits out the rest of the window (${wait.ms} ms)`);
  h.state.now = T + 7000 + LIFE_REPLY_QUIET_MS; await h.fire();
  assert.deepEqual(h.replies, ["s"], "one reply for the whole run");
  h.watcher.stop();
});

test("the quiet window never brings a Presence delay forward", async () => {
  const busyAt = DAY0 + 13 * HOUR + 30 * MIN;
  const h = harness({ messages: [user("m1", 1, busyAt)], now: busyAt + 1000 });
  h.watcher.start(); await settle();
  h.state.now = busyAt + 20_000; h.state.messages = [...h.state.messages, user("m2", 2, busyAt + 15_000)];
  h.watcher.touch("s"); await h.fire();
  assert.deepEqual(h.replies, [], "Busy still decides when");
  h.watcher.stop();
});

test("a draft in the composer holds the reply for as long as it exists, then the reply follows", async () => {
  const h = harness();
  h.state.composing = true;
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, []);
  assert.equal(h.live().length, 0, "no timer polls while the draft exists");
  h.state.now += 10 * MIN; await h.watcher.wake();
  assert.deepEqual(h.replies, [], "a long pause does not end the hold");
  h.state.composing = false; h.watcher.touch("s"); await h.fire();
  assert.deepEqual(h.replies, ["s"]);
  h.watcher.stop();
});

test("a draft or a newer message that appears during the last read still holds the reply", async () => {
  const h = harness();
  let reads = 0;
  // The second session read of a check is the last one before replying: a draft starts while it is pending.
  h.hooks.onSessionRead = async () => { reads++; if (reads === 2) h.state.composing = true; };
  h.watcher.start(); await settle();
  assert.deepEqual(h.replies, [], "the draft begun during the read is respected");
  h.state.composing = false; reads = 10;
  h.hooks.onSessionRead = async () => { reads++; if (reads === 12) h.state.messages = [...h.state.messages, user("m2", 2, h.state.now)]; };
  h.watcher.touch("s"); await h.fire();
  assert.deepEqual(h.replies, [], "a message stored during the read restarts the quiet window");
  h.hooks.onSessionRead = async () => {};
  h.state.now += LIFE_REPLY_QUIET_MS; await h.fire();
  assert.deepEqual(h.replies, ["s"]);
  h.watcher.stop();
});

test("the composition signal reports real changes only and clears per conversation", () => {
  const heard: string[] = [];
  const stop = subscribeComposing((id) => heard.push(`${id}:${hasComposingDraft(id)}`));
  setComposingDraft("x", true); setComposingDraft("x", true); setComposingDraft("y", true);
  setComposingDraft("x", false); setComposingDraft("x", false);
  assert.deepEqual(heard, ["x:true", "y:true", "x:false"]);
  assert.equal(hasComposingDraft("y"), true);
  setComposingDraft("y", false); stop();
  setComposingDraft("x", true); setComposingDraft("x", false);
  assert.equal(heard.length, 4, "no events after unsubscribing");
});

test("the chat page reports its draft per conversation and clears it when it leaves or switches", () => {
  const source = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(source, /setComposingDraft\(composingSessionId, hasDraft\);\s*return \(\) => setComposingDraft\(composingSessionId, false\);/);
  assert.match(source, /const hasDraft = draft\.trim\(\)\.length > 0;/);
});
