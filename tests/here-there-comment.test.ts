import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { HERE_THERE_COMMENT_REFRESH_MS, hereThereCommentNeedsRefresh, ensureHereThereComment } from "../lib/here-there-comment";
import { bindHereThereCharacter } from "../lib/here-there-binding";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { normalizeDocument, type ThemeDocument } from "../lib/theme-types";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import { ChatStorage } from "../lib/chat/storage";
import { ApiConfigStorage } from "../lib/api-config-storage";
import type { TextProvider } from "../lib/chat/provider";
import type { WeatherState } from "../lib/participant-config";
import { WIDGET_REGISTRY } from "../lib/widget-registry";

function fixture() {
  const foundation = defaultFoundation();
  let bindings: import("../lib/bindings").BindingDocument = { global: {}, characters: {} };
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
  const services = { bindings: async () => bindings, foundation: async () => foundation, presets: async () => createPresetDocument(),
    api: async (id: string) => ({ id, apiKey: "test", model: "test", baseUrl: "https://example.test/v1" }),
    provider: async function* () { yield "Wish you were here."; } as TextProvider };
  return { get bindings() { return bindings; }, set bindings(value) { bindings = value; }, foundation, context, services, commit, theme: () => theme };
}

test("widget generation resolves Global then Character defaults and ignores Messages overrides", async () => {
  const value = fixture();
  const preset = { ...createBuiltinPreset(), id: "character-preset", name: "Character", builtIn: false,
    prompts: createBuiltinPreset().prompts.map((entry) => entry.source === "prompt" && entry.identifier === "base"
      ? { ...entry, content: "CHARACTER_PRESET" } : entry) };
  value.bindings = { global: { apiConfigId: "global" }, characters: { a: {
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
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
});

test("successful comments persist across reloads and refresh only after three hours", async () => {
  const value = fixture(); let calls = 0;
  value.services.provider = async function* () { calls++; yield `Remark ${calls}.`; };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  const saved = value.theme().current.widgets[0].config.comment;
  assert.deepEqual(saved, { characterId: "a", text: "Remark 1.", generatedAt: value.context.now.toISOString() });
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(value.theme()))).current.widgets[0];
  const before = { ...value.context, now: new Date(value.context.now.getTime() + HERE_THERE_COMMENT_REFRESH_MS - 1) };
  assert.equal(hereThereCommentNeedsRefresh(reloaded, before.now), false);
  await ensureHereThereComment(reloaded, before, value.commit, value.services);
  assert.equal(calls, 1);
  const expired = { ...value.context, now: new Date(value.context.now.getTime() + HERE_THERE_COMMENT_REFRESH_MS) };
  await ensureHereThereComment(reloaded, expired, value.commit, value.services);
  assert.equal(calls, 2);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Remark 2.");
});

test("failed initial generation and refresh write nothing and later eligible calls can succeed", async () => {
  for (const existing of [false, true]) {
    const value = fixture();
    if (existing) await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
    const before = JSON.stringify(value.theme());
    const context = { ...value.context, now: new Date(value.context.now.getTime() + HERE_THERE_COMMENT_REFRESH_MS) };
    for (const mode of ["failure", "empty", "missing", "disabled"] as const) {
      if (mode === "disabled") value.bindings.global.apiConfigId = null;
      await ensureHereThereComment(value.theme().current.widgets[0], context, value.commit, {
        ...value.services, api: mode === "missing" ? async () => undefined : value.services.api,
        provider: async function* () { if (mode === "failure") throw new Error("failed"); yield ""; },
      });
      assert.equal(JSON.stringify(value.theme()), before);
      delete value.bindings.global.apiConfigId;
    }
    await ensureHereThereComment(value.theme().current.widgets[0], context, value.commit,
      { ...value.services, provider: async function* () { yield "Recovered."; } });
    assert.equal(value.theme().current.widgets[0].config.comment?.text, "Recovered.");
  }
});

test("legacy attempt data and mismatched comments are discarded and cannot block generation", async () => {
  for (const comment of [
    { characterId: "a", status: "pending", requestId: "old" },
    { characterId: "a", status: "failed", requestId: "old" },
    { characterId: "b", text: "Other Character.", generatedAt: "2026-10-06T12:00:00Z" },
  ]) {
    const value = fixture();
    const config = WIDGET_REGISTRY["here-there"].normalizeConfig({ ...value.theme().current.widgets[0].config, comment });
    assert.equal(config.comment, undefined);
    await value.commit((theme) => ({ ...theme, current: { ...theme.current, widgets: theme.current.widgets.map((widget) => ({ ...widget, config })) } }));
    let calls = 0;
    await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit,
      { ...value.services, provider: async function* () { calls++; yield "Here now."; } });
    assert.equal(calls, 1);
    assert.equal(value.theme().current.widgets[0].config.comment?.text, "Here now.");
  }
});

test("loading weather waits for context and the mounted widget uses only an in-memory concurrency guard", async () => {
  const value = fixture(); let calls = 0;
  value.services.provider = async function* () { calls++; yield "Ready."; };
  await ensureHereThereComment(value.theme().current.widgets[0], { ...value.context, hereWeather: { status: "loading" } }, value.commit, value.services);
  assert.equal(calls, 0);
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.match(source, /commentGenerating = useRef\(false\)/);
  assert.match(source, /commentGenerating\.current \|\| !hereThereCommentNeedsRefresh/);
  assert.match(source, /finally\(\(\) => \{ commentGenerating\.current = false; \}\)/);
  assert.doesNotMatch(source, /commentAttempts|claimHereThere/);
});

test("rebind invalidates old comments and late results cannot overwrite a new binding", async () => {
  const value = fixture();
  let release!: () => void; let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  value.services.provider = async function* () { started(); await held; yield "Old A."; };
  const previous = ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  await ready;
  await value.commit((theme) => bindHereThereCharacter(theme, "here-there-default", "b"));
  assert.equal(value.theme().current.widgets[0].config.comment, undefined);
  await ensureHereThereComment(value.theme().current.widgets[0], { ...value.context, characterId: "b" }, value.commit,
    { ...value.services, provider: async function* () { yield "New B."; } });
  release(); await previous;
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "New B.");
});

test("non-chat generation leaves sessions, messages and WorldBook activation state untouched", async () => {
  const value = fixture(); const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const api = new ApiConfigStorage(() => factory);
  await api.saveApiConfig((await value.services.api("chat-default"))!);
  const session = await storage.openSession("a"); await storage.send(session.id, "existing");
  const before = await storage.exportBackup(); const world = await storage.readWorldBookState(session.id);
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit,
    { ...value.services, api: (id) => api.getApiConfig(id) });
  assert.deepEqual(await storage.exportBackup(), before);
  assert.deepEqual(await storage.readWorldBookState(session.id), world);
});
