import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode } from "react";
import { createMaintenanceScheduler } from "../lib/memory/maintenance-scheduler";
import { MAINTENANCE_IDLE_MS } from "../lib/memory/maintenance-runner";
import { MAINTENANCE_CONSENT_KEY, MAINTENANCE_CONFIG_EVENT, maintenanceEnabled, maintenanceReleaseApproved, setMaintenanceConsent } from "../lib/memory/maintenance-config";
import type { ChatSession } from "../lib/chat/types";

test("release, preview/CI and per-device consent gates default fail closed; no consent is restored from backup", () => {
  const keys = ["NODE_ENV", "NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED", "NEXT_PUBLIC_VERCEL_ENV", "CI"];
  const env: Record<string, string | undefined> = process.env;
  const previous = keys.map((key) => env[key]), win = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>(); let events = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) }, dispatchEvent: () => { events++; } } });
  try {
    env.NODE_ENV = "production"; delete process.env.CI; delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED;
    values.set(MAINTENANCE_CONSENT_KEY, "enabled"); assert.equal(maintenanceEnabled(), false);
    process.env.NEXT_PUBLIC_MEMORY_MAINTENANCE_APPROVED = "true"; assert.equal(maintenanceEnabled(), false, "unknown release environment fails closed");
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production"; values.clear(); assert.equal(maintenanceEnabled(), false);
    setMaintenanceConsent(true); assert.equal(maintenanceEnabled(), true); assert.equal(events, 1);
    process.env.NEXT_PUBLIC_VERCEL_ENV = "preview"; assert.equal(maintenanceEnabled(), false); assert.throws(() => setMaintenanceConsent(true));
    process.env.NEXT_PUBLIC_VERCEL_ENV = "production"; process.env.CI = "true"; assert.equal(maintenanceReleaseApproved(), false);
    delete process.env.CI; setMaintenanceConsent(false); assert.equal(maintenanceEnabled(), false);
    env.NODE_ENV = "development"; assert.equal(maintenanceReleaseApproved(), false);
  } finally {
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    if (win) Object.defineProperty(globalThis, "window", win); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("mounted default-off gate stays inert across StrictMode, rerender, restore-style remount, focus and pageshow", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  for (const key of ["window", "document", "navigator", "Event", "HTMLElement"] as const) install(key, dom.window[key]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  let network = 0, opens = 0; install("fetch", async () => { network++; throw new Error("no network authorized"); });
  Object.defineProperty(dom.window, "indexedDB", { value: { open: () => { opens++; throw new Error("no maintenance storage authorized"); } } });
  const { createRoot } = await import("react-dom/client");
  const { MemoryMaintenanceGate } = await import("../components/memory-maintenance-gate");
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(MemoryMaintenanceGate))); });
    await act(async () => {
      root.render(createElement(MemoryMaintenanceGate));
      for (const name of ["focus", "pageshow", MAINTENANCE_CONFIG_EVENT]) dom.window.dispatchEvent(new dom.window.Event(name));
      dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    });
    assert.equal(network, 0); assert.equal(opens, 0); assert.equal(dom.window.document.getElementById("root")!.textContent, "");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

const row = (id = "c"): ChatSession => ({ id, characterId: id, updatedAt: 1000, autoReplyOnKeyboardDismiss: false, nextOrder: 2,
  memorySequence: { epoch: id, nextSeq: 2 } });
test("owner contention rechecks after bounded delay without treating it as model retry; repeated wake does not duplicate timers", async () => {
  let now = 1000 + MAINTENANCE_IDLE_MS, calls = 0, next = 0;
  const timers = new Map<number, { cb: () => void; delay: number }>();
  const scheduler = createMaintenanceScheduler({ enabled: () => true, runnable: () => true, now: () => now, sessions: async () => [row()],
    run: async () => { calls++; return calls === 1 ? "busy" : false; },
    setTimer: (cb, delay) => { timers.set(++next, { cb, delay }); return next; }, clearTimer: (id) => { timers.delete(id as number); } });
  await scheduler.wake(); await scheduler.wake(); assert.equal(timers.size, 1);
  const fire = () => { const [id, timer] = [...timers][0]; timers.delete(id); timer.cb(); };
  fire(); await new Promise((r) => setTimeout(r, 0)); assert.equal(calls, 1); assert.equal([...timers.values()][0].delay, 5000);
  now += 5000; fire(); await new Promise((r) => setTimeout(r, 0));
  fire(); await new Promise((r) => setTimeout(r, 0)); assert.equal(calls, 2); assert.equal(timers.size, 0);
  scheduler.stop();
});

test("stop cancels page ownership and late session reads cannot create a timer or provider", async () => {
  let release!: (rows: ChatSession[]) => void, scheduled = 0, calls = 0;
  const sessions = new Promise<ChatSession[]>((done) => { release = done; });
  const scheduler = createMaintenanceScheduler({ enabled: () => true, runnable: () => true, now: () => 1e6, sessions: () => sessions,
    run: async () => { calls++; return false; }, setTimer: () => { scheduled++; return 1; }, clearTimer: () => {} });
  const waking = scheduler.wake(); scheduler.stop(); release([row()]); await waking;
  assert.equal(scheduled, 0); assert.equal(calls, 0);
});
