import assert from "node:assert/strict";
import test from "node:test";
import { ensureHereThereComment, HereThereGenerationOwner } from "../lib/here-there-comment";
import { bindHereThereCharacter } from "../lib/here-there-binding";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { normalizeDocument, type ThemeDocument } from "../lib/theme-types";
import { createPresetDocument } from "../lib/preset";
import type { TextProvider } from "../lib/chat/provider";
import type { WeatherState } from "../lib/participant-config";
import { startHereThereDisposition } from "../lib/here-there-diagnostics";

const SECRET = "provider-secret-remark";
type Log = { label: string; data: Record<string, unknown> };

function fixture() {
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A", location: { label: "New York" },
    timezone: "America/New_York", personality: "dry wit", speakingStyle: "brief" }) }];
  let theme = normalizeDocument(bindHereThereCharacter(normalizeDocument(null), "here-there-default", "a"));
  let queue = Promise.resolve();
  const commit = (update: (document: ThemeDocument) => ThemeDocument) => {
    queue = queue.then(() => { theme = normalizeDocument(update(theme)); });
    return queue;
  };
  const context = { foundation, characterId: "a", now: new Date("2026-10-06T12:00:00Z"),
    hereWeather: { status: "error", message: "unavailable" } as WeatherState,
    thereWeather: { status: "ready", temperatureC: 16, summary: "Cloudy", icon: "", updatedAt: "now" } as WeatherState };
  const services = { bindings: async () => ({ global: {}, characters: {} }), foundation: async () => foundation,
    presets: async () => createPresetDocument(),
    api: async (id: string) => ({ id, apiKey: "test", model: "test", baseUrl: "https://example.test/v1" }),
    settings: async () => ({ hereThereEnabled: true }), claimOpportunity: async () => context.now.getTime() + 1_000,
    scheduleRetry: async () => true,
    provider: async function* () { yield "Wish you were here."; } as TextProvider };
  return { foundation, context, services, commit, theme: () => theme };
}
async function run(value: ReturnType<typeof fixture>, commit = value.commit, env = "development") {
  const originalInfo = console.info, originalEnv = process.env.NODE_ENV;
  const logs: Log[] = [];
  Object.assign(process.env, { NODE_ENV: env });
  console.info = ((label: string, data: Record<string, unknown>) => { logs.push({ label, data }); }) as typeof console.info;
  try {
    await ensureHereThereComment(value.theme().current.widgets[0], value.context, commit, value.services);
  } finally {
    console.info = originalInfo;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
  return { logs, events: logs.filter((l) => l.label === "[VEIL here-there:disposed]").map((l) => l.data) };
}
const one = (events: Record<string, unknown>[]) => {
  assert.equal(events.length, 1, "exactly one disposition per requested remark");
  assert.deepEqual(Object.keys(events[0]).sort(), ["durationMs", "outcome", "requestId", "source", "stage"]);
  assert.equal(events[0].source, "here-there-comment");
  return events[0];
};

test("an adopted remark records one disposition with the model call's requestId, after completion:terminal", async () => {
  const value = fixture();
  const { logs, events } = await run(value);
  const event = one(events);
  assert.equal(event.outcome, "adopted");
  assert.equal(event.stage, "commit");
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
  const start = logs.find((l) => l.label === "[VEIL prompt:summary]")!.data;
  assert.equal(event.requestId, start.requestId);
  assert.equal(logs[logs.length - 1].label, "[VEIL here-there:disposed]");
});

test("a commit that succeeds but finds no target is discarded, not adopted", async () => {
  const value = fixture();
  const noTarget = async (update: (document: ThemeDocument) => ThemeDocument) => {
    const before = value.theme();
    const emptied = { ...before, current: { ...before.current, widgets: [] } };
    update(emptied); // the widget was deleted while the remark was being written
  };
  const { events } = await run(value, noTarget);
  assert.equal(one(events).outcome, "stale-discarded");
});

test("a commit that throws, an empty remark and a provider failure are told apart", async () => {
  const commitFailed = fixture();
  const failed = await run(commitFailed, async () => { throw new Error("storage full"); });
  assert.equal(one(failed.events).outcome, "commit-failed");
  assert.equal(one(failed.events).stage, "commit");
  const empty = fixture();
  empty.services.provider = async function* () { yield "   "; };
  const emptied = await run(empty);
  assert.equal(one(emptied.events).outcome, "empty");
  assert.equal(one(emptied.events).stage, "model");
  const broken = fixture();
  broken.services.provider = async function* () { throw new Error(SECRET); };
  const errored = await run(broken);
  assert.equal(one(errored.events).outcome, "error");
  assert.equal(JSON.stringify(errored.events).includes(SECRET), false);
});

test("cancellation and a stale owner are recorded before empty or error, and nothing is committed", async () => {
  const cancelled = fixture();
  const controller = new AbortController();
  cancelled.services.provider = async function* (_c, _m, signal) {
    controller.abort(); await Promise.resolve(); signal.throwIfAborted(); yield "never";
  };
  cancelled.context = { ...cancelled.context, signal: controller.signal } as typeof cancelled.context;
  const first = await run(cancelled);
  assert.equal(one(first.events).outcome, "cancelled");
  assert.equal(cancelled.theme().current.widgets[0].config.comment, undefined);
  const owner = new HereThereGenerationOwner();
  const stale = fixture();
  const isCurrent = owner.begin();
  stale.context = { ...stale.context, isCurrent } as typeof stale.context;
  stale.services.provider = async function* () { owner.invalidate(); yield "late remark"; };
  const second = await run(stale);
  assert.ok(["cancelled", "stale-discarded"].includes(String(one(second.events).outcome)));
  assert.equal(stale.theme().current.widgets[0].config.comment, undefined);
  const staleEmpty = fixture();
  const owner2 = new HereThereGenerationOwner();
  staleEmpty.context = { ...staleEmpty.context, isCurrent: owner2.begin() } as typeof staleEmpty.context;
  staleEmpty.services.provider = async function* () { owner2.invalidate(); yield ""; };
  assert.notEqual(one((await run(staleEmpty)).events).outcome, "empty");
});

test("an abort that arrives while the commit is already queued does not rewrite the adoption", async () => {
  const value = fixture();
  const controller = new AbortController();
  value.context = { ...value.context, signal: controller.signal } as typeof value.context;
  const slow = (update: (document: ThemeDocument) => ThemeDocument) => {
    const done = value.commit(update);
    controller.abort(); // the owner ends after the commit was queued: the write still lands (known, not fixed here)
    return done;
  };
  const { events } = await run(value, slow);
  assert.equal(one(events).outcome, "adopted");
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
});

test("paths that never call the model record nothing", async () => {
  const off = fixture();
  off.services.settings = async () => ({ hereThereEnabled: false });
  assert.equal((await run(off)).events.length, 0);
  const noClaim = fixture();
  noClaim.services.claimOpportunity = (async () => null) as unknown as typeof noClaim.services.claimOpportunity;
  assert.equal((await run(noClaim)).events.length, 0);
  const wrongCharacter = fixture();
  wrongCharacter.context = { ...wrongCharacter.context, characterId: "b" };
  assert.equal((await run(wrongCharacter)).events.length, 0);
});

test("dispositions are development-only, carry no remark text or ids, never break the widget, and are recorded once", async () => {
  const production = await run(fixture(), undefined, "production");
  assert.equal(production.logs.length, 0);
  const value = fixture();
  const loud = await run(value);
  const text = JSON.stringify(loud.events);
  for (const secret of ["Wish you were here", "New York", "dry wit", "test", "example.test"]) assert.equal(text.includes(secret), false, secret);
  const broken = fixture();
  const originalInfo = console.info, originalEnv = process.env.NODE_ENV;
  let called = false;
  Object.assign(process.env, { NODE_ENV: "development" });
  console.info = (() => { called = true; throw new Error("logging is broken"); }) as typeof console.info;
  try {
    await ensureHereThereComment(broken.theme().current.widgets[0], broken.context, broken.commit, broken.services);
  } finally {
    console.info = originalInfo;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
  assert.equal(called, true, "the logging path was actually exercised");
  assert.equal(broken.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
  const logs: unknown[] = [];
  const info = console.info, env = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "development" });
  console.info = ((_l: string, data: unknown) => { logs.push(data); }) as typeof console.info;
  try {
    const finish = startHereThereDisposition("once");
    finish("adopted", "commit");
    finish("cancelled", "commit");
  } finally { console.info = info; if (env === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: env }); }
  assert.equal(logs.length, 1);
});
