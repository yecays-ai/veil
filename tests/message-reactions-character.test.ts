import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { characterMayReact, reactionTarget, userReactionNotes } from "../lib/chat/reactions";
import { splitActions } from "../lib/presence/actions";
import { createChatEngine } from "./chat-engine-fixture";
import type { TextProvider } from "../lib/chat/provider";
import type { ChatMessage } from "../lib/chat/types";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const NOW = 1_700_000_000_000;
const tag = (json: string) => `Hello. <veil-action>${json}</veil-action>`;

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory()), session = await storage.openSession("simulated-character");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated" }) }];
  const prompts: string[] = [], applied: unknown[][] = [];
  let reply = "Plain reply.";
  const provider: TextProvider = async function* (_config, messages) {
    prompts.push(messages.map((message) => message.content).join("\n"));
    yield reply;
  };
  const engine = createChatEngine(storage, async () => document, provider, undefined, () => new Date(NOW),
    undefined, undefined, undefined, undefined, undefined, async () => {},
    async (character, now, state) => selfState(character, undefined, undefined, now, state.lastReplyAt, state.announceChange, state.allowActions, state.reactions),
    async (...args) => { applied.push(args); });
  const ask = async (text: string, answer: string) => {
    reply = answer;
    await storage.send(session.id, text);
    await engine.requestReply(session.id);
    await flush();
    return (await storage.readSession(session.id)).messages;
  };
  return { storage, session, prompts, applied, ask };
}
const users = (messages: ChatMessage[]) => messages.filter((message) => message.role === "user");

test("a reply tag reacts to the user's message: stored on that message, hidden from the reply, no Presence write, one request", async () => {
  const app = await setup();
  const messages = await app.ask("first", tag('{"reactToUser":"❤️"}'));
  assert.deepEqual(users(messages)[0].reactions, { character: "❤️" });
  const reply = messages.find((message) => message.role === "assistant")!;
  assert.equal(reply.content, "Hello.");
  assert.equal(reply.reactions, undefined);
  assert.equal(app.prompts.length, 1);
  assert.deepEqual(app.applied, [], "a reaction alone is chat data, not a Presence change");
});

test("a Character does not react to two user messages in a row, and the prompt only offers it when allowed", async () => {
  const app = await setup();
  let messages = await app.ask("one", tag('{"reactToUser":"😂"}'));
  assert.match(app.prompts[0], /reactToUser/);
  messages = await app.ask("two", tag('{"reactToUser":"👍"}'));
  assert.doesNotMatch(app.prompts[1], /reactToUser/);
  assert.equal(users(messages)[1].reactions, undefined);
  messages = await app.ask("three", tag('{"reactToUser":"🙏"}'));
  assert.match(app.prompts[2], /reactToUser/);
  assert.deepEqual(users(messages).map((message) => message.reactions), [{ character: "😂" }, undefined, { character: "🙏" }]);
});

test("a reaction that is not exactly one emoji is dropped, and the rest of the reply is untouched", async () => {
  const app = await setup();
  for (const [index, bad] of ["abc", "❤️❤️", "", "<b>"].entries()) {
    const messages = await app.ask(`m${index}`, tag(`{"reactToUser":${JSON.stringify(bad)}}`));
    assert.equal(users(messages)[index].reactions, undefined, JSON.stringify(bad));
  }
});

test("a failed commit leaves no reaction on the user's message", async () => {
  const app = await setup();
  app.storage.finalizeReply = async () => { throw new Error("simulated storage failure"); };
  await app.storage.send(app.session.id, "first");
  const provider = createChatEngine(app.storage, async () => { const d = defaultFoundation(); d.runtime.timeAware = false;
    d.characters = [{ characterId: "simulated-character", ...normalizeCharacterInput({ name: "Simulated" }) }]; return d; },
    async function* () { yield tag('{"reactToUser":"❤️"}'); }, undefined, () => new Date(NOW), undefined, undefined, undefined, undefined, undefined, async () => {});
  await provider.requestReply(app.session.id).catch(() => undefined);
  await flush();
  assert.equal(users((await app.storage.readSession(app.session.id)).messages)[0].reactions, undefined);
});

test("the user's reaction on the Character's message reaches its next prompt, briefly", async () => {
  const app = await setup();
  const messages = await app.ask("hello", "A long reply that the user will react to later.");
  const assistant = messages.find((message) => message.role === "assistant")!;
  await app.storage.setReaction(assistant.id, "user", "👍");
  await app.ask("next", "Okay.");
  assert.match(app.prompts[1], /the user reacted 👍 to your message "A long reply that the user will react to"\./);
  assert.doesNotMatch(app.prompts[0], /the user reacted/);
});

test("reaction helpers pick the answered user message and bound the notes", () => {
  const message = (id: string, role: ChatMessage["role"], order: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id, sessionId: "s", role, content: `text ${id}`, status: role === "user" ? "sent" : "complete", createdAt: order, order, ...extra });
  const list = [message("u1", "user", 1, { reactions: { character: "❤️" } }), message("a1", "assistant", 2, { reactions: { user: "👍" } }),
    message("u2", "user", 3), message("a2", "assistant", 4, { reactions: { user: "😂" } }), message("a3", "assistant", 5, { reactions: { user: "🙏" } }),
    message("a4", "assistant", 6, { reactions: { user: "❓" } }), message("sys", "system", 7)];
  assert.equal(reactionTarget(list, 5)?.id, "u2");
  assert.equal(reactionTarget(list, 2)?.id, "u1");
  assert.equal(characterMayReact(list, list[2]), false, "u1 already has the Character's reaction");
  assert.equal(characterMayReact(list, list[0]), true);
  assert.deepEqual(userReactionNotes(list).map((note) => note.emoji), ["❓", "🙏", "😂"]);
  assert.deepEqual(userReactionNotes([]), []);
});

test("self context offers the reaction field only when allowed and never changes the existing action text", () => {
  const character = { characterId: "c", timezone: "UTC", statusMessage: null };
  const withReaction = selfStateContent(selfState(character, undefined, undefined, NOW, null, true, true, { canReact: true, notes: [] }))!;
  assert.match(withReaction, /"reactToUser": one emoji/);
  assert.match(withReaction, /<veil-action>/);
  const without = selfStateContent(selfState(character, undefined, undefined, NOW, null, true, true, { canReact: false, notes: [] }))!;
  assert.doesNotMatch(without, /reactToUser|react to the user's message/);
  assert.equal(selfStateContent(selfState(character, undefined, undefined, NOW, null, true, false, { canReact: true, notes: [] })), null, "Continue offers nothing");
  assert.equal(splitActions(tag('{"reactToUser":"❤️"}')).actions?.reactToUser, "❤️");
});
