import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { DEFAULT_API_CONFIG_ID } from "../lib/api-config";
import type { BindingDocument } from "../lib/bindings";
import type { ChatSession } from "../lib/chat/types";
import { USAGE_BASELINE_KEY } from "../lib/chat/usage-baseline";
import { MAINTENANCE_CONSENT_KEY, maintenanceReleaseChecks } from "../lib/memory/maintenance-config";
import { maintenanceModelStatus, summarizeMaintenanceProgress, summarizeRollingSummary } from "../lib/memory/maintenance-status";
import type { MemoryCursor } from "../lib/memory/types";
import { lockOrigin } from "./generation-lock-fixture";

const ENV_KEYS = ["NODE_ENV", "NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED", "NEXT_PUBLIC_VERCEL_ENV", "CI"] as const;
function withEnv(values: Partial<Record<typeof ENV_KEYS[number], string>>) {
  const env: Record<string, string | undefined> = process.env;
  const previous = ENV_KEYS.map((key) => env[key]);
  for (const key of ENV_KEYS) { if (values[key] === undefined) delete env[key]; else env[key] = values[key]; }
  return () => ENV_KEYS.forEach((key, i) => { if (previous[i] === undefined) delete env[key]; else env[key] = previous[i]; });
}
const APPROVED = { NODE_ENV: "production", NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED: "true", NEXT_PUBLIC_VERCEL_ENV: "production" } as const;

test("release checks name each missing condition; Preview and CI never pass", () => {
  let restore = withEnv(APPROVED);
  try { assert.deepEqual(maintenanceReleaseChecks(), { productionBuild: true, approvalFlag: true, vercelProduction: true, notCi: true }); }
  finally { restore(); }
  restore = withEnv({ ...APPROVED, NEXT_PUBLIC_VERCEL_ENV: "preview", CI: "1" });
  try { assert.deepEqual(maintenanceReleaseChecks(), { productionBuild: true, approvalFlag: true, vercelProduction: false, notCi: false }); }
  finally { restore(); }
  restore = withEnv({});
  try { assert.deepEqual(maintenanceReleaseChecks(), { productionBuild: false, approvalFlag: false, vercelProduction: false, notCi: true }); }
  finally { restore(); }
});

const bindings = (memoryApiConfigId?: string | null): BindingDocument => ({ global: {},
  characters: memoryApiConfigId === undefined ? {} : { c: { defaults: {}, apps: { messages: { memoryApiConfigId } } } } });
const config = { id: DEFAULT_API_CONFIG_ID, name: "Main", baseUrl: "https://api.example.test/v1", apiKey: "sk-secret", model: "model-a" };

test("model status names the reason and never exposes a key or URL", async () => {
  const ready = await maintenanceModelStatus(bindings(), "c", async (id) => id === config.id ? config : undefined);
  assert.deepEqual(ready, { state: "ready", label: "Main · model-a" });
  assert.equal((await maintenanceModelStatus(bindings(null), "c", async () => config)).state, "disabled");
  assert.equal((await maintenanceModelStatus(bindings(), "c", async () => undefined)).state, "missing");
  const invalid = await maintenanceModelStatus(bindings(), "c", async () => ({ ...config, apiKey: " " }));
  assert.equal(invalid.state, "invalid");
  assert.equal((await maintenanceModelStatus(bindings(), "c", async () => { throw new Error("db down sk-secret"); })).state, "unreadable");
  for (const status of [ready, invalid]) assert.doesNotMatch(JSON.stringify(status), /sk-secret|api\.example/);
});

const session = (id: string, characterId: string, nextSeq: number | undefined, updatedAt: number, extra: Partial<ChatSession> = {}): ChatSession => ({
  id, characterId, updatedAt, autoReplyOnKeyboardDismiss: false, nextOrder: 1,
  ...(nextSeq === undefined ? {} : { memorySequence: { epoch: id, nextSeq } }), ...extra });
const hash = "a".repeat(64);
const cursor = (characterId: string, sessionId: string, extraction: MemoryCursor["extraction"]): MemoryCursor =>
  ({ id: `${characterId}:${sessionId}`, characterId, sessionId, failureCount: 0, updatedAt: 0, extraction });

test("progress summary counts tracked, processed and blocked batches per Character only", () => {
  const now = 10_000_000;
  const sessions = [session("s1", "c", 9, now - 1000), session("s2", "c", undefined, now - 50_000),
    session("g", "c", 50, now, { type: "group" }), session("o", "other", 30, now)];
  const cursors = [cursor("c", "s1", { epoch: "s1", incarnation: "i", throughSeq: 3, completed: [[5, 5]], batches: [
    { id: "b1", fromSeq: 4, toSeq: 4, state: "failed", attempts: 1, sources: [{ messageId: "m", seq: 4, hash }], candidates: [] },
    { id: "b2", fromSeq: 6, toSeq: 7, state: "uncertain", attempts: 1, sources: [], candidates: [] },
  ] }), cursor("other", "o", { epoch: "o", incarnation: "i", throughSeq: 29, completed: [], batches: [] })];
  const summary = summarizeMaintenanceProgress("c", sessions, cursors);
  assert.deepEqual(summary, { tracked: 8, processed: 4, waiting: 0, running: 0, failed: 1, uncertain: 1, tooLarge: 0, pending: 1, trigger: 20, due: false });
  const idle = summarizeMaintenanceProgress("other", sessions, cursors);
  assert.equal(idle.tracked, 29); assert.equal(idle.processed, 29); assert.equal(idle.pending, 0); assert.equal(idle.due, false);
  const full = summarizeMaintenanceProgress("c", [session("s1", "c", 21, now)], []);
  assert.equal(full.pending, 20); assert.equal(full.due, true, "a full batch is waiting");
  assert.equal(summarizeMaintenanceProgress("c", [session("s1", "c", 21, now, { generation: { id: "g" } as ChatSession["generation"] })], []).due, false,
    "no check while a reply is generating");
});

async function mount(env: Partial<Record<typeof ENV_KEYS[number], string>>, run: (page: {
  text: () => string; toggle: () => HTMLInputElement; click: (el: Element) => Promise<void>;
  wait: (check: () => boolean) => Promise<void>; dom: JSDOM; events: () => number;
}) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://veil.example.test/settings/memory", pretendToBeVisual: true });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory(), configurable: true });
  Object.defineProperty(dom.window.navigator, "locks", { value: lockOrigin().client(), configurable: true });
  const names = ["window", "self", "document", "navigator", "HTMLElement", "Event", "StorageEvent", "localStorage", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name as keyof typeof dom.window] }));
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  const foundation = { ready: true, document: { characters: [{ characterId: "c", name: "Example" }] } };
  loader._load = function (request, ...args) {
    if (request.endsWith("foundation-provider")) return { useFoundation: () => foundation };
    return originalLoad.call(this, request, ...args);
  };
  let events = 0;
  dom.window.addEventListener("veil-memory-maintenance-config", () => { events++; });
  dom.window.localStorage.setItem(USAGE_BASELINE_KEY, JSON.stringify([
    { at: 1, source: "manual-reply", outcome: "completed", durationMs: 10, model: "m", promptTokens: 1, completionTokens: 1, totalTokens: 2,
      cacheHitTokens: null, cacheMissTokens: null, messageCount: 1, totalCharacters: 1 },
    { at: 2, source: "memory-maintenance", outcome: "completed", durationMs: 2400, model: "m", promptTokens: 120, completionTokens: 9, totalTokens: 129,
      cacheHitTokens: null, cacheMissTokens: null, messageCount: 1, totalCharacters: 1 }]));
  const restoreEnv = withEnv(env);
  const { createRoot } = await import("react-dom/client");
  const { MemoryMaintenanceSettings } = await import("../components/settings/memory-maintenance-settings");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const text = () => container.textContent ?? "";
  const wait = async (check: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!check()) { assert.ok(Date.now() < deadline, `timed out; page text: ${text()}`); await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
  };
  try {
    await act(async () => root.render(createElement(MemoryMaintenanceSettings)));
    await run({ text, wait, dom, events: () => events, toggle: () => container.querySelector('input[role="switch"]') as HTMLInputElement,
      click: (el) => act(async () => { (el as HTMLElement).click(); }) });
  } finally {
    await act(async () => root.unmount());
    restoreEnv(); loader._load = originalLoad;
    names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : Reflect.deleteProperty(globalThis, name));
    dom.window.close();
  }
}

test("Settings switch turns this device on and off only when the release is approved", async () => {
  await mount(APPROVED, async ({ text, wait, toggle, click, dom, events }) => {
    await wait(() => text().includes("Off for this device") && text().includes("Example"));
    assert.match(text(), /Model unavailable: The selected Memory maintenance model is missing/);
    assert.match(text(), /Tracked 0 · Processed 0/);
    assert.match(text(), /completed · 129 tokens · 2\.4 s/);
    assert.doesNotMatch(text(), /2 tokens/, "chat requests are not listed as maintenance");
    assert.equal(toggle().disabled, false); assert.equal(toggle().checked, false);
    await click(toggle());
    await wait(() => text().includes("On for this device"));
    assert.equal(dom.window.localStorage.getItem(MAINTENANCE_CONSENT_KEY), "enabled");
    assert.equal(toggle().checked, true); assert.equal(events(), 1, "the root gate is told to start");
    await click(toggle());
    await wait(() => text().includes("Off for this device"));
    assert.equal(dom.window.localStorage.getItem(MAINTENANCE_CONSENT_KEY), null); assert.equal(events(), 2);
  });
});

test("Preview builds show the missing approval and cannot be switched on, even with stored consent", async () => {
  await mount({ ...APPROVED, NEXT_PUBLIC_VERCEL_ENV: "preview" }, async ({ text, wait, toggle, click, dom, events }) => {
    dom.window.localStorage.setItem(MAINTENANCE_CONSENT_KEY, "enabled");
    dom.window.dispatchEvent(new dom.window.Event("veil-memory-maintenance-config"));
    await wait(() => text().includes("Unavailable in this build") && text().includes("Example"));
    assert.match(text(), /Missing: Vercel Production deployment\./);
    assert.doesNotMatch(text(), /Tracked/, "Memory progress is not read while the release is off");
    assert.equal(toggle().disabled, true); assert.equal(toggle().checked, false);
    await click(toggle());
    assert.equal(dom.window.localStorage.getItem(MAINTENANCE_CONSENT_KEY), "enabled", "no write while unapproved");
    assert.equal(events(), 1);
  });
});

test("rolling summary status counts only this Character's direct chats and never shows summary text", () => {
  const summary = (updatedAt: number) => ({ text: "private summary text", throughOrder: 10, digest: "d", updatedAt });
  const sessions = [session("s1", "c", 5, 1), session("s2", "c", 5, 1, { summary: summary(2000) } as Partial<ChatSession>),
    session("s3", "c", 5, 1, { summary: summary(3000) } as Partial<ChatSession>), session("g", "c", 5, 1, { type: "group", summary: summary(9000) } as Partial<ChatSession>),
    session("o", "other", 5, 1, { summary: summary(8000) } as Partial<ChatSession>)];
  assert.deepEqual(summarizeRollingSummary("c", sessions), { chats: 2, updatedAt: 3000, due: false });
  assert.deepEqual(summarizeRollingSummary("c", [session("s1", "c", 5, 1)]), { chats: 0, updatedAt: null, due: false });
  assert.equal(summarizeRollingSummary("c", [{ ...session("s1", "c", 5, 1), nextOrder: 200 }]).due, true, "messages left the History window without a summary");
  assert.ok(!JSON.stringify(summarizeRollingSummary("c", sessions)).includes("private"));
});
