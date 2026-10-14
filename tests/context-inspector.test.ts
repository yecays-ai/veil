import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { contextInspector, createContextInspector } from "../lib/chat/context-inspector";
import { logCompletionStart, logCompletionUsage, logPromptSummary, startCompletionTerminal } from "../lib/chat/request-diagnostics";
import { testTextApiConnection } from "../lib/settings/text-api";

const PRIVATE = "private prompt text";
const context = { requestId: "req-1", source: "manual-reply" as const, sessionId: "character:secret-id" };
const config = { id: "c", name: "n", provider: "Custom" as const, baseUrl: "https://api.example/v1",
  apiKey: "fake-secret-key", model: "chat-model" };

async function withEnv<T>(env: string, run: () => Promise<T> | T) {
  const originalInfo = console.info, originalFetch = globalThis.fetch, originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: env });
  console.info = (() => {}) as typeof console.info;
  try { return await run(); } finally {
    console.info = originalInfo; globalThis.fetch = originalFetch;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
}

function logOneRequest() {
  const messages = [{ role: "system" as const, content: `${PRIVATE} keyword-secret` }, { role: "user" as const, content: PRIVATE }];
  const finish = startCompletionTerminal(context);
  logPromptSummary(context, "chat-model", [{ identifier: "main", role: "system", characterLength: 30 }], messages,
    { ids: ["memory-1", "journal-1"], characterLength: 12, outcome: "selected" });
  logCompletionStart(context, "chat-model", messages, true);
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: null, prompt_cache_miss_tokens: null };
  logCompletionUsage(context, usage);
  finish({ outcome: "completed", finishReason: "stop" }, usage);
}

test("development diagnostics of one request merge into one redacted inspector record", async () => {
  contextInspector.clear();
  await withEnv("development", logOneRequest);
  const records = contextInspector.snapshot();
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.requestId, "req-1");
  assert.equal(record.source, "manual-reply");
  assert.equal(record.model, "chat-model");
  assert.equal(record.start?.messageCount, 2);
  assert.deepEqual(record.prompt?.sections, [{ identifier: "main", role: "system", characterLength: 30 }]);
  assert.deepEqual(record.prompt?.memory, { ids: ["memory-1", "journal-1"], characterLength: 12, outcome: "selected" });
  assert.equal(record.usage?.total_tokens, 12);
  assert.equal(record.terminal?.outcome, "completed");
  assert.equal(record.terminal?.finishReason, "stop");
  const serialized = JSON.stringify(records);
  assert.doesNotMatch(serialized, /private prompt text|keyword-secret|secret-id|fake-secret-key/);
  contextInspector.clear();
});

test("production builds record nothing", async () => {
  contextInspector.clear();
  await withEnv("production", logOneRequest);
  assert.equal(contextInspector.snapshot().length, 0);
});

test("the store copies allowlisted fields only and stays bounded, newest first", () => {
  const inspector = createContextInspector(2);
  inspector.record("prompt", { requestId: "a", source: "regenerate", content: PRIVATE, keywords: ["k"], apiKey: "key",
    sections: [{ identifier: "main", role: "system", characterLength: 4, content: PRIVATE }],
    memory: { ids: ["m"], characterLength: 1, outcome: "selected", entries: [PRIVATE] } });
  assert.doesNotMatch(JSON.stringify(inspector.snapshot()), /private prompt text|"k"|key|entries|content/);
  inspector.record("start", { requestId: "b", source: "continue", messageCount: 1 });
  inspector.record("start", { requestId: "c", source: "continue", messageCount: 1 });
  assert.deepEqual(inspector.snapshot().map((record) => record.requestId), ["c", "b"]);
  inspector.record("terminal", { requestId: "b", outcome: "error", errorCategory: "http", httpStatus: 500, durationMs: 9 });
  assert.deepEqual(inspector.snapshot().map((record) => record.requestId), ["b", "c"]);
  assert.equal(inspector.snapshot()[0].start?.messageCount, 1);
  inspector.record("start", null);
  inspector.record("start", { source: "continue" });
  assert.equal(inspector.snapshot().length, 2);
});

test("recording does not add provider calls or change the request body", async () => {
  contextInspector.clear();
  const bodies: string[] = [];
  await withEnv("development", async () => {
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] });
    }) as typeof fetch;
    await testTextApiConnection(config);
  });
  assert.equal(bodies.length, 1);
  assert.deepEqual(JSON.parse(bodies[0]).messages, [{ role: "user", content: "Reply with OK only." }]);
  const records = contextInspector.snapshot();
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "test-connection");
  assert.equal(records[0].terminal?.outcome, "completed");
  assert.doesNotMatch(JSON.stringify(records), /Reply with OK|fake-secret-key/);
  contextInspector.clear();
});

test("the panel renders only in development, behind the query flag, and is read-only", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/messages?veilInspector=1", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Event"] as const) install(name, dom.window[name]);
  install("self", dom.window); install("IS_REACT_ACT_ENVIRONMENT", true);
  const originalEnv = process.env.NODE_ENV;
  try {
    const { createRoot } = await import("react-dom/client");
    const { ContextInspectorGate } = await import("../components/diagnostics/context-inspector");
    const root = createRoot(dom.window.document.getElementById("root")!);
    const render = async () => {
      await act(async () => { root.render(createElement("div", { key: process.env.NODE_ENV }, createElement(ContextInspectorGate))); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    };

    Object.assign(process.env, { NODE_ENV: "production" });
    await render();
    assert.equal(dom.window.document.querySelector("[data-context-inspector]"), null);

    Object.assign(process.env, { NODE_ENV: "development" });
    contextInspector.clear();
    await withEnv("development", logOneRequest);
    await render();
    const panel = dom.window.document.querySelector("[data-context-inspector]");
    assert.ok(panel);
    const toggle = panel.querySelector("button")!;
    assert.match(toggle.textContent ?? "", /CTX · 1/);
    await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    const text = panel.textContent ?? "";
    assert.match(text, /manual-reply · completed/);
    assert.match(text, /main/);
    assert.doesNotMatch(text, /private prompt text|keyword-secret/);
    assert.equal(panel.querySelectorAll("input, textarea, select").length, 0);
    const stop = [...panel.querySelectorAll("button")].find((button) => button.textContent === "Stop")!;
    await act(async () => { stop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(dom.window.document.querySelector("[data-context-inspector]"), null);
    assert.equal(dom.window.location.search, "");
    await act(async () => { root.unmount(); });
  } finally {
    contextInspector.clear();
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
