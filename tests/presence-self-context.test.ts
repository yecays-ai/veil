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
const situation = { status: "busy" as const, reason: "on a night shift", startsAt: NOW.getTime() - 3600_000,
  endsAt: NOW.getTime() + 3600_000, changedAt: 0, source: null };

test("a Character without routine or situation gets no status line, only what it really has", () => {
  const state = selfState(character({ statusMessage: "  hello  " }), { remark: " Dearest " }, undefined, NOW.getTime());
  assert.deepEqual(state, { remark: "Dearest", status: null, situation: null, signature: "hello" });
  const text = selfStateContent(state)!;
  assert.match(text, /Your signature: "hello"/);
  assert.match(text, /remark "Dearest"/);
  assert.doesNotMatch(text, /status:/);
  assert.equal(selfStateContent(selfState(character(), undefined, undefined, NOW.getTime())), null);
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
  const state = selfState(document.characters[0], { remark: "Dearest" }, record({ situations: [situation] }), NOW.getTime());
  const withSelf = assembleChatPrompt(document, document.characters[0], [], [], undefined, undefined, NOW, undefined, [], undefined, state);
  assert.equal(withSelf.messages.length, bare.messages.length + 1);
  assert.deepEqual(withSelf.messages.slice(0, -1), bare.messages);
  assert.equal(withSelf.messages.at(-1)!.role, "system");
  assert.match(withSelf.messages.at(-1)!.content, /Dearest/);
  assert.equal(withSelf.diagnostics.at(-1)!.identifier, "self");
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
  const state = selfState(app.document.characters[0], { remark: "Dearest" }, record({ situations: [situation] }), NOW.getTime());
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
  assert.match(sent[0], /The user saved the remark "Dearest" for you/);
  await engine.regenerateMessage(reply!.id);
  assert.equal(loads, 2, "Regenerate reads the current state again, once");
});
