import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { openAITextProvider } from "../lib/chat/provider";
import { canContinueTurn } from "../lib/chat/turns";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { regressionContract } from "./regression-contract";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import { emptyWorldBookDocument } from "../lib/worldbook";
import { emptyRegexDocument } from "../lib/regex";
import { lockOrigin } from "./generation-lock-fixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup() {
  const factory = new IDBFactory(), origin = lockOrigin();
  const storage = new ChatStorage(() => factory, () => origin.client());
  const peer = new ChatStorage(() => factory, () => origin.client());
  const session = await storage.openSession("a");
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) },
    { characterId: "b", ...normalizeCharacterInput({ name: "B" }) }];
  return { factory, origin, storage, peer, session, document };
}

regressionContract("chat.generation-session-ownership", "async-race-safety",
  "a live session rejects cross-client Send, Reply, Regenerate, Continue and Edit while another session remains independent", async () => {
    const { storage, peer, session, document, origin } = await setup();
    const user = await storage.send(session.id, "Question");
    const started = deferred(), finish = deferred();
    const first = createChatEngine(storage, async () => document, async function* () {
      started.resolve(); await finish.promise; yield "Answer";
    });
    const second = createChatEngine(peer, async () => document, async function* () { yield "Other answer"; });
    const pending = first.requestReply(session.id);
    try {
      await started.promise;
      assert.equal((await peer.readSession(session.id)).messages.at(-1)?.status, "streaming", "peer hydration must not recover a living owner");
      await assert.rejects(peer.send(session.id, "Overlapping Send"), /in progress/);
      await assert.rejects(second.requestReply(session.id), /in progress/);
      await assert.rejects(second.regenerateMessage("unused", undefined, session.id), /in progress/);
      await assert.rejects(second.continueMessage("unused", undefined, session.id), /in progress/);
      await assert.rejects(peer.editMessage(user.id, "Stale edit"), /in progress/);
      await assert.rejects(peer.clearSession(session.id), /in progress/);
      const other = await peer.openSession("b");
      await peer.send(other.id, "Independent");
      assert.equal((await second.requestReply(other.id))?.status, "complete");
      assert.ok(first.isGenerating(session.id));
    } finally { finish.resolve(); await pending; }
    await peer.editMessage(user.id, "After completion");
    assert.equal(origin.held.size, 0, "all native lock callbacks have completed");
  });

regressionContract("chat.generation-orphan-recovery", "async-race-safety",
  "legacy orphan streaming recovers to explicit error, stays out of prompts, and unblocks every maintenance path", async () => {
    for (const action of ["edit", "delete", "clear", "delete-session", "retry"] as const) {
      const { factory, storage, peer, session, document } = await setup();
      const user = await storage.send(session.id, "Keep user context");
      const database = await new Promise<IDBDatabase>((resolve) => {
        const opened = factory.open(CHAT_DATABASE_NAME); opened.onsuccess = () => resolve(opened.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["sessions", "messages"], "readwrite");
        tx.objectStore("messages").put({ ...user, requestedBy: "orphan" });
        tx.objectStore("messages").put({ id: "orphan", sessionId: session.id, role: "assistant", content: "Half generated ghost",
          status: "streaming", createdAt: 2, order: 2 });
        tx.objectStore("sessions").put({ ...session, nextOrder: 3, lastMessageId: "orphan" });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
      database.close();
      const recovered = await peer.readSession(session.id);
      assert.equal(recovered.messages[1].status, "error");
      assert.equal(recovered.messages[1].outcome, "interrupted");
      assert.ok(recovered.messages[1].error);
      assert.ok(!JSON.stringify(assembleChatPrompt(document, document.characters[0], recovered.messages, []).messages).includes("Half generated ghost"));
      if (action === "edit") await peer.editMessage(user.id, "Edited");
      if (action === "delete") assert.equal(await peer.deleteMessages(session.id, ["orphan"]), 1);
      if (action === "clear") assert.equal(await peer.clearSession(session.id), 2);
      if (action === "delete-session") { await peer.deleteSession(session.id); assert.equal((await peer.listSessions()).length, 0); }
      if (action === "retry") {
        const engine = createChatEngine(peer, async () => document, async function* () { yield "Manual recovery"; });
        assert.equal((await engine.regenerateMessage("orphan"))?.content, "Manual recovery");
      }
    }
  });

test("crashed lock owner is recovered and its old attempt cannot commit after a new owner takes over", async () => {
  const { storage, peer, session, origin } = await setup();
  await storage.send(session.id, "Question");
  const token = await storage.claimGeneration(session.id);
  const batch = await storage.beginReply(session.id, undefined, token); assert.ok(batch);
  await storage.updateReply(batch.assistant.id, { content: "Partial", status: "streaming" }, undefined, token);
  origin.crash();
  assert.equal((await peer.readSession(session.id)).messages.at(-1)?.outcome, "interrupted");
  const next = await peer.claimGeneration(session.id);
  try {
    await assert.rejects(storage.finalizeReply(batch.assistant.id, "Stale completion", undefined, undefined, token), /no longer active/);
    await storage.releaseGeneration(session.id, token);
    assert.equal(await peer.generationIsCurrent(session.id, next), true);
  } finally { await peer.releaseGeneration(session.id, next); }
});

test("Clear and Delete conversation do not require a quota-blocked orphan error write", async (context) => {
  const put = IDBObjectStore.prototype.put;
  for (const deleting of [false, true]) {
    const { storage, peer, session, origin } = await setup();
    await storage.send(session.id, "Question");
    const token = await storage.claimGeneration(session.id);
    assert.ok(await storage.beginReply(session.id, undefined, token));
    origin.crash();
    const intercept = context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { outcome?: string }).outcome === "interrupted") throw new DOMException("Recovery marker exceeds quota", "QuotaExceededError");
      return put.call(this, value, key);
    });
    await assert.rejects(peer.readSession(session.id), /quota/);
    if (deleting) { await peer.deleteSession(session.id); assert.equal((await peer.listSessions()).length, 0); }
    else { assert.equal(await peer.clearSession(session.id), 2); assert.equal((await peer.readSession(session.id)).messages.length, 0); }
    intercept.mock.restore();
    await storage.releaseGeneration(session.id, token);
  }
});

regressionContract("chat.generation-stop-preparation", "async-race-safety",
  "Stop settles pending runtime preparation and a later resolver never starts the provider", async () => {
    const { storage, session, document } = await setup();
    await storage.send(session.id, "Question");
    const preparing = deferred(), finish = deferred(); let calls = 0;
    const engine = createChatEngine(storage, async () => document, async function* () { calls++; yield "late"; },
      undefined, undefined, undefined, async () => { preparing.resolve(); await finish.promise; return { version: 1, groups: [] }; });
    const pending = engine.requestReply(session.id);
    await preparing.promise; engine.stop(session.id);
    try {
      const settled = await Promise.race([pending.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))]);
      assert.equal(settled, true, "Stop must not wait for runtime preparation to resolve");
      const failed = await pending;
      assert.equal(failed?.outcome, "stopped");
      assert.equal(failed?.failureStage, "preparing");
      assert.equal((await storage.readSession(session.id)).session.generation, undefined);
    } finally { finish.resolve(); await pending; }
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 0);
  });

test("Stop while Send saving is pending invalidates its post-Send generation continuation", async () => {
  const { storage, session, document } = await setup();
  const committed = deferred(), releaseSave = deferred(); let calls = 0, saved = 0;
  const send = storage.send.bind(storage);
  storage.send = async (...args) => { const message = await send(...args); committed.resolve(); await releaseSave.promise; return message; };
  const engine = createChatEngine(storage, async () => document, async function* () { calls++; yield "late"; });
  const pending = engine.requestReply(session.id, undefined, "manual-reply", { content: "Draft", onSent: () => { saved++; } });
  await committed.promise; engine.stop(session.id); releaseSave.resolve();
  const stopped = await pending;
  assert.equal(calls, 0); assert.equal(saved, 1); assert.equal(stopped?.outcome, "stopped");
  const after = await storage.readSession(session.id);
  assert.equal(after.messages[0].content, "Draft");
  assert.ok(after.messages.every((m) => m.status !== "streaming"));
  assert.equal(engine.isGenerating(session.id), false);
});

test("another tab's Stop interrupts preparation through asynchronous scoped notifications", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  class Channel {
    static peers = new Set<Channel>();
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly name: string) { Channel.peers.add(this); }
    postMessage(data: unknown) {
      for (const peer of Channel.peers) if (peer !== this && peer.name === this.name) {
        const copy = structuredClone(data);
        setImmediate(() => peer.onmessage?.({ data: copy }));
      }
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: Channel });
  const finish = deferred();
  let pending: Promise<unknown> | undefined, unsubscribe = () => {};
  try {
    const { storage, peer, session, document, origin } = await setup();
    await storage.send(session.id, "Question");
    unsubscribe = peer.subscribe(() => {});
    const started = deferred(); let calls = 0;
    // Stall after the claim (WorldBook stage) so there is a persisted attempt for the peer to Stop.
    const engine = createChatEngine(storage, async () => document, async function* () { calls++; yield "late"; },
      undefined, undefined, async () => { started.resolve(); await finish.promise; return emptyWorldBookDocument(); },
      async () => emptyRegexDocument(), async () => ({ global: {}, characters: {} }));
    pending = engine.requestReply(session.id);
    await started.promise;
    await peer.stopGeneration(session.id);
    let timeout!: ReturnType<typeof setTimeout>;
    const result = await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("peer Stop did not settle the owner")), 1000);
    })]).finally(() => clearTimeout(timeout));
    assert.equal(result, null, "the peer already persisted the terminal attempt");
    assert.equal((await peer.readSession(session.id)).messages.at(-1)?.outcome, "stopped");
    assert.equal(calls, 0); assert.equal(origin.held.size, 0);
  } finally {
    finish.resolve(); await pending; unsubscribe();
    for (const peer of Channel.peers) peer.onmessage = null;
    Channel.peers.clear();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor); else Reflect.deleteProperty(globalThis, "window");
    if (channelDescriptor) Object.defineProperty(globalThis, "BroadcastChannel", channelDescriptor); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

regressionContract("chat.generation-failure-explicit-retry", "async-race-safety",
  "provider failure never auto-retries, preserves user context, excludes partial errors and allows Retry/Delete", async () => {
    const { storage, peer, session, document } = await setup();
    await storage.send(session.id, "User context"); let calls = 0;
    const engine = createChatEngine(storage, async () => document, async function* (_config, prompt) {
      calls++;
      assert.ok(!JSON.stringify(prompt).includes("Ghost partial"));
      if (calls === 1) { yield "Ghost partial"; throw new Error("offline"); }
      yield "Recovered";
    });
    const failed = await engine.requestReply(session.id);
    assert.equal(failed?.outcome, "failed"); assert.equal(failed?.failureStage, "provider");
    assert.equal(await engine.requestReply(session.id), null); assert.equal(calls, 1);
    assert.equal((await engine.regenerateMessage(failed!.id))?.content, "Recovered");
    const valid = await peer.readSession(session.id);
    assert.deepEqual(valid.messages.map((m) => m.content), ["User context", "Recovered"]);
    const failure = createChatEngine(storage, async () => document, async function* () { throw new Error("offline again"); });
    const sidecar = await failure.regenerateMessage(valid.messages[1].id);
    assert.equal(await peer.deleteMessages(session.id, [sidecar!.id]), 1);
    assert.deepEqual((await peer.readSession(session.id)).messages, valid.messages);
  });

regressionContract("chat.generation-length-continuation", "async-race-safety",
  "real provider length termination preserves visible output, explicitly continues the same turn, and a new User closes eligibility", async () => {
    const { storage, session, document } = await setup();
    const originalFetch = globalThis.fetch;
    let requests = 0;
    try {
      globalThis.fetch = async (_url, init) => {
        requests++;
        const prompt = JSON.parse(String(init?.body)).messages;
        if (requests === 2) assert.ok(prompt.some((m: { content: string }) => m.content.includes("Visible prefix")));
        return Response.json({ choices: [{ message: { content: requests === 1 ? "Visible prefix" : "Continuation" },
          finish_reason: requests === 1 ? "length" : "stop" }] });
      };
      const engine = createChatEngine(storage, async () => document, openAITextProvider);
      await storage.send(session.id, "Question");
      const truncated = await engine.requestReply(session.id);
      assert.equal(truncated?.content, "Visible prefix"); assert.equal(truncated?.outcome, "truncated");
      assert.equal(truncated?.finishReason, "length");
      assert.ok(canContinueTurn((await storage.readSession(session.id)).messages, truncated!.id));
      await engine.continueMessage(truncated!.id);
      const after = (await storage.readSession(session.id)).messages;
      assert.deepEqual(after.map((m) => m.content), ["Question", "Visible prefix", "Continuation"]);
      assert.equal(after[1].turnId, after[2].turnId);
      assert.equal(canContinueTurn(after, after[1].id), false);
      const truncateAgain = createChatEngine(storage, async () => document, async function* (_c, _p, _s, _g, _r, terminal) {
        yield "Accepted partial"; terminal?.("length");
      });
      await storage.send(session.id, "Another");
      const accepted = await truncateAgain.requestReply(session.id);
      await storage.send(session.id, "My next message");
      await assert.rejects(engine.continueMessage(accepted!.id), /unconfirmed/);
      assert.equal(requests, 2, "there is no hidden continuation request");
      const snapshot = await storage.readSession(session.id);
      assert.ok(JSON.stringify(assembleChatPrompt(document, document.characters[0], snapshot.messages, []).messages).includes("Accepted partial"));
    } finally { globalThis.fetch = originalFetch; }
  });

test("SSE length reason is preserved through actual adapter and engine integration", async () => {
  const { storage, session, document } = await setup();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"One\\n\\nTwo"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } });
    await storage.send(session.id, "Question");
    await createChatEngine(storage, async () => document, openAITextProvider).requestReply(session.id);
    const replies = (await storage.readSession(session.id)).messages.slice(1);
    assert.deepEqual(replies.map((m) => m.content), ["One", "Two"]);
    assert.ok(replies.every((m) => m.outcome === "truncated" && m.finishReason === "length"));
  } finally { globalThis.fetch = originalFetch; }
});

test("an explicit truncation reason settles a still-open SSE stream and cancels its reader", async () => {
  const { storage, session, document } = await setup();
  const originalFetch = globalThis.fetch;
  let cancelled = 0;
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const engine = createChatEngine(storage, async () => document, openAITextProvider);
  let pending: Promise<unknown> | undefined;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) { source = controller; controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Visible truncated answer"},"finish_reason":"length"}]}\n\n')); },
      cancel() { cancelled++; },
    }), { headers: { "content-type": "text/event-stream" } });
    await storage.send(session.id, "Question");
    pending = engine.requestReply(session.id);
    let timeout!: ReturnType<typeof setTimeout>;
    const result = await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("terminal length did not settle")), 500);
    })]).finally(() => clearTimeout(timeout)) as { outcome: string; content: string };
    assert.equal(result.outcome, "truncated"); assert.equal(result.content, "Visible truncated answer");
    assert.equal(cancelled, 1);
  } finally {
    engine.stop(session.id);
    try { source?.close(); } catch { /* The reader already cancelled the source. */ }
    await pending; globalThis.fetch = originalFetch;
  }
});

test("failed or stopped Continue preserves the visible truncated turn and manually retries only its continuation", async () => {
  for (const stopped of [false, true]) {
    const { storage, session, document } = await setup();
    await storage.send(session.id, "Question");
    const initial = createChatEngine(storage, async () => document, async function* (_c, _p, _s, _g, _r, terminal) {
      yield "Original prefix"; terminal?.("length");
    });
    const truncated = await initial.requestReply(session.id);
    let calls = 0;
    const continuation = createChatEngine(storage, async () => document, async function* (_c, prompt) {
      calls++;
      assert.ok(JSON.stringify(prompt).includes("Original prefix"));
      assert.ok(!JSON.stringify(prompt).includes("Ghost continuation"));
      if (calls === 1) {
        if (stopped) continuation.stop(session.id);
        yield "Ghost continuation"; throw new Error("offline");
      }
      yield "Recovered continuation";
    });
    const failed = await continuation.continueMessage(truncated!.id);
    assert.equal(failed?.attemptMode, "continue");
    assert.equal(failed?.outcome, stopped ? "stopped" : "failed");
    assert.deepEqual((await storage.readSession(session.id)).messages.find((m) => m.id === truncated!.id), truncated);
    assert.equal(await continuation.requestReply(session.id), null); assert.equal(calls, 1);
    await continuation.continueMessage(failed!.id);
    const messages = (await storage.readSession(session.id)).messages;
    assert.deepEqual(messages.map((m) => m.content), ["Question", "Original prefix", "Recovered continuation"]);
    assert.equal(messages[1].turnId, messages[2].turnId);
  }
});

test("browsers without Web Locks fail closed for generation while idle Send/Edit/Clear remain usable", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  // Writes open a channel once a window exists; an open Node channel would keep the test process alive.
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined });
  try {
    const factory = new IDBFactory(), storage = new ChatStorage(() => factory, () => undefined);
    const session = await storage.openSession("a"), user = await storage.send(session.id, "Question");
    const document = defaultFoundation();
    document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
    const engine = createChatEngine(storage, async () => document, async function* () { assert.fail("unsafe generation"); },
      undefined, undefined, undefined, undefined, async () => ({ global: {}, characters: {} }));
    await assert.rejects(engine.requestReply(session.id), /Web Locks support/);
    assert.equal(engine.isGenerating(session.id), false);
    await storage.editMessage(user.id, "Edited");
    assert.equal(await storage.clearSession(session.id), 1);
  } finally {
    if (saved) Object.defineProperty(globalThis, "window", saved); else Reflect.deleteProperty(globalThis, "window");
    if (savedChannel) Object.defineProperty(globalThis, "BroadcastChannel", savedChannel); else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

regressionContract("chat.generation-route-interruption", "async-race-safety",
  "navigation/remount cancels the old route owner while a destination session generates independently", async () => {
    const { storage, session, document } = await setup();
    await storage.send(session.id, "A context");
    const prepared = deferred(), finish = deferred(), mounted = deferred();
    let regexLoads = 0;
    const generated: string[] = [];
    const engine = createChatEngine(storage, async () => document, async function* (_config, _prompt, _signal, _generation, request) {
      generated.push(request!.sessionId!); yield "B answer";
    }, undefined, undefined, undefined, async () => {
      if (++regexLoads === 1) { prepared.resolve(); await finish.promise; }
      return { version: 1, groups: [] };
    });
    const route = createChatSessionLifecycle("a", storage, (snapshot) => { if (snapshot) mounted.resolve(); }, engine.stop);
    route.mount(true); await mounted.promise;
    const pending = engine.requestReply(session.id);
    await prepared.promise; route.unmount();
    const destination = deferred();
    const nextRoute = createChatSessionLifecycle("b", storage, (snapshot) => { if (snapshot) destination.resolve(); }, engine.stop);
    nextRoute.mount(true);
    try {
      await destination.promise;
      const other = await storage.openSession("b");
      await storage.send(other.id, "B context");
      await engine.requestReply(other.id);
      assert.deepEqual(generated, [other.id]);
      assert.equal((await pending)?.outcome, "stopped");
      finish.resolve(); await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(generated, [other.id]);
      assert.equal((await storage.readSession(session.id)).messages.at(-1)?.status, "cancelled");
      assert.equal((await storage.readSession(other.id)).messages.at(-1)?.content, "B answer");
    } finally { finish.resolve(); await pending; nextRoute.unmount(); }
  });
