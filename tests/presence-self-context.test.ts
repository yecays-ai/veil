import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import type { PresenceRecord } from "../lib/presence/storage";
import type { TextProvider } from "../lib/chat/provider";

const NOW = new Date("2026-10-11T03:00:00Z");
const character = (extra: Record<string, unknown> = {}) =>
  ({ characterId: "a", ...normalizeCharacterInput({ name: "A", ...extra }) });
const record = (over: Partial<PresenceRecord>): PresenceRecord => ({ characterId: "a", routine: null, situations: [],
  signature: null, lastOnlineAt: null, lastMessageAt: null, ...over });
const contact = (remark: string | null, change: { from: string | null; to: string | null; at: number } | null = null) =>
  ({ remark, lastRemarkChange: change ? { type: "remark-changed" as const, fromRemark: change.from, toRemark: change.to, createdAt: change.at } : null });
const situation = { status: "busy" as const, reason: "on a night shift", startsAt: NOW.getTime() - 3600_000,
  endsAt: NOW.getTime() + 3600_000, changedAt: 0, source: null };

test("a Character without routine or situation gets no status line, only what it really has", () => {
  const state = selfState(character({ statusMessage: "  hello  " }), contact(" Dearest "), undefined, NOW.getTime());
  assert.deepEqual(state, { remark: "Dearest", remarkChange: null, status: null, situation: null, signature: "hello",
    userNote: null, canTransfer: true, canGift: true, canKeepsake: true, canChange: { situation: true, signature: true, note: true } });
  const text = selfStateContent(state)!;
  assert.match(text, /Your signature: "hello"/);
  assert.match(text, /Background, needs no response: the remark the user has saved for you is "Dearest"\. Mention it only when it fits naturally/);
  assert.doesNotMatch(text, /just/);
  assert.doesNotMatch(text, /status:/);
  assert.equal(selfStateContent(selfState(character(), undefined, undefined, NOW.getTime(), null, true, false)), null);
  assert.equal(selfStateContent(undefined), null);
});

test("an active situation is the status the Character is told, with its reason", () => {
  const state = selfState(character(), undefined, record({ situations: [situation] }), NOW.getTime());
  assert.equal(state.status, "busy");
  assert.match(selfStateContent(state)!, /Your current status: Busy \(on a night shift\)\./);
  assert.match(selfStateContent(state)!, /requested reply does not change your status or situation/);
});

test("the prompt carries the state as one system fact after history and does not change anything else", () => {
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [character()];
  const bare = assembleChatPrompt(document, document.characters[0], [], [], undefined, undefined, NOW);
  const same = assembleChatPrompt(document, document.characters[0], [], [], undefined, undefined, NOW, undefined, [], undefined, undefined);
  assert.deepEqual(same.messages, bare.messages);
  const state = selfState(document.characters[0], contact("Dearest"), record({ situations: [situation] }), NOW.getTime());
  const withSelf = assembleChatPrompt(document, document.characters[0], [], [], undefined, undefined, NOW, undefined, [], undefined, state);
  assert.equal(withSelf.messages.length, bare.messages.length + 1);
  assert.deepEqual(withSelf.messages.slice(0, -1), bare.messages);
  assert.equal(withSelf.messages.at(-1)!.role, "system");
  assert.match(withSelf.messages.at(-1)!.content, /Dearest/);
  assert.equal(withSelf.diagnostics.at(-1)!.identifier, "self");
});

const textOf = (state: ReturnType<typeof selfState>) => selfStateContent(state) ?? "";
const T = NOW.getTime();

test("a remark change is news only until the Character has replied after it", () => {
  const changed = contact("Honey", { from: "Dearest", to: "Honey", at: T });
  const fresh = textOf(selfState(character(), changed, undefined, T + 1, T - 1000));
  assert.match(fresh, /just changed the remark they use for you, from "Dearest" to "Honey"/);
  assert.match(fresh, /react to it, tease about it, or say nothing at all; do not bring it up unless it fits/);
  assert.doesNotMatch(fresh, /Background, needs no response/, "the new value is not repeated as background");
  const later = textOf(selfState(character(), changed, undefined, T + 1, T + 500));
  assert.doesNotMatch(later, /just changed/);
  assert.match(later, /Background, needs no response: .*"Honey"/);
  assert.equal(selfState(character(), changed, undefined, T + 1, T).remarkChange, null, "a reply at the same instant has seen it");
});

test("giving, clearing and a first reply cover every kind of change; Continue never announces one", () => {
  assert.match(textOf(selfState(character(), contact("Honey", { from: null, to: "Honey", at: T }), undefined, T, null)), /just gave you a remark: "Honey"/);
  const cleared = textOf(selfState(character({ statusMessage: "hi" }), contact(null, { from: "Honey", to: null, at: T }), undefined, T, T - 1));
  assert.match(cleared, /just removed the remark they had for you \(it was "Honey"\)/);
  assert.doesNotMatch(cleared, /Background, needs no response/);
  const nothingElse = selfStateContent(selfState(character(), contact(null, { from: "Honey", to: null, at: T }), undefined, T, T - 1))!;
  assert.match(nothingElse, /removed the remark/, "a cleared remark alone is still worth telling");
  assert.equal(selfState(character(), contact("Honey", { from: "Dearest", to: "Honey", at: T }), undefined, T, T - 1, false).remarkChange, null);
});

test("several changes before one reply announce only the latest, once", () => {
  const latest = contact("Sweet", { from: "Honey", to: "Sweet", at: T + 20 });
  const text = textOf(selfState(character(), latest, undefined, T + 30, T));
  assert.match(text, /from "Honey" to "Sweet"/);
  assert.doesNotMatch(text, /Dearest/);
  assert.doesNotMatch(textOf(selfState(character(), latest, undefined, T + 40, T + 25)), /just/);
});

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [character()];
  return { storage, session, document };
}

test("a requested reply reads the state once, sends it in the one provider request, and writes nothing", async () => {
  const app = await setup();
  const state = selfState(app.document.characters[0], contact("Dearest"), record({ situations: [situation] }), NOW.getTime());
  const sent: string[] = []; let loads = 0, calls = 0;
  const provider: TextProvider = async function* (_config, messages) {
    calls++; sent.push(messages.map((turn) => turn.content).join("\n")); yield "ok";
  };
  const engine = createChatEngine(app.storage, async () => app.document, provider, undefined, () => NOW, undefined, undefined, undefined,
    undefined, undefined, async () => {}, async (_character, now) => { loads++; assert.equal(now, NOW.getTime()); return state; });
  const reply = await engine.requestReply(app.session.id);
  assert.ok(reply);
  assert.equal(calls, 1, "no extra model request");
  assert.equal(loads, 1, "the state is read once per reply");
  assert.match(sent[0], /Your current status: Busy \(on a night shift\)/);
  assert.match(sent[0], /Background, needs no response: the remark the user has saved for you is "Dearest"/);
  await engine.regenerateMessage(reply!.id);
  assert.equal(loads, 2, "Regenerate reads the current state again, once");
});

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
const selfMessage = (prompt: string) => prompt.split("\n").filter((line) => /remark/.test(line)).join(" | ");

test("the change reaches the first reply after it, a Regenerate of that reply, and then goes back to background", async () => {
  const app = await setup(), seen: string[] = [];
  let change: ReturnType<typeof contact> = contact("Dearest");
  const provider: TextProvider = async function* (_config, messages) {
    seen.push(selfMessage(messages.map((turn) => turn.content).join("\n"))); yield "ok";
  };
  const engine = createChatEngine(app.storage, async () => app.document, provider, undefined, () => NOW, undefined, undefined, undefined,
    undefined, undefined, async () => {}, async (c, now, reply) => selfState(c, change, undefined, now, reply.lastReplyAt, reply.announceChange));
  const first = await engine.requestReply(app.session.id);
  assert.match(seen[0], /Background, needs no response/);
  await wait();
  change = contact("Honey", { from: "Dearest", to: "Honey", at: first!.createdAt + 1 });
  await app.storage.send(app.session.id, "Hi again");
  const second = await engine.requestReply(app.session.id);
  assert.match(seen[1], /just changed the remark they use for you, from "Dearest" to "Honey"/, "the first reply after the change hears of it");
  await wait();
  await engine.regenerateMessage(second!.id);
  assert.match(seen[2], /just changed the remark/, "Regenerate of that reply still hears of it");
  await app.storage.send(app.session.id, "And again");
  await engine.requestReply(app.session.id);
  assert.doesNotMatch(seen[3], /just changed/, "after replying once, it is only background");
  assert.match(seen[3], /Background, needs no response: .*"Honey"/);
  await wait();
  change = contact(null, { from: "Honey", to: null, at: Date.now() });
  await app.storage.send(app.session.id, "Once more");
  await engine.requestReply(app.session.id);
  assert.match(seen[4], /just removed the remark they had for you \(it was "Honey"\)/);
});

test("the Character knows its current activity and only a Moment that has already happened", () => {
  const HOUR = 3600_000;
  const startsAt = NOW.getTime() - HOUR;
  const activity = { id: "a:1", occurrenceKey: "a|1", kind: "meal" as const, title: "Lunch", startsAt, endsAt: startsAt + 2 * HOUR,
    moment: "Found a shortcut." };
  const life = { reconciledAt: startsAt, activities: [activity, { ...activity, id: "a:2", occurrenceKey: "a|2", title: "Dinner",
    startsAt: startsAt + 6 * HOUR, endsAt: startsAt + 7 * HOUR, moment: "Burned the rice." }] };
  const early = selfState(character(), undefined, record({ life }), startsAt + 1);
  assert.deepEqual(early.activity, { title: "Lunch" });
  const text = selfStateContent(early)!;
  assert.match(text, /doing right now: "Lunch"/);
  assert.doesNotMatch(text, /shortcut|Dinner|rice/, "neither a hidden Moment nor a later activity reaches the prompt");
  const later = selfState(character(), undefined, record({ life }), startsAt + 2 * HOUR - 1);
  assert.deepEqual(later.activity, { title: "Lunch", moment: "Found a shortcut." });
  assert.match(selfStateContent(later)!, /Something small already happened during it: "Found a shortcut\."/);
  assert.equal(selfState(character(), undefined, record({ life, situations: [situation] }), NOW.getTime()).activity, undefined,
    "an active situation overrides the day");
});
