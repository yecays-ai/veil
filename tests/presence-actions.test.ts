import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { selfState, selfStateContent } from "../lib/chat/self-context";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput, type FoundationDocument } from "../lib/foundation-types";
import {
  actionAllowance, characterActionApplier, cleanSignature, splitActions,
  SIGNATURE_COOLDOWN_MS, SITUATION_COOLDOWN_MS, type CharacterActions,
} from "../lib/presence/actions";
import { emptyPresenceDocument, presenceRecord, type PresenceDocument } from "../lib/presence/storage";
import { effectivePresence } from "../lib/presence/compute";
import type { TextProvider } from "../lib/chat/provider";

const NOW = new Date("2026-10-11T03:00:00Z"), T = NOW.getTime(), MIN = 60_000;
const tag = (json: string) => `<veil-action>${json}</veil-action>`;

test("the action tag is removed from what the user sees, whole or half-streamed, and its JSON is read", () => {
  const whole = splitActions(`Sure, I'll hop on the call.\n${tag('{"signature":"on a call","situation":{"status":"busy","durationMinutes":30}}')}`);
  assert.equal(whole.text, "Sure, I'll hop on the call.");
  assert.deepEqual(whole.actions, { signature: "on a call", situation: { status: "busy", durationMinutes: 30 } });
  for (const partial of ["Sure.\n<", "Sure.\n<veil-act", "Sure.\n<veil-action>", `Sure.\n<veil-action>{"signa`, "Sure.\n</veil-action"])
    assert.equal(splitActions(partial).text, partial.startsWith("Sure.\n</") ? partial : "Sure.", partial);
  assert.equal(splitActions("a < b and <b>bold</b>").text, "a < b and <b>bold</b>", "ordinary text is untouched");
  assert.equal(splitActions("  keep spacing  \n").text, "  keep spacing  \n");
  const broken = splitActions(`Hi ${tag("{nope")}`);
  assert.deepEqual(broken, { text: "Hi", actions: null }, "bad JSON is dropped, never shown");
  assert.equal(splitActions(`Hi ${tag('{"x":1}')}`).actions, null);
});

test("a signature is cleaned: control and invisible characters out, spaces collapsed, 200 characters at most", () => {
  assert.equal(cleanSignature("  a\u0000b‮c \n\t d  "), "a b c d");
  assert.equal(cleanSignature(" ​ "), null);
  assert.equal(Array.from(cleanSignature("好".repeat(500))!).length, 200);
});

const character = () => ({ characterId: "a", ...normalizeCharacterInput({ name: "A", statusMessage: "old" }) });
function stores(presence = emptyPresenceDocument(), foundation?: FoundationDocument) {
  const state = { presence, foundation: foundation ?? { ...defaultFoundation(), characters: [character()] } };
  const deps = {
    presence: { load: async () => state.presence, transact: async (f: (d: PresenceDocument) => PresenceDocument) => (state.presence = f(state.presence)) },
    foundation: { transact: async (f: (d: FoundationDocument) => FoundationDocument) => (state.foundation = f(state.foundation)) },
  };
  return { state, apply: characterActionApplier(deps) };
}
const active = (document: PresenceDocument, at: number) => {
  const record = presenceRecord(document, "a");
  return effectivePresence({ characterId: "a", timezone: null, routine: null, situations: record?.situations ?? [] }, at);
};

test("a situation action starts now at the earliest, defaults and caps its length, and never writes the past", async () => {
  const { state, apply } = stores();
  await apply("a", { situation: { status: "busy", reason: "dentist", startInMinutes: -600, durationMinutes: 45 } }, T, "m1");
  const [stored] = presenceRecord(state.presence, "a")!.situations;
  assert.deepEqual([stored.status, stored.reason, stored.startsAt, stored.endsAt, stored.source], ["busy", "dentist", T, T + 45 * MIN, "character:m1"]);
  assert.equal(active(state.presence, T + MIN).status, "busy");
  const vague = stores(); await vague.apply("a", { situation: { status: "away" } }, T, "m2");
  assert.equal(presenceRecord(vague.state.presence, "a")!.situations[0].endsAt, T + 6 * 60 * MIN, "conservative default length");
  const huge = stores(); await huge.apply("a", { situation: { status: "away", durationMinutes: 1e9 } }, T, "m3");
  assert.equal(presenceRecord(huge.state.presence, "a")!.situations[0].endsAt, T + 14 * 24 * 60 * MIN, "capped");
  const bad = stores(); await bad.apply("a", { situation: { status: "sleeping" } }, T, "m4");
  assert.equal(presenceRecord(bad.state.presence, "a"), undefined, "an unknown status changes nothing");
});

test("a Character can plan one future situation, replace it, cancel it, and end what is running", async () => {
  const { state, apply } = stores();
  await apply("a", { situation: { status: "offline", startInMinutes: 120, durationMinutes: 60 } }, T, "m1");
  assert.equal(presenceRecord(state.presence, "a")!.situations[0].startsAt, T + 120 * MIN);
  await apply("a", { situation: { status: "away", startInMinutes: 240 } }, T + SITUATION_COOLDOWN_MS, "m2");
  assert.equal(presenceRecord(state.presence, "a")!.situations.length, 1, "a new future situation replaces the old one");
  await apply("a", { cancelUpcoming: true }, T + 2 * SITUATION_COOLDOWN_MS, "m3");
  assert.equal(presenceRecord(state.presence, "a")!.situations.length, 0);
  await apply("a", { situation: { status: "busy", durationMinutes: 300 } }, T + 3 * SITUATION_COOLDOWN_MS, "m4");
  await apply("a", { endSituation: "all" }, T + 4 * SITUATION_COOLDOWN_MS, "m5");
  assert.notEqual(active(state.presence, T + 4 * SITUATION_COOLDOWN_MS + MIN).status, "busy");
});

test("the cooldown is the Character's own and is judged from its last change, not a count", async () => {
  const { state, apply } = stores();
  await apply("a", { situation: { status: "busy", durationMinutes: 600 } }, T, "m1");
  await apply("a", { situation: { status: "away", durationMinutes: 600 } }, T + SITUATION_COOLDOWN_MS - 1, "m2");
  assert.deepEqual(presenceRecord(state.presence, "a")!.situations.map((s) => s.status), ["busy"], "too soon: ignored");
  await apply("a", { situation: { status: "away", durationMinutes: 600 } }, T + SITUATION_COOLDOWN_MS, "m3");
  assert.equal(presenceRecord(state.presence, "a")!.situations.at(-1)!.status, "away");
  assert.deepEqual(actionAllowance(undefined, T), { situation: true, signature: true });
  const userMade = { characterId: "a", routine: null, signature: null, lastOnlineAt: null, lastMessageAt: null, situations: [],
    situationChange: { changedAt: T, source: null } };
  assert.equal(actionAllowance(userMade, T).situation, true, "only the Character's own changes start its cooldown");
});

test("ending or cancelling a situation also starts the cooldown, but doing nothing does not", async () => {
  const planned = stores();
  await planned.apply("a", { situation: { status: "away", startInMinutes: 120 } }, T, "m1");
  await planned.apply("a", { cancelUpcoming: true }, T + SITUATION_COOLDOWN_MS, "m2");
  await planned.apply("a", { situation: { status: "busy" } }, T + SITUATION_COOLDOWN_MS + 1, "m3");
  assert.equal(presenceRecord(planned.state.presence, "a")!.situations.length, 0, "cancelling started a cooldown");
  const running = stores();
  await running.apply("a", { situation: { status: "busy", durationMinutes: 600 } }, T, "m1");
  await running.apply("a", { endSituation: "all" }, T + SITUATION_COOLDOWN_MS, "m2");
  await running.apply("a", { situation: { status: "away" } }, T + SITUATION_COOLDOWN_MS + 1, "m3");
  assert.equal(presenceRecord(running.state.presence, "a")!.situations.some((s) => s.status === "away"), false, "ending started a cooldown");
  const idle = stores();
  await idle.apply("a", { cancelUpcoming: true, endSituation: "all" }, T, "m1");
  await idle.apply("a", { situation: { status: "away" } }, T + 1, "m2");
  assert.equal(presenceRecord(idle.state.presence, "a")!.situations.length, 1, "a no-op change costs nothing");
});

test("a tag quoted in the middle of a reply is hidden but never applied; only the closing line acts", () => {
  const quoted = splitActions(`You could write ${tag('{"signature":"busy"}')} to change it, I'll skip that.`);
  assert.equal(quoted.actions, null);
  assert.equal(quoted.text, "You could write  to change it, I'll skip that.");
  const both = splitActions(`Example ${tag('{"signature":"a"}')} done.\n${tag('{"signature":"b"}')}\n`);
  assert.deepEqual(both.actions, { signature: "b" });
  assert.doesNotMatch(both.text, /veil-action/);
});

test("a signature action reaches Foundation, marks the change, honours its cooldown, and skips no-ops", async () => {
  const { state, apply } = stores();
  const sig = (signature: string | null): CharacterActions => ({ signature });
  await apply("a", sig("same"), T, "m1");
  assert.equal(state.foundation.characters[0].statusMessage, "same");
  assert.deepEqual(presenceRecord(state.presence, "a")!.signature, { changedAt: T, source: "character:m1" });
  await apply("a", sig("again"), T + SIGNATURE_COOLDOWN_MS - 1, "m2");
  assert.equal(state.foundation.characters[0].statusMessage, "same", "cooldown: nothing written");
  await apply("a", sig("same"), T + SIGNATURE_COOLDOWN_MS, "m3");
  assert.equal(presenceRecord(state.presence, "a")!.signature!.source, "character:m1", "an unchanged signature starts no cooldown");
  await apply("a", sig(null), T + SIGNATURE_COOLDOWN_MS, "m4");
  assert.equal(state.foundation.characters[0].statusMessage, null, "an empty signature clears it");
  const gone = stores(); await gone.apply("zzz", sig("x"), T, "m5");
  assert.equal(gone.state.foundation.characters[0].statusMessage, "old", "another Character is untouched");
});

test("the Character is told how to change itself only for what it may change now", () => {
  const c = character();
  const text = (record: Parameters<typeof selfState>[2], allow = true) => selfStateContent(selfState(c, undefined, record, T, null, true, allow)) ?? "";
  assert.match(text(undefined), /end the reply with one line <veil-action>/);
  assert.match(text(undefined), /"signature"[\s\S]*"situation"/);
  assert.match(text(undefined), /never for something you merely recall or tell about/);
  const recent = { characterId: "a", routine: null, lastOnlineAt: null, lastMessageAt: null, situations: [],
    signature: { changedAt: T - MIN, source: "character:x" } };
  assert.doesNotMatch(text(recent), /"signature":/);
  assert.match(text(recent), /"situation":/);
  assert.doesNotMatch(text(undefined, false), /veil-action/, "Continue is never offered a change");
});

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "Question");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [character()];
  return { storage, session, document };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

test("the engine stores the reply without the tag, applies the action once after commit, and one request is sent", async () => {
  const app = await setup(), applied: unknown[] = []; let calls = 0;
  const provider: TextProvider = async function* () {
    calls++; yield "On my way.\n<veil-act"; yield `ion>{"signature":"driving"}</veil-action>`;
  };
  const engine = createChatEngine(app.storage, async () => app.document, provider, undefined, () => NOW, undefined, undefined, undefined,
    undefined, undefined, async () => {}, undefined, async (...args) => { applied.push(args); });
  const reply = await engine.requestReply(app.session.id);
  await wait();
  assert.equal(reply!.content, "On my way.");
  assert.equal(calls, 1);
  const stored = (await app.storage.readSession(app.session.id)).messages.filter((m) => m.role === "assistant");
  assert.deepEqual(stored.map((m) => m.content), ["On my way."]);
  assert.deepEqual(applied, [["a", { signature: "driving" }, T, reply!.id]]);
});

test("a failing apply cannot undo the reply, and Continue never applies a change", async () => {
  const app = await setup(), applied: unknown[] = [];
  let calls = 0;
  const provider: TextProvider = async function* (_config, _messages, _signal, _generation, _request, finished) {
    if (++calls === 1) { finished?.("length"); yield `Okay. ${tag('{"signature":"x"}')}`; } else yield ` More. ${tag('{"signature":"y"}')}`;
  };
  const engine = createChatEngine(app.storage, async () => app.document, provider, undefined, () => NOW, undefined, undefined, undefined,
    undefined, undefined, async () => {}, undefined, async (...args) => { applied.push(args); throw new Error("store down"); });
  const reply = await engine.requestReply(app.session.id);
  await wait();
  assert.equal(reply!.status, "complete");
  assert.equal(applied.length, 1);
  await engine.continueMessage(reply!.id);
  await wait();
  assert.equal(applied.length, 1, "Continue ignores action tags");
  assert.doesNotMatch((await app.storage.readSession(app.session.id)).messages.map((m) => m.content).join("\n"), /veil-action/);
});

test("a Character's profile subtitle is its signature, empty shows none, occupation stays in the details; the user keeps occupation", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { ProfileView } = await import("../components/profile-view");
  const html = (kind: "character" | "user", extra: Record<string, unknown>) => renderToString(createElement(ProfileView,
    { kind, profile: { ...normalizeCharacterInput({ name: "A", occupation: "Baker", ...extra }), presence: "online" } as never, children: null }));
  const signed = html("character", { statusMessage: "up early" });
  assert.match(signed, /<p class="subtle">up early<\/p>/);
  assert.match(signed, /Baker/, "occupation is still shown among the details");
  assert.doesNotMatch(signed, /<p class="subtle">Baker/);
  assert.doesNotMatch(html("character", { statusMessage: null }), /<p class="subtle">/);
  assert.match(html("user", { statusMessage: "ignored" }), /<p class="subtle">Baker<\/p>/);
});

test("Contact Info shows the signature under the status line, and nothing when empty, never the occupation", async () => {
  const Module = (await import("node:module")).default;
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { normalizeFoundation } = await import("../lib/foundation-types");
  const { addContact, normalizeContacts } = await import("../lib/contact-storage");
  const state = { statusMessage: "up early" as string | null };
  const foundation = () => normalizeFoundation({ characters: [{ characterId: "a", name: "Ghost", occupation: "TF141 Operative", statusMessage: state.statusMessage }] });
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/foundation-provider")) return { useFoundation: () => ({ document: foundation(), ready: true }) };
    if (request.endsWith("/use-contacts")) return { useContacts: () => ({ document: addContact(normalizeContacts(null), "a"), ready: true, error: "" }) };
    if (request.endsWith("/use-character-presence")) return { useCharacterPresence: () => ({ ready: true, status: "offline", text: "Offline" }) };
    if (request === "next/navigation") return { useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }) };
    return original.call(this, request, ...rest);
  };
  try {
    const { ContactInfo } = await import("../components/contact-info");
    const identity = (html: string) => html.slice(html.indexOf('contact-hero-identity'));
    const signed = identity(renderToString(createElement(ContactInfo, { characterId: "a" })));
    const presenceAt = signed.indexOf("contact-presence"), statusAt = signed.indexOf('class="contact-status"');
    assert.ok(presenceAt >= 0 && statusAt >= 0, "both the status line and the signature are rendered");
    assert.ok(presenceAt < statusAt, "signature comes after the status line");
    assert.match(signed, /class="contact-status">up early</);
    assert.doesNotMatch(signed, /TF141/);
    state.statusMessage = null;
    const empty = renderToString(createElement(ContactInfo, { characterId: "a" }));
    assert.doesNotMatch(empty, /contact-status|TF141/, "no signature, no row, no occupation fallback");
  } finally { loader._load = original; }
});

test("a record without a situation change mark stays exactly as stored, so older data and backup packages still validate", async () => {
  const { normalizePresenceDocument } = await import("../lib/presence/storage");
  const old = { version: 1, characters: [{ characterId: "a", routine: null, situations: [], signature: null, lastOnlineAt: null, lastMessageAt: null }] };
  assert.deepEqual(normalizePresenceDocument(old), old);
  const marked = { ...old, characters: [{ ...old.characters[0], situationChange: { changedAt: 5, source: "character:m" } }] };
  assert.deepEqual(normalizePresenceDocument(marked), marked);
});
