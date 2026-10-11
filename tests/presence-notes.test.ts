import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { canRegenerateTurn } from "../lib/chat/turns";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { defaultFoundation, normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";
import { NOTE_COOLDOWN_MS, actionAllowance, characterActionApplier, cleanUserNote, splitActions } from "../lib/presence/actions";
import { characterNoteEventText, userNoteEventText } from "../lib/presence/note-events";
import { addContact, remarkChangeMade, updateContact } from "../lib/contact-storage";
import { emptyPresenceDocument, normalizePresenceDocument, presenceRecord, type PresenceDocument } from "../lib/presence/storage";

const T = new Date("2026-10-11T03:00:00Z").getTime(), MIN = 60_000;
const tag = (json: string) => `<veil-action>${json}</veil-action>`;
const character = () => ({ characterId: "a", ...normalizeCharacterInput({ name: "Ghost" }) });

function stores() {
  const state = { presence: emptyPresenceDocument(), foundation: { ...defaultFoundation(), characters: [character()] } as FoundationDocument };
  const events: unknown[][] = [];
  const apply = characterActionApplier({
    presence: { load: async () => state.presence, transact: async (f: (d: PresenceDocument) => PresenceDocument) => (state.presence = f(state.presence)) },
    foundation: { transact: async (f: (d: FoundationDocument) => FoundationDocument) => (state.foundation = f(state.foundation)) },
    noteChanged: async (...args) => { events.push(args); },
  });
  return { state, events, apply };
}

test("a note on the user is read from the tag, cleaned to 100 characters, and is its own action", () => {
  assert.deepEqual(splitActions(`Hey you.\n${tag('{"userNote":" Sweet\\u0000heart "}')}`).actions, { userNote: "Sweet heart" });
  assert.equal(splitActions(tag('{"userNote":""}')).actions?.userNote, null, "empty clears");
  assert.equal(Array.from(cleanUserNote("好".repeat(300))!).length, 100);
});

test("the note is saved to Presence, announced once, honours its cooldown, and skips no-ops", async () => {
  const { state, events, apply } = stores();
  await apply("a", { userNote: "Sweetheart" }, T, "m1");
  assert.deepEqual(presenceRecord(state.presence, "a")!.userNote, { text: "Sweetheart", changedAt: T, source: "character:m1" });
  assert.deepEqual(events, [["a", "Sweetheart", T]]);
  await apply("a", { userNote: "Darling" }, T + NOTE_COOLDOWN_MS - 1, "m2");
  assert.equal(presenceRecord(state.presence, "a")!.userNote!.text, "Sweetheart", "cooldown: nothing written");
  await apply("a", { userNote: "Sweetheart" }, T + NOTE_COOLDOWN_MS, "m3");
  assert.equal(events.length, 1, "an unchanged note makes no event and starts no cooldown");
  assert.equal(presenceRecord(state.presence, "a")!.userNote!.source, "character:m1");
  await apply("a", { userNote: null }, T + NOTE_COOLDOWN_MS, "m4");
  assert.equal(presenceRecord(state.presence, "a")!.userNote!.text, "", "cleared, and the cooldown mark is kept");
  assert.deepEqual(events.at(-1), ["a", null, T + NOTE_COOLDOWN_MS]);
  assert.equal(actionAllowance(presenceRecord(state.presence, "a"), T + NOTE_COOLDOWN_MS + MIN).note, false);
});

test("a failed chat event never undoes the saved note, and the note does not touch signature or situation", async () => {
  const state = { presence: emptyPresenceDocument(), foundation: { ...defaultFoundation(), characters: [character()] } as FoundationDocument };
  const apply = characterActionApplier({
    presence: { load: async () => state.presence, transact: async (f) => (state.presence = f(state.presence)) },
    foundation: { transact: async (f) => (state.foundation = f(state.foundation)) },
    noteChanged: async () => { throw new Error("chat unavailable"); },
  });
  const warn = console.warn; console.warn = () => {};
  try { await apply("a", { userNote: "Boss" }, T, "m1"); } finally { console.warn = warn; }
  const record = presenceRecord(state.presence, "a")!;
  assert.equal(record.userNote!.text, "Boss");
  assert.equal(record.signature, null);
  assert.equal(record.situationChange, undefined);
});

test("the Character is told its note and may change it only when its own cooldown allows", () => {
  const c = character();
  const base = { characterId: "a", routine: null, lastOnlineAt: null, lastMessageAt: null, situations: [], signature: null };
  const free = selfStateContent(selfState(c, undefined, undefined, T))!;
  assert.match(free, /"userNote": what you now call the user/);
  const noted = { ...base, userNote: { text: "Boss", changedAt: T - MIN, source: "character:x" } };
  const content = selfStateContent(selfState(c, undefined, noted, T))!;
  assert.match(content, /Your own note on the user, what you call them: "Boss"/);
  assert.doesNotMatch(content, /"userNote":/, "recent change: not offered again");
  assert.doesNotMatch(selfStateContent(selfState(c, undefined, noted, T, null, true, false))!, /veil-action/);
});

test("a record without a note stays exactly as stored; with one it round-trips", () => {
  const old = { version: 1, characters: [{ characterId: "a", routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null }] };
  assert.deepEqual(normalizePresenceDocument(old), old);
  const noted = { ...old, characters: [{ ...old.characters[0], userNote: { text: "Boss", changedAt: 5, source: "character:m" } }] };
  assert.deepEqual(normalizePresenceDocument(noted), noted);
});

test("both directions read as one grey sentence", () => {
  assert.equal(characterNoteEventText("Ghost", "Sweetheart"), "Ghost has changed your nickname to “Sweetheart”");
  assert.equal(characterNoteEventText("Ghost", null), "Ghost has removed your nickname");
  assert.equal(userNoteEventText("Ghost", "Soap"), "You changed Ghost's nickname to “Soap”");
  assert.equal(userNoteEventText("Ghost", null), "You removed Ghost's nickname");
});

test("a system event is saved in the conversation without becoming a chat turn", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  assert.equal(await storage.appendSystemEvent("a", "Ghost has changed your nickname to “X”", T), null, "no conversation, no event");
  const session = await storage.openSession("a");
  const user = await storage.send(session.id, "Hello");
  const batch = (await storage.beginReply(session.id))!;
  const [reply] = await storage.finalizeReply(batch.assistant.id, "Hi.");
  const before = (await storage.readSession(session.id)).session;
  const event = (await storage.appendSystemEvent("a", "Ghost has changed your nickname to “X”", T))!;
  const after = await storage.readSession(session.id);
  assert.equal(event.role, "system");
  assert.deepEqual(after.messages.map((m) => m.role), ["user", "assistant", "system"]);
  assert.equal(after.session.lastMessageId, before.lastMessageId, "preview and last message are still the chat turn");
  assert.equal(after.session.updatedAt, before.updatedAt);
  assert.equal(after.session.nextOrder, event.order + 1);
  // Regenerate and Continue judge the last assistant turn; a later event does not take that away.
  assert.equal(canRegenerateTurn(after.messages, reply.id), true);
  const next = (await storage.beginReply(session.id, reply.id))!;
  assert.equal(next.messages.some((m) => m.id === event.id), true, "the event survives a Regenerate");
  void user;
});

test("a system event is never part of the prompt history", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Hello");
  const batch = (await storage.beginReply(session.id))!;
  await storage.finalizeReply(batch.assistant.id, "Hi.");
  await storage.appendSystemEvent("a", "You changed Ghost's nickname to “Soap”", T);
  await storage.send(session.id, "Next");
  const read = await storage.readSession(session.id);
  const document = defaultFoundation(); document.runtime.timeAware = false; document.characters = [character()];
  const pending = read.messages.filter((m) => m.role === "user" && !m.requestedBy);
  const prompt = assembleChatPrompt(document, document.characters[0], read.messages, pending);
  assert.equal(prompt.messages.some((m) => m.content.includes("nickname to")), false);
});

test("while the message menu is open the history no longer traps the lifted message under the blur", () => {
  const css = readFileSync("app/messages/chat.css", "utf8");
  assert.match(css, /\[data-context-menu-open\] > \.chat-history \{ z-index: auto; \}/);
  assert.match(css, /\.chat-turn\[data-active\] \{[^}]*z-index: 65/);
  assert.match(css, /\.chat-context-backdrop \{[^}]*z-index: 40/);
});

test("a Contact save reports a remark change only when that write made one", () => {
  const base = addContact({ version: 1, contacts: [] }, "a", T);
  const named = updateContact(base, "a", { remark: "Soap", heroBackground: null }, T + 1);
  assert.equal(remarkChangeMade(base, named, "a")?.toRemark, "Soap");
  // Another tab already set "Soap"; this save only touches the background and keeps that change as it is.
  const background = updateContact(named, "a", { remark: "Soap", heroBackground: null }, T + 2, { remark: "Soap", heroBackground: null });
  assert.equal(remarkChangeMade(named, background, "a"), null);
});

test("a long note of astral characters survives a reload, and an event as the last message does not become the preview", async () => {
  const note = "😀".repeat(100);
  const doc = { version: 1, characters: [{ characterId: "a", routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null,
    userNote: { text: note, changedAt: 1, source: "character:m" } }] };
  assert.equal(normalizePresenceDocument(doc).characters[0].userNote!.text, note);
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Hello");
  const batch = (await storage.beginReply(session.id))!;
  const [reply] = await storage.finalizeReply(batch.assistant.id, "Hi.");
  await storage.appendSystemEvent("a", "Ghost has changed your nickname to “X”", T);
  const extra = await storage.send(session.id, "More");
  await storage.deleteMessages(session.id, [extra.id]);
  const after = (await storage.readSession(session.id)).session;
  assert.equal(after.lastMessageId, reply.id);
  assert.equal(after.lastMessagePreview, "Hi.");
});
