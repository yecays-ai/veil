import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { emptyRegexDocument, type RegexDocument } from "../lib/regex";
import { emptyWorldBookDocument } from "../lib/worldbook";
import type { FoundationDocument } from "../lib/foundation-types";
import type { WeatherState } from "../lib/participant-config";
import { lockOrigin } from "./generation-lock-fixture";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup() {
  const factory = new IDBFactory(), origin = lockOrigin();
  const storage = new ChatStorage(() => factory, () => origin.client());
  const session = await storage.openSession("a");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { storage, session, document };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const noBindings = async () => ({ global: {}, characters: {} });
const books = async () => emptyWorldBookDocument();
const stopped = async (pending: Promise<unknown>, label: string) => {
  let timer!: ReturnType<typeof setTimeout>;
  const outcome = await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label + ": Stop did not settle")), 1000); })]).finally(() => clearTimeout(timer));
  return outcome;
};
/** A real Send path with a regex loader we can hold, so the draft is not saved yet. */
function engineWithHeldRegex(storage: ChatStorage, document: FoundationDocument, regexGate: () => Promise<RegexDocument>, counters: { calls: number; reached: Promise<void> }, reach: () => void) {
  return createChatEngine(storage, async () => document, async function* () { counters.calls++; yield "reply"; },
    undefined, undefined, books, () => { reach(); return regexGate(); }, noBindings);
}
function probe() { const gate = deferred<void>(); return { reached: gate.promise, reach: () => gate.resolve() }; }
const within = (promise: Promise<unknown>, label: string) => { let timer!: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label + ": stage not reached")), 2000); })]).finally(() => clearTimeout(timer)); };

test("A1: Stop before the draft is saved leaves no user turn and no empty stopped bubble", async () => {
  const { storage, session, document } = await setup();
  const gate = deferred<RegexDocument>(), p = probe(), counters = { calls: 0, reached: p.reached }; let sent = 0;
  const engine = engineWithHeldRegex(storage, document, () => gate.promise, counters, p.reach);
  const pending = engine.requestReply(session.id, undefined, "manual-reply", { content: "Draft", onSent: () => { sent++; } });
  await within(p.reached, "A1"); engine.stop(session.id);
  assert.equal(await stopped(pending, "A1"), null);
  gate.resolve(emptyRegexDocument()); await settle(); await settle();
  const after = await storage.readSession(session.id);
  assert.deepEqual(after.messages, [], "nothing was saved: no user message and no orphan assistant bubble");
  assert.equal(after.session.generation, undefined);
  assert.equal(counters.calls, 0, "no model request, not even after the held read resolves");
  assert.equal(sent, 0);
  assert.equal(engine.isGenerating(session.id), false);
  // A fresh Send after the Stop is unaffected by the old attempt.
  const fresh = createChatEngine(storage, async () => document, async function* () { counters.calls++; yield "fresh reply"; },
    undefined, undefined, books, async () => emptyRegexDocument(), noBindings);
  const done = await fresh.requestReply(session.id, undefined, "manual-reply", { content: "Second draft" });
  assert.equal(done?.content, "fresh reply");
  const final = await storage.readSession(session.id);
  assert.deepEqual(final.messages.map((m) => [m.role, m.content, m.status]), [["user", "Second draft", "sent"], ["assistant", "fresh reply", "complete"]]);
});

test("CF-02: a genuine pre-save failure leaves no contextless failed bubble or claimed input", async () => {
  const { storage, session, document } = await setup();
  const p = probe(), counters = { calls: 0, reached: p.reached };
  const engine = engineWithHeldRegex(storage, document, () => Promise.reject(new Error("regex store unavailable")), counters, p.reach);
  await storage.send(session.id, "Earlier question");
  await assert.rejects(engine.requestReply(session.id, undefined, "manual-reply", { content: "Draft" }), /regex store unavailable/);
  assert.equal(counters.calls, 0);
  assert.equal((await storage.readSession(session.id)).session.generation, undefined);
  const messages = (await storage.readSession(session.id)).messages;
  assert.equal(messages.length, 1); assert.equal(messages[0].requestedBy, undefined);
});

test("A1: Stop with an earlier unanswered user message still records the stopped attempt", async () => {
  const { storage, session, document } = await setup();
  await storage.send(session.id, "Earlier question");
  const gate = deferred<RegexDocument>(), p = probe(), counters = { calls: 0, reached: p.reached };
  const engine = engineWithHeldRegex(storage, document, () => gate.promise, counters, p.reach);
  const pending = engine.requestReply(session.id, undefined, "manual-reply", { content: "Draft" });
  await within(p.reached, "unanswered"); engine.stop(session.id);
  const result = await stopped(pending, "A1 pending turn") as { outcome?: string } | null;
  gate.resolve(emptyRegexDocument()); await settle();
  assert.equal(result?.outcome, "stopped", "there is a user turn to retry, so the existing behaviour is kept");
  assert.equal(counters.calls, 0);
});

test("A2: Stop before the attempt is claimed resolves quietly instead of surfacing an AbortError", async () => {
  const { storage, session, document } = await setup();
  const gate = deferred<FoundationDocument>(); let calls = 0;
  const engine = createChatEngine(storage, () => gate.promise, async function* () { calls++; yield "late"; });
  const pending = engine.requestReply(session.id);
  await settle(); assert.equal(engine.isGenerating(session.id), true); engine.stop(session.id);
  assert.equal(await stopped(pending, "A2"), null, "no rejection and no error text for the UI");
  gate.resolve(document); await settle(); await settle();
  assert.equal(calls, 0);
  assert.deepEqual((await storage.readSession(session.id)).messages, []);
  assert.equal(engine.isGenerating(session.id), false);
});

test("A2: a real failure before the claim is still reported", async () => {
  const { storage, session } = await setup();
  const engine = createChatEngine(storage, async () => { throw new Error("Foundation unreadable"); }, async function* () { yield "x"; });
  await assert.rejects(engine.requestReply(session.id), /Foundation unreadable/);
});

test("Stop while Weather is pending, then a late Weather result, then an immediate new Reply", async () => {
  const { storage, session, document } = await setup();
  document.runtime.timeAware = true;
  document.user.location = { label: "Home", coordinates: { latitude: 1, longitude: 2 } };
  await storage.send(session.id, "Question");
  const weather = deferred<WeatherState>(), weatherReached = deferred(); let providerCalls = 0, weatherCalls = 0;
  const provider = async function* () { providerCalls++; yield "new reply"; };
  const engine = createChatEngine(storage, async () => document, provider, undefined, undefined, books, async () => emptyRegexDocument(), noBindings,
    () => { weatherCalls++; weatherReached.resolve(); return weatherCalls === 1 ? weather.promise : Promise.resolve({ status: "not-configured" } as WeatherState); });
  const pending = engine.requestReply(session.id);
  await within(weatherReached.promise, "weather"); assert.equal(weatherCalls, 1);
  engine.stop(session.id);
  const first = await stopped(pending, "weather") as { outcome?: string; id?: string } | null;
  assert.equal(first?.outcome, "stopped");
  assert.equal(engine.isGenerating(session.id), false);
  const replacement = await engine.regenerateMessage(first!.id!, undefined, session.id);
  weather.resolve({ status: "ready", temperatureC: 9, summary: "Rain", icon: "", updatedAt: "now" } as WeatherState);
  await settle(); await settle();
  assert.equal(replacement?.content, "new reply");
  assert.equal(providerCalls, 1, "the late Weather result never started the cancelled request");
  const final = await storage.readSession(session.id);
  assert.deepEqual(final.messages.filter((m) => m.role === "assistant").map((m) => [m.content, m.status]), [["new reply", "complete"]]);
  assert.equal(final.session.generation, undefined);
});

test("Stop while the location context is pending, with the engine stopped again right after", async () => {
  const { storage, session, document } = await setup();
  document.runtime.timeAware = true;
  document.characters[0].location = { label: "Far", coordinates: { latitude: 3, longitude: 4 } };
  await storage.send(session.id, "Question");
  const gate = deferred<WeatherState>(), reached = deferred(); let providerCalls = 0;
  const engine = createChatEngine(storage, async () => document, async function* () { providerCalls++; yield "x"; }, undefined, undefined,
    books, async () => emptyRegexDocument(), noBindings, () => { reached.resolve(); return gate.promise; });
  const pending = engine.requestReply(session.id);
  await within(reached.promise, "location"); engine.stop(session.id); engine.stop(session.id);
  const result = await stopped(pending, "location") as { outcome?: string; content?: string } | null;
  assert.equal(result?.outcome, "stopped");
  gate.resolve({ status: "error", message: "late" } as WeatherState); await settle(); await settle();
  assert.equal(providerCalls, 0);
  const after = await storage.readSession(session.id);
  assert.ok(after.messages.every((m) => !/late|Weather/i.test(m.error ?? "")), "the late result writes no error message");
  assert.equal(after.session.generation, undefined);
});

test("Lifecycle cleanup adjacent to Stop: unmount-style stop() then a late preparation result changes nothing", async () => {
  const { storage, session, document } = await setup();
  await storage.send(session.id, "Question");
  const gate = deferred<RegexDocument>(), reached = deferred(); let calls = 0;
  const engine = createChatEngine(storage, async () => document, async function* () { calls++; yield "x"; },
    undefined, undefined, books, () => { reached.resolve(); return gate.promise; }, noBindings);
  const pending = engine.requestReply(session.id);
  await within(reached.promise, "lifecycle");
  engine.stop(session.id); // what leaving the room does (no persist flag), immediately followed by a user Stop
  engine.stop(session.id, { persist: true });
  await stopped(pending, "unmount");
  gate.resolve(emptyRegexDocument()); await settle(); await settle();
  assert.equal(calls, 0);
  const after = await storage.readSession(session.id);
  assert.equal(after.session.generation, undefined);
  assert.equal(after.messages.filter((m) => m.role === "assistant").length, 1, "exactly one terminal record, not a duplicate");
});
