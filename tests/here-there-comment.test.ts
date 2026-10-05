import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { claimHereThereCommentAttempt, ensureHereThereComment } from "../lib/here-there-comment";
import { bindHereThereCharacter } from "../lib/here-there-binding";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { normalizeDocument, type ThemeDocument } from "../lib/theme-types";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import { ChatStorage } from "../lib/chat/storage";
import type { TextProvider } from "../lib/chat/provider";
import type { WeatherState } from "../lib/participant-config";

function fixture() {
  const foundation = defaultFoundation();
  foundation.characters = ["a", "b"].map((characterId) => ({ characterId,
    ...normalizeCharacterInput({ name: characterId, location: { label: characterId === "a" ? "New York" : "Tokyo" },
      timezone: characterId === "a" ? "America/New_York" : "Asia/Tokyo" }) }));
  foundation.user.name = "User";
  let theme = normalizeDocument(bindHereThereCharacter(normalizeDocument(null), "here-there-default", "a"));
  let queue = Promise.resolve();
  const commit = (update: (document: ThemeDocument) => ThemeDocument) => {
    queue = queue.then(() => { theme = normalizeDocument(update(theme)); });
    return queue;
  };
  const context = { foundation, characterId: "a", now: new Date("2026-10-06T12:00:00Z"),
    hereWeather: { status: "error", message: "unavailable" } as WeatherState,
    thereWeather: { status: "ready", temperatureC: 16, summary: "Cloudy", icon: "", updatedAt: "now" } as WeatherState };
  const services = { foundation: async () => foundation, presets: async () => createPresetDocument(),
    api: async (id: string) => ({ id, apiKey: "test", model: "test", baseUrl: "https://example.test/v1" }),
    provider: async function* () { yield "Wish you were here."; } as TextProvider };
  return { foundation, context, services, commit, theme: () => theme };
}

test("widget generation resolves Global then Character defaults and ignores Messages overrides", async () => {
  const value = fixture();
  const preset = { ...createBuiltinPreset(), id: "character-preset", name: "Character", builtIn: false,
    prompts: createBuiltinPreset().prompts.map((entry) => entry.source === "prompt" && entry.identifier === "base"
      ? { ...entry, content: "CHARACTER_PRESET" } : entry) };
  value.foundation.bindings = { global: { apiConfigId: "global" }, characters: { a: {
    defaults: { apiConfigId: "character", presetId: preset.id },
    apps: { messages: { apiConfigId: "messages-only", presetId: "veil-default" } } } } };
  value.services.presets = async () => ({ ...createPresetDocument(), presets: [createBuiltinPreset(), preset] });
  value.services.provider = async function* (api, prompt) {
    assert.equal(api.id, "character");
    const content = JSON.stringify(prompt);
    assert.match(content, /CHARACTER_PRESET/);
    assert.match(content, /New York/); assert.match(content, /08:00/);
    assert.match(content, /16/); assert.match(content, /Cloudy/); assert.match(content, /unavailable/);
    yield "Wish you were here.";
  };
  await ensureHereThereComment("here-there-default", value.context, value.commit, value.services);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
});

test("persisted claims deduplicate concurrent generation, clock ticks and reloads", async () => {
  const value = fixture(); let calls = 0;
  value.services.provider = async function* () { calls++; yield "Hi."; };
  await Promise.all([1, 2].map(() => ensureHereThereComment("here-there-default", value.context, value.commit, value.services)));
  await ensureHereThereComment("here-there-default", { ...value.context, now: new Date() }, value.commit, value.services);
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(value.theme())));
  await ensureHereThereComment("here-there-default", value.context, async (update) => {
    assert.equal(update(reloaded).current.widgets[0].config.comment?.text, "Hi.");
  }, value.services);
  assert.equal(calls, 1);
});

test("rebind invalidates old comments and late results cannot overwrite a new binding", async () => {
  const value = fixture();
  let release!: () => void; let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  value.services.provider = async function* () { started(); await held; yield "Old A."; };
  const previous = ensureHereThereComment("here-there-default", value.context, value.commit, value.services);
  await ready;
  await value.commit((theme) => bindHereThereCharacter(theme, "here-there-default", "b"));
  assert.equal(value.theme().current.widgets[0].config.comment, undefined);
  await ensureHereThereComment("here-there-default", { ...value.context, characterId: "b" }, value.commit,
    { ...value.services, provider: async function* () { yield "New B."; } });
  release(); await previous;
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "New B.");
});

test("failures remain quiet without a same-mount loop, retry on a fresh mount, then persist success", async () => {
  for (const mode of ["disabled", "missing", "failure", "empty"] as const) {
    const value = fixture(); let calls = 0;
    if (mode === "disabled") value.foundation.bindings.global.apiConfigId = null;
    const services = { ...value.services, api: mode === "missing" ? async () => undefined : value.services.api,
      provider: async function* () { calls++; if (mode === "failure") throw new Error("failed"); yield ""; } };
    const attempts = new Set<string>();
    assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], attempts), true);
    await ensureHereThereComment("here-there-default", value.context, value.commit, services);
    assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], attempts), false);
    assert.equal(value.theme().current.widgets[0].config.comment?.status, "failed");
    assert.equal(value.theme().current.widgets[0].config.comment?.text, undefined);
    assert.equal(calls, mode === "disabled" || mode === "missing" ? 0 : 1);
    const reloaded = normalizeDocument(JSON.parse(JSON.stringify(value.theme())));
    assert.equal(claimHereThereCommentAttempt(reloaded.current.widgets[0], new Set()), true);
    delete value.foundation.bindings.global.apiConfigId;
    await Promise.all([1, 2].map(() => ensureHereThereComment("here-there-default", value.context, value.commit,
      { ...value.services, provider: async function* () { calls++; yield "Recovered."; } })));
    assert.equal(calls, mode === "disabled" || mode === "missing" ? 1 : 2);
    assert.equal(value.theme().current.widgets[0].config.comment?.text, "Recovered.");
    assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], new Set()), false);
    await ensureHereThereComment("here-there-default", value.context, value.commit,
      { ...value.services, provider: async function* () { calls++; yield "Unexpected regeneration."; } });
    assert.equal(calls, mode === "disabled" || mode === "missing" ? 1 : 2);
    assert.equal(value.theme().current.widgets[0].config.comment?.text, "Recovered.");
  }
});

test("non-chat generation leaves sessions, messages and WorldBook activation state untouched", async () => {
  const value = fixture(); const storage = new ChatStorage(() => new IDBFactory());
  await storage.saveApiConfig(await value.services.api("chat-default"));
  const session = await storage.openSession("a"); await storage.send(session.id, "existing");
  const before = await storage.exportBackup(); const world = await storage.readWorldBookState(session.id);
  await ensureHereThereComment("here-there-default", value.context, value.commit,
    { ...value.services, api: (id) => storage.getApiConfig(id) });
  assert.deepEqual(await storage.exportBackup(), before);
  assert.deepEqual(await storage.readWorldBookState(session.id), world);
});

test("orphaned persisted pending comments recover while live requests stay deduplicated", async () => {
  const value = fixture();
  await value.commit((theme) => ({ ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((widget) =>
    ({ ...widget, config: { ...widget.config, comment: { characterId: "a", requestId: "interrupted", status: "pending" as const } } })) } }));
  assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], new Set()), true);
  let release!: () => void; let started!: () => void; let calls = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const services = { ...value.services, provider: async function* () { calls++; started(); await held; yield "Recovered pending."; } };
  const running = ensureHereThereComment("here-there-default", value.context, value.commit, services);
  await ready;
  assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], new Set()), false);
  await ensureHereThereComment("here-there-default", value.context, value.commit, services);
  release(); await running;
  assert.equal(calls, 1);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Recovered pending.");
  assert.equal(claimHereThereCommentAttempt(value.theme().current.widgets[0], new Set()), false);
});

test("safe diagnostics distinguish failure stages without exposing provider errors or credentials", async () => {
  for (const stage of ["api-disabled", "api-missing", "api-validation", "provider-generation", "empty-output", "complete-storage"] as const) {
    const value = fixture(); const diagnostics: string[] = [];
    if (stage === "api-disabled") value.foundation.bindings.global.apiConfigId = null;
    const services = { ...value.services, diagnostic: (stage: string) => { diagnostics.push(stage); },
      api: stage === "api-missing" ? async () => undefined : stage === "api-validation"
        ? async (id: string) => ({ ...await value.services.api(id), apiKey: "", baseUrl: "invalid-secret-url" }) : value.services.api,
      provider: async function* () {
        if (stage === "provider-generation") throw new Error("secret-key provider response body");
        yield stage === "empty-output" ? "" : "Hello.";
      } };
    await ensureHereThereComment("here-there-default", value.context, async (update) => {
      if (stage === "complete-storage" && update(value.theme()).current.widgets[0].config.comment?.status === "complete")
        throw new Error("storage secret");
      await value.commit(update);
    }, services);
    assert.deepEqual(diagnostics, [stage]);
    assert.equal(value.theme().current.widgets[0].config.comment?.status, "failed");
    assert.equal(value.theme().current.widgets[0].config.comment?.text, undefined);
  }
});
