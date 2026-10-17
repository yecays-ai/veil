import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAITextProvider } from "../lib/chat/provider";
import { startCompletionTerminal } from "../lib/chat/request-diagnostics";
import { testTextApiConnection } from "../lib/settings/text-api";

const config = { id: "c", name: "n", provider: "Custom" as const, baseUrl: "https://api.example/v1",
  apiKey: "fake-secret-key", model: "chat-model" };
const prompt = [{ role: "user" as const, content: "private prompt text" }];
const context = { requestId: "req-1", source: "manual-reply" as const, sessionId: "character:secret-id" };
type Log = { label: string; data: Record<string, unknown> };

async function capture(run: () => Promise<unknown>, env: string | undefined = "development") {
  const originalInfo = console.info, originalFetch = globalThis.fetch, originalEnv = process.env.NODE_ENV;
  const logs: Log[] = [];
  if (env === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: env });
  console.info = ((label: string, data: Record<string, unknown>) => { logs.push({ label, data }); }) as typeof console.info;
  let error: unknown;
  try { await run(); } catch (reason) { error = reason; } finally {
    console.info = originalInfo; globalThis.fetch = originalFetch;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
  return { logs, error, terminals: logs.filter((entry) => entry.label === "[VEIL completion:terminal]").map((entry) => entry.data) };
}

const sse = (text: string, split = 7) => {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += split) controller.enqueue(bytes.slice(index, index + split));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
};
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
async function drain(provider = createOpenAITextProvider(), signal = new AbortController().signal) {
  let text = "";
  for await (const part of provider(config, prompt, signal, undefined, context)) text += part;
  return text;
}
const sameRequest = (terminals: Record<string, unknown>[]) => {
  assert.equal(terminals.length, 1, "exactly one terminal event per model call");
  assert.equal(terminals[0].requestId, "req-1");
  assert.equal(terminals[0].source, "manual-reply");
  assert.equal(typeof terminals[0].durationMs, "number");
  return terminals[0];
};

test("a completed stream records one terminal event after usage, tied to its request", async () => {
  const { logs, terminals } = await capture(async () => {
    globalThis.fetch = async () => sse(frame({ choices: [{ delta: { content: "Hi" } }] })
      + frame({ choices: [{ delta: { content: "!" }, finish_reason: "stop" }], usage: { total_tokens: 3 } }) + "data: [DONE]\n\n");
    assert.equal(await drain(), "Hi!");
  });
  const terminal = sameRequest(terminals);
  assert.equal(terminal.outcome, "completed");
  assert.equal(terminal.finishReason, "stop");
  const order = logs.map((entry) => entry.label);
  assert.deepEqual(order.filter((label) => /completion:/.test(label)),
    ["[VEIL completion:start]", "[VEIL completion:usage]", "[VEIL completion:terminal]"]);
});

test("a JSON reply and a provider-truncated stream are classified", async () => {
  const json = await capture(async () => {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    await drain();
  });
  assert.equal(sameRequest(json.terminals).outcome, "completed");
  const truncated = await capture(async () => {
    globalThis.fetch = async () => sse(frame({ choices: [{ delta: { content: "cut" }, finish_reason: "length" }] }));
    assert.equal(await drain(), "cut");
  });
  const terminal = sameRequest(truncated.terminals);
  assert.equal(terminal.outcome, "truncated");
  assert.equal(terminal.finishReason, "length");
});

test("HTTP, network, parse and stream failures record a controlled category, never the error text", async () => {
  const cases: [string, () => Promise<Response>, Record<string, unknown>][] = [
    ["http", async () => new Response(`echo ${config.apiKey}`, { status: 503 }), { errorCategory: "http", httpStatus: 503 }],
    ["network", async () => { throw new TypeError(`failed for ${config.apiKey}`); }, { errorCategory: "network" }],
    ["bad json", async () => new Response("{", { headers: { "Content-Type": "application/json" } }), { errorCategory: "invalid-reply" }],
    ["bad event", async () => sse("data: {nope\n\n"), { errorCategory: "invalid-stream" }],
    ["early end", async () => sse(frame({ choices: [{ delta: { content: "x" } }] })), { errorCategory: "stream-ended" }],
  ];
  for (const [name, respond, expected] of cases) {
    const { terminals, error } = await capture(async () => { globalThis.fetch = respond; await drain(); });
    assert.ok(error instanceof Error, name);
    const terminal = sameRequest(terminals);
    assert.equal(terminal.outcome, "error", name);
    for (const [key, value] of Object.entries(expected)) assert.equal(terminal[key], value, `${name}: ${key}`);
    assert.equal(JSON.stringify(terminal).includes(config.apiKey), false, name);
  }
});

test("connect and idle timeouts are timeouts with their phase", async () => {
  const provider = createOpenAITextProvider({ connectMs: 15, idleMs: 15 });
  const connect = await capture(async () => {
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await drain(provider);
  });
  const connectTerminal = sameRequest(connect.terminals);
  assert.equal(connectTerminal.outcome, "timeout");
  assert.equal(connectTerminal.timeoutPhase, "connect");
  const idle = await capture(async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: "a" } }] })));
    } }), { headers: { "Content-Type": "text/event-stream" } });
    await drain(provider);
  });
  const idleTerminal = sameRequest(idle.terminals);
  assert.equal(idleTerminal.outcome, "timeout");
  assert.equal(idleTerminal.timeoutPhase, "idle");
});

test("an aborted call is a generic cancellation, not a Stop click and not a timeout", async () => {
  const before = new AbortController();
  before.abort(new Error("whatever the caller used"));
  const early = await capture(async () => { globalThis.fetch = async () => sse(""); await drain(createOpenAITextProvider(), before.signal); });
  assert.equal(sameRequest(early.terminals).outcome, "cancelled");
  const midway = new AbortController();
  const during = await capture(async () => {
    globalThis.fetch = async (_url, init) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: "a" } }] })));
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const stream = createOpenAITextProvider()(config, prompt, midway.signal, undefined, context)[Symbol.asyncIterator]();
    await stream.next();
    midway.abort();
    await stream.next();
  });
  const terminal = sameRequest(during.terminals);
  assert.equal(terminal.outcome, "cancelled");
  assert.equal("cancelReason" in terminal, false);
  assert.equal("errorCategory" in terminal, false);
});

test("a consumer that stops reading early is abandoned, recorded once", async () => {
  const { terminals } = await capture(async () => {
    globalThis.fetch = async () => sse(frame({ choices: [{ delta: { content: "a" } }] }) + frame({ choices: [{ delta: { content: "b" } }] }));
    const stream = createOpenAITextProvider()(config, prompt, new AbortController().signal, undefined, context)[Symbol.asyncIterator]();
    await stream.next();
    await stream.return?.();
  });
  assert.equal(sameRequest(terminals).outcome, "abandoned");
});

test("terminal events carry no prompt, reply, key, URL, session id or raw provider text", async () => {
  const { logs, terminals } = await capture(async () => {
    globalThis.fetch = async () => sse(frame({ choices: [{ delta: { content: "secret reply body" }, finish_reason: "my secret reason" }] }) + "data: [DONE]\n\n");
    await drain();
  });
  const terminal = sameRequest(terminals);
  assert.equal(terminal.finishReason, "other");
  const text = JSON.stringify(terminal);
  for (const secret of ["private prompt", "secret reply", config.apiKey, "api.example", "character:secret-id", "secret reason"])
    assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(Object.keys(terminal).sort(), ["durationMs", "finishReason", "outcome", "requestId", "source"]);
  assert.ok(logs.length > 0);
});

test("terminal diagnostics are development-only and can never break a call", async () => {
  const production = await capture(async () => {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    assert.equal(await drain(), "ok");
  }, "production");
  assert.equal(production.logs.length, 0);
  const originalInfo = console.info;
  const failing = await capture(async () => {
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    console.info = (() => { throw new Error("logging is broken"); }) as typeof console.info;
    assert.equal(await drain(), "ok");
  });
  console.info = originalInfo;
  assert.equal(failing.error, undefined);
});

test("a terminal reporter records only its first outcome", () => {
  const logs: Record<string, unknown>[] = [];
  const originalInfo = console.info, originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "development" });
  console.info = ((_label: string, data: Record<string, unknown>) => { logs.push(data); }) as typeof console.info;
  try {
    const finish = startCompletionTerminal({ requestId: "once", source: "unclassified" });
    finish({ outcome: "completed", finishReason: "stop" });
    finish({ outcome: "error", errorCategory: "network" });
  } finally {
    console.info = originalInfo;
    if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0].outcome, "completed");
});

test("Test Connection records its own terminal event for success, failure and cancellation", async () => {
  const run = async (respond: () => Promise<Response>, signal?: AbortSignal) => capture(async () => {
    globalThis.fetch = respond; await testTextApiConnection(config, signal);
  });
  const ok = await run(async () => Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }));
  const okTerminal = ok.terminals[0];
  assert.equal(ok.terminals.length, 1);
  assert.equal(okTerminal.source, "test-connection");
  assert.equal(okTerminal.outcome, "completed");
  assert.equal(okTerminal.finishReason, "stop");
  const cases: [() => Promise<Response>, Record<string, unknown>][] = [
    [async () => new Response("x", { status: 401 }), { errorCategory: "http", httpStatus: 401 }],
    [async () => { throw new Error(config.apiKey); }, { errorCategory: "network" }],
    [async () => Response.json({ choices: [] }), { errorCategory: "no-completion" }],
    [async () => new Response("{", { status: 200 }), { errorCategory: "invalid-reply" }],
  ];
  for (const [respond, expected] of cases) {
    const failed = await run(respond);
    assert.equal(failed.terminals.length, 1);
    assert.equal(failed.terminals[0].outcome, "error");
    for (const [key, value] of Object.entries(expected)) assert.equal(failed.terminals[0][key], value);
    assert.equal(JSON.stringify(failed.terminals[0]).includes(config.apiKey), false);
  }
  const controller = new AbortController();
  controller.abort();
  const cancelled = await run(async () => { throw new DOMException("aborted", "AbortError"); }, controller.signal);
  assert.equal(cancelled.terminals.length, 1);
  assert.equal(cancelled.terminals[0].outcome, "cancelled");
});

test("an HTTP refusal names the provider's short error code but never its free text", async () => {
  const original = globalThis.fetch;
  const attempt = async (body: BodyInit, status = 403) => {
    globalThis.fetch = async () => new Response(body, { status });
    try { await drain(); } catch (error) { return (error as Error).message; }
    return "";
  };
  try {
    assert.equal(await attempt(JSON.stringify({ error: { code: "content_filter", type: "x", message: "sk-secret echoed prompt" } })),
      "API request failed (HTTP 403, content_filter). Check your API settings.");
    assert.equal(await attempt(JSON.stringify({ error: { type: "invalid_request_error" } }), 400),
      "API request failed (HTTP 400, invalid_request_error). Check your API settings.");
    for (const body of [JSON.stringify({ error: { code: "sk-secret has spaces" } }), JSON.stringify({ error: "plain" }), "<html>Forbidden</html>", ""])
      assert.equal(await attempt(body), "API request failed (HTTP 403). Check your API settings.");
    // A body that never ends is read only as far as the limit, then cancelled.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1024; controller.enqueue(new Uint8Array(1024).fill(32)); } });
    assert.equal(await attempt(endless), "API request failed (HTTP 403). Check your API settings.");
    assert.ok(pulled <= 4096 + 2048, `read stopped near the limit (pulled ${pulled})`);
  } finally { globalThis.fetch = original; }
});
