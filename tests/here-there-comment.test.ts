import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { HERE_THERE_COMMENT_MAX_DELAY_MS, HERE_THERE_COMMENT_MIN_DELAY_MS, HERE_THERE_COMMENT_RETRY_DELAY_MS, HereThereCommentAttemptGuard, HereThereGenerationOwner, hereThereCommentNeedsRefresh,
  ensureHereThereComment, startHereThereCommentAttempt } from "../lib/here-there-comment";
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
      timezone: characterId === "a" ? "America/New_York" : "Asia/Tokyo",
      personality: "dry wit", speakingStyle: "brief and warm" }) }));
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
    settings: async () => ({ hereThereEnabled: true }), claimOpportunity: async () => context.now.getTime() + 1_000,
    scheduleRetry: async (_expectedNextCommentAt: number, now: number, delayMs: number) => now + delayMs > 0,
    provider: async function* () { yield "Wish you were here."; } as TextProvider };
  return { get bindings() { return bindings; }, set bindings(value) { bindings = value; }, foundation, context, services, commit, theme: () => theme };
}

test("Here & There retries a failed generation only on a later mount, and allows interval refresh after success", () => {
  const mounted = new HereThereCommentAttemptGuard();
  assert.equal(mounted.begin("a", true), true);
  mounted.finish("a");
  // Clock/weather rerenders in this mount cannot turn the failure into a retry loop.
  assert.equal(mounted.begin("a", true), false);
  assert.equal(mounted.begin("a", true), false);

  const laterMount = new HereThereCommentAttemptGuard();
  assert.equal(laterMount.begin("a", true), true);
  laterMount.finish("a");
  // Once success is visible, the guard resets; a later stale interval can refresh.
  assert.equal(laterMount.begin("a", false), false);
  assert.equal(laterMount.begin("a", true), true);
});

test("mounted guard rejects the same opportunity but accepts a distinct persisted future opportunity", () => {
  const mounted = new HereThereCommentAttemptGuard();
  assert.equal(mounted.begin("a", true, "100"), true);
  mounted.finish("a", "100");
  assert.equal(mounted.begin("a", true, "100"), false);
  assert.equal(mounted.begin("a", true, "200"), true);
});

test("widget failure schedules a short retry without looping, and a fresh Home mount can retry", async () => {
  const value = fixture();
  let calls = 0;
  let retryAt: number | null = null;
  let retryBaseTime: number | null = null;
  let retryClaimSchedule: number | null = null;
  const claimedSchedule = value.context.now.getTime() + 1_000;
  const failureTime = value.context.now.getTime() + 7 * 60 * 1000;
  value.services.claimOpportunity = async () => claimedSchedule;
  value.services.provider = async function* () { calls++; throw new Error("temporary provider failure"); };
  value.services.scheduleRetry = async (expectedNextCommentAt, now, delayMs) => {
    retryClaimSchedule = expectedNextCommentAt;
    retryBaseTime = now;
    retryAt = now + delayMs;
    return true;
  };
  const mountedAttempts = new HereThereCommentAttemptGuard();
  const runWidgetEffect = async (attempts: HereThereCommentAttemptGuard, now: Date) => {
    const widget = value.theme().current.widgets[0];
    const opportunity = retryAt ?? value.context.now.getTime();
    const attempt = startHereThereCommentAttempt(
      () => attempts.begin("a", hereThereCommentNeedsRefresh(widget, now, opportunity), String(opportunity)),
      () => ensureHereThereComment(widget, { ...value.context, now }, value.commit, value.services));
    if (attempt) await attempt.finally(() => attempts.finish("a", String(opportunity)));
  };

  const originalDateNow = Date.now;
  Date.now = () => failureTime;
  try {
    await runWidgetEffect(mountedAttempts, value.context.now);
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(calls, 1);
  assert.equal(retryClaimSchedule, claimedSchedule);
  assert.equal(retryBaseTime, failureTime);
  assert.equal(retryAt, failureTime + HERE_THERE_COMMENT_RETRY_DELAY_MS);
  assert.equal(value.theme().current.widgets[0].config.comment, undefined);

  const nextClockTick = new Date(value.context.now.getTime() + 1000);
  await runWidgetEffect(mountedAttempts, nextClockTick);
  await runWidgetEffect(mountedAttempts, new Date(nextClockTick.getTime() + 1000));
  assert.equal(calls, 1);

  value.services.provider = async function* () { calls++; yield "Peter is back."; };
  const freshHomeMount = new HereThereCommentAttemptGuard();
  await runWidgetEffect(freshHomeMount, new Date(retryAt! - 1));
  assert.equal(calls, 1);
  await runWidgetEffect(freshHomeMount, new Date(retryAt!));
  assert.equal(calls, 2);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Peter is back.");
});

test("Here & There prompt uses only name, personality, speaking style, local time and weather", async () => {
  const value = fixture();
  const preset = { ...createBuiltinPreset(), id: "character-preset", name: "Character", builtIn: false,
    prompts: createBuiltinPreset().prompts.map((entry) => entry.source === "prompt" && entry.identifier === "base"
      ? { ...entry, content: "CHARACTER_PRESET" } : entry) };
  value.bindings = { global: { apiConfigId: "global" }, characters: { a: {
    defaults: { apiConfigId: "character", presetId: preset.id },
    apps: { messages: { apiConfigId: "messages-only", presetId: "veil-default" } } } } };
  value.services.presets = async () => ({ ...createPresetDocument(), presets: [createBuiltinPreset(), preset] });
  let promptAssertionError: unknown;
  value.foundation.user.aboutMe = "UNIQUE_USER_PROFILE_SENTINEL";
  value.foundation.characters[0].backstory = "UNIQUE_CHARACTER_PROFILE_SENTINEL";
  value.services.provider = async function* (api, prompt) {
    try {
    assert.equal(api.id, "character");
    const content = JSON.stringify(prompt);
    assert.doesNotMatch(content, /CHARACTER_PRESET|UNIQUE_USER_PROFILE_SENTINEL|UNIQUE_CHARACTER_PROFILE_SENTINEL|background|backstory|characterId|history|conversation/i);
    assert.match(content, /\"name\"|You are a/); assert.match(content, /dry wit/);
    assert.match(content, /brief and warm/); assert.match(content, /08:00/);
    assert.match(content, /16/); assert.match(content, /Cloudy/); assert.match(content, /unavailable/);
    assert.equal(prompt.length, 1);
    } catch (error) { promptAssertionError = error; throw error; }
    yield "Wish you were here.";
  };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  assert.equal(promptAssertionError, undefined);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Wish you were here.");
});

test("Home widget completion is tagged separately from chat replies", async () => {
  const value = fixture();
  let source = "";
  value.services.provider = async function* (_api, _prompt, _signal, _generation, request) {
    source = request?.source ?? "";
    yield "A small remark.";
  };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  assert.equal(source, "here-there-comment");
});

test("successful comments persist across reloads without adding context to the prompt", async () => {
  const value = fixture(); let calls = 0;
  value.services.provider = async function* () { calls++; yield `Remark ${calls}.`; };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  const saved = value.theme().current.widgets[0].config.comment;
  assert.deepEqual(saved, { characterId: "a", text: "Remark 1.", generatedAt: value.context.now.toISOString() });
  const reloaded = normalizeDocument(JSON.parse(JSON.stringify(value.theme()))).current.widgets[0];
  const nextSchedule = value.context.now.getTime() + 2 * 60 * 60 * 1000;
  assert.equal(hereThereCommentNeedsRefresh(reloaded, new Date(nextSchedule - 1), nextSchedule), false);
  assert.equal(hereThereCommentNeedsRefresh(reloaded, new Date(nextSchedule), nextSchedule), true);
  await ensureHereThereComment(reloaded, { ...value.context, now: new Date(nextSchedule) }, value.commit, value.services);
  assert.equal(calls, 2);
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "Remark 2.");
});

test("failed initial generation and refresh write nothing and later eligible calls can succeed", async () => {
  for (const existing of [false, true]) {
    const value = fixture();
    if (existing) await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
    const before = JSON.stringify(value.theme());
    const context = { ...value.context, now: new Date(value.context.now.getTime() + HERE_THERE_COMMENT_MIN_DELAY_MS) };
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

test("loading weather uses an unavailable fallback and the mounted widget guards repeated failed attempts", async () => {
  const value = fixture(); let calls = 0;
  let sentPrompt = "";
  value.services.provider = async function* (_api, messages) { calls++; sentPrompt = JSON.stringify(messages); yield "Ready."; };
  await ensureHereThereComment(value.theme().current.widgets[0], { ...value.context, hereWeather: { status: "loading" } }, value.commit, value.services);
  assert.equal(calls, 1);
  assert.match(sentPrompt, /weather: unavailable/);
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.match(source, /new HereThereCommentAttemptGuard\(\)/);
  assert.match(source, /commentAttempts\.current\.begin\(characterId,[\s\S]*hereThereCommentNeedsRefresh/);
  assert.match(source, /finally\(async \(\) =>[\s\S]*commentAttempts\.current\.finish\(characterId, String\(scheduledAt\)\)/);
  assert.doesNotMatch(source, /claimHereThere/);
});

test("Here & There schedule constants define the intended future opportunity window", () => {
  assert.equal(HERE_THERE_COMMENT_MIN_DELAY_MS, 60 * 60 * 1000);
  assert.equal(HERE_THERE_COMMENT_MAX_DELAY_MS, 5 * 60 * 60 * 1000);
});

test("OFF returns before generation", async () => {
  const value = fixture(); let calls = 0;
  value.services.settings = async () => ({ hereThereEnabled: false });
  value.services.provider = async function* () { calls++; yield "Should not run."; };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  assert.equal(calls, 0);
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
  const before = await storage.readSession(session.id); const world = await storage.readWorldBookState(session.id);
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit,
    { ...value.services, api: (id) => api.getApiConfig(id) });
  assert.deepEqual(await storage.readSession(session.id), before);
  assert.deepEqual(await storage.readWorldBookState(session.id), world);
});

test("Here & There prompt states Lan/Chengdu = here and Peter/New York = there with Peter speaking", async () => {
  const value = fixture();
  value.foundation.user.name = "Lan";
  value.foundation.user.location = { label: "Chengdu", coordinates: null };
  value.foundation.characters[0] = { ...value.foundation.characters[0], name: "Peter" };
  let system = "";
  value.services.provider = async function* (_api, messages) { system = messages[0].content as string; yield "Ok."; };
  await ensureHereThereComment(value.theme().current.widgets[0], value.context, value.commit, value.services);
  assert.match(system, /You are Peter, the speaker/);
  assert.match(system, /HERE is Lan's place \(Lan is the user, in Chengdu\)/);
  assert.match(system, /THERE is Peter's place \(Peter is the character, in New York\)/);
  assert.match(system, /"Here" always means Lan's city and "there" always means Peter's city/);
  assert.match(system, /dry wit/);
  assert.match(system, /brief and warm/);
});

test("Here & There widget has no top title but keeps both location columns", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/widgets/here-there-widget.tsx", "utf8");
  assert.doesNotMatch(source, /here-there-title|hereThere\.title|HERE & THERE/);
  assert.match(source, /config=\{document\.user\}/);
  assert.match(source, /config=\{character\}/);
  assert.match(source, /participant-location/);
});

test("Here & There result that resolves after OFF is discarded and never committed", async () => {
  const value = fixture();
  const owner = new HereThereGenerationOwner();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  value.services.provider = async function* () { await gate; yield "Late remark."; };
  const widget = value.theme().current.widgets[0];
  const before = JSON.stringify(value.theme());
  const run = ensureHereThereComment(widget, { ...value.context, isCurrent: owner.begin() }, value.commit, value.services);
  owner.invalidate(); // feature switched OFF
  release();
  await run;
  assert.equal(JSON.stringify(value.theme()), before);
  assert.equal(value.theme().current.widgets[0].config.comment, undefined);
});

test("OFF then ON starts a new epoch so an older result cannot overwrite the new state", async () => {
  const value = fixture();
  const owner = new HereThereGenerationOwner();
  const widget = value.theme().current.widgets[0];
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldProvider: TextProvider = async function* () { await oldGate; yield "Old A."; };
  const newProvider: TextProvider = async function* () { yield "New B."; };
  const oldRun = ensureHereThereComment(widget, { ...value.context, isCurrent: owner.begin() }, value.commit,
    { ...value.services, provider: oldProvider });
  owner.invalidate(); // OFF
  owner.invalidate(); // ON again, fresh ownership
  await ensureHereThereComment(widget, { ...value.context, isCurrent: owner.begin() }, value.commit,
    { ...value.services, provider: newProvider });
  releaseOld();
  await oldRun;
  assert.equal(value.theme().current.widgets[0].config.comment?.text, "New B.");
});
