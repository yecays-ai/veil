import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAITextProvider, supportsThinkingSwitch } from "../lib/chat/provider";

const sse = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  { headers: { "content-type": "text/event-stream" } });

async function requestBody(baseUrl: string, generation: Parameters<ReturnType<typeof createOpenAITextProvider>>[3], t: test.TestContext) {
  let sent: Record<string, unknown> | undefined, calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => { calls++; sent = JSON.parse(String(init?.body)); return sse(); });
  const config = { id: "x", baseUrl, apiKey: "k", model: "deepseek-flash" };
  for await (const _part of createOpenAITextProvider()(config, [{ role: "user", content: "hi" }], new AbortController().signal, generation));
  assert.equal(calls, 1, "one request, never a retry");
  return sent!;
}

test("a background request that asks for no thinking sends the DeepSeek switch to DeepSeek's own hosts", async (t) => {
  const asked = { maxTokens: 3000, thinking: "disabled" as const };
  assert.deepEqual((await requestBody("https://api.deepseek.com", asked, t)).thinking, { type: "disabled" });
  t.mock.restoreAll();
  const body = await requestBody("https://api.deepseek.com/v1", asked, t);
  assert.deepEqual([body.thinking, body.max_tokens, body.model], [{ type: "disabled" }, 3000, "deepseek-flash"]);
});

test("chat requests and other servers never get the field, whatever the model is called", async (t) => {
  // Ordinary chat passes no such option, even to DeepSeek.
  assert.equal("thinking" in await requestBody("https://api.deepseek.com", { maxTokens: 800, temperature: 1 }, t), false);
  t.mock.restoreAll();
  // A relay or any other OpenAI-compatible server may reject an unknown field, so it is not sent there.
  for (const url of ["https://relay.example.com/v1", "https://api.openai.com/v1", "http://localhost:11434/v1"]) {
    assert.equal("thinking" in await requestBody(url, { thinking: "disabled" }, t), false, url);
    t.mock.restoreAll();
  }
});

test("the host check matches DeepSeek's domain and nothing that merely looks like it", () => {
  for (const yes of ["https://api.deepseek.com", "https://API.DeepSeek.com/v1", "https://deepseek.com", "https://x.api.deepseek.com/v1"])
    assert.equal(supportsThinkingSwitch(yes), true, yes);
  for (const no of ["https://notdeepseek.com", "https://deepseek.com.evil.test/v1", "https://example.com/deepseek.com", "https://relay.test/?h=deepseek.com", "not a url", ""])
    assert.equal(supportsThinkingSwitch(no), false, no);
});
