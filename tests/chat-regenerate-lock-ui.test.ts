import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { regressionContract } from "./regression-contract";
import { TEST_API_CONFIG } from "./chat-engine-fixture";
import { lockOrigin } from "./generation-lock-fixture";

regressionContract("chat.regenerate-lock-released-without-session", "async-race-safety",
  "a Regenerate that ends while the room has no session releases its locks, so Regenerate works when the session returns", async () => {
    const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
      url: "http://localhost/messages/a", pretendToBeVisual: true,
    });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
      install(name, dom.window[name]);
    const factory = new IDBFactory();
    const origin = lockOrigin();
    Object.defineProperty(dom.window.navigator, "locks", { value: origin.client() });
    Object.defineProperty(dom.window, "indexedDB", { value: factory });
    install("indexedDB", factory); install("self", dom.window); install("BroadcastChannel", undefined);
    install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
    install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
    install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    install("ResizeObserver", class { observe() {} disconnect() {} });
    install("IS_REACT_ACT_ENVIRONMENT", true);
    dom.window.HTMLElement.prototype.scrollTo = () => {};
    const { createRoot } = await import("react-dom/client");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { ChatRoom } = await import("../components/chat/chat-room");
    const { chatStorage } = await import("../lib/chat/storage");
    const { chatEngine } = await import("../lib/chat/engine");
    const { browserFoundationStorage } = await import("../lib/foundation-storage");
    const { browserApiConfigStorage } = await import("../lib/api-config-storage");
    const { normalizeFoundation } = await import("../lib/foundation-types");
    const document = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }] });
    document.runtime.timeAware = false;
    const load = browserFoundationStorage.load, api = browserApiConfigStorage.getApiConfig;
    const send = chatStorage.send, fetch = globalThis.fetch;
    const root = createRoot(dom.window.document.getElementById("root")!);
    const pendingResponses: Array<() => void> = [];
    let providerCalls = 0;
    const wait = async (condition: () => boolean | Promise<boolean>) => {
      const deadline = Date.now() + 5000;
      while (true) {
        assert.ok(Date.now() < deadline, "mounted UI condition timed out");
        let ready = false;
        await act(async () => { ready = await condition(); if (!ready) await new Promise((resolve) => setTimeout(resolve, 10)); });
        if (ready) return;
      }
    };
    const input = () => dom.window.document.querySelector<HTMLTextAreaElement>("#chat-input")!;
    const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => element.getAttribute("aria-label") === label || element.textContent?.trim() === label)!;
    const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
    const type = async (text: string) => { await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
      input().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    }); };
    try {
      const full = document, without = normalizeFoundation({ characters: [{ characterId: "b", name: "B" }] });
      let current = full; browserFoundationStorage.load = async () => current;
      browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
      globalThis.fetch = async () => {
        providerCalls++;
        if (providerCalls === 2) await new Promise<void>((resolve) => { pendingResponses.push(resolve); });
        return Response.json({ choices: [{ message: { content: providerCalls === 1 ? "First answer" : providerCalls === 2 ? "Late" : "Replacement" }, finish_reason: "stop" }] });
      };
      const session = await chatStorage.openSession("a");
      await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId: "a" }))); });
      await wait(() => !!input() && !input().disabled);
      await type("Question"); await click(button("Request Reply"));
      await wait(async () => (await chatStorage.readSession(session.id)).messages.some((m) => m.content === "First answer" && m.status === "complete"));
      await wait(() => !button("Stop reply"));
      const reply = (await chatStorage.readSession(session.id)).messages.find((m) => m.content === "First answer")!;
      await wait(() => !!dom.window.document.querySelector(`[data-message-id="${reply.id}"] .chat-bubble`));
      const openActions = () => click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${reply.id}"] .chat-bubble`)!);
      await openActions(); await click(button("Regenerate"));
      await wait(() => pendingResponses.length === 1);
      // The room's Character vanishes from a Foundation refresh while Regenerate is in flight.
      current = without; await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
      await wait(() => !chatEngine.isGenerating(session.id));
      await wait(() => !input() || input().disabled || !button("Stop reply"));
      // The Character returns; the session is the same one and characterId never changed.
      current = full; await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
      await wait(() => !!input() && !input().disabled);
      await act(async () => { pendingResponses.shift()?.(); await new Promise<void>((resolve) => setImmediate(resolve)); });
      await wait(() => !button("Stop reply"));
      await wait(() => !!dom.window.document.querySelector(`[data-message-id="${reply.id}"] .chat-bubble`)
        || !!dom.window.document.querySelector("[data-message-id]"));
      const target = (await chatStorage.readSession(session.id)).messages.filter((m) => m.role === "assistant").at(-1)!;
      await click(dom.window.document.querySelector<HTMLElement>(`[data-message-id="${target.id}"] .chat-bubble`)!);
      const regenerate = button("Regenerate");
      assert.ok(regenerate, "message actions open");
      assert.equal(regenerate.disabled, false, "a Regenerate that ended while the room had no session must not leave the lock set");
      assert.equal(button("Stop reply"), undefined, "the room is not stuck in a generating state");
      // An enabled button does not prove the lock is clear: Regenerate again and require a finished replacement.
      const callsBefore = providerCalls;
      await click(regenerate);
      await wait(async () => (await chatStorage.readSession(session.id)).messages.some((m) => m.content === "Replacement" && m.status === "complete"));
      await wait(() => !button("Stop reply"));
      assert.equal(providerCalls, callsBefore + 1, "exactly one new request was made by the second Regenerate");
      const finalMessages = (await chatStorage.readSession(session.id)).messages;
      assert.equal(finalMessages.filter((m) => m.content === "Replacement").length, 1);
      assert.ok(finalMessages.every((m) => m.status !== "streaming"));
    } finally {
      pendingResponses.forEach((resolve) => resolve());
      await act(async () => { root.unmount(); });
      chatStorage.send = send; browserFoundationStorage.load = load; browserApiConfigStorage.getApiConfig = api;
      globalThis.fetch = fetch; dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function mountedRoom() {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', {
    url: "http://localhost/messages/a", pretendToBeVisual: true,
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
    install(name, dom.window[name]);
  const factory = new IDBFactory();
  Object.defineProperty(dom.window.navigator, "locks", { value: lockOrigin().client() });
  Object.defineProperty(dom.window, "indexedDB", { value: factory });
  install("indexedDB", factory); install("self", dom.window); install("BroadcastChannel", undefined);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLElement.prototype.scrollTo = () => {};

  const { createRoot } = await import("react-dom/client");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { ChatRoom } = await import("../components/chat/chat-room");
  const { chatStorage } = await import("../lib/chat/storage");
  const { chatEngine } = await import("../lib/chat/engine");
  const { browserFoundationStorage } = await import("../lib/foundation-storage");
  const { browserApiConfigStorage } = await import("../lib/api-config-storage");
  const { normalizeFoundation } = await import("../lib/foundation-types");
  const full = normalizeFoundation({ characters: [{ characterId: "a", name: "A" }, { characterId: "b", name: "B" }] });
  const withoutA = normalizeFoundation({ characters: [{ characterId: "b", name: "B" }] });
  full.runtime.timeAware = false;
  let current = full;
  const original = {
    load: browserFoundationStorage.load, api: browserApiConfigStorage.getApiConfig,
    send: chatEngine.send, reply: chatEngine.requestReply,
    storageSend: chatStorage.send, fetch: globalThis.fetch,
  };
  browserFoundationStorage.load = async () => current;
  browserApiConfigStorage.getApiConfig = async () => ({ ...TEST_API_CONFIG, name: "Test", provider: "Custom" });
  const a = await chatStorage.openSession("a"), b = await chatStorage.openSession("b");
  await chatStorage.clearSession(a.id); await chatStorage.clearSession(b.id);
  const root = createRoot(dom.window.document.getElementById("root")!);
  const held: Array<() => void> = [];
  const hold = <T,>() => {
    const gate = deferred<T>(); held.push(() => gate.resolve(null as T)); return gate;
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const wait = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, "mounted room condition timed out");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  const input = () => dom.window.document.querySelector<HTMLTextAreaElement>("#chat-input");
  const button = (label: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
    .find((element) => element.getAttribute("aria-label") === label);
  const click = async (label: string) => {
    const target = button(label); assert.ok(target, `${label} button exists`);
    await act(async () => { target.click(); });
  };
  const type = async (value: string) => {
    const target = input(); assert.ok(target, "composer exists");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(target, value);
      target.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  };
  const render = async (characterId: string, key?: string) => {
    await act(async () => { root.render(createElement(FoundationProvider, null, createElement(ChatRoom, { characterId, key }))); });
    await wait(() => !!input() && !input()!.disabled);
  };
  const refresh = async (document: typeof full) => {
    current = document;
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); });
  };
  const settle = async <T,>(gate: ReturnType<typeof deferred<T>>, value: T) => {
    await act(async () => { gate.resolve(value); await gate.promise; await flush(); });
  };
  const close = async () => {
    held.forEach((release) => release());
    await act(async () => { root.unmount(); await flush(); });
    browserFoundationStorage.load = original.load;
    browserApiConfigStorage.getApiConfig = original.api;
    chatEngine.send = original.send; chatEngine.requestReply = original.reply;
    chatStorage.send = original.storageSend; globalThis.fetch = original.fetch;
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { a, b, full, withoutA, chatEngine, chatStorage, dom, input, button, click, type, render, refresh, settle, hold, wait, close };
}

regressionContract("chat.unsaved-draft-explicit-retry", "async-race-safety",
  "CF-02: Retry after draft-save failure answers the original question exactly once", async () => {
    const ui = await mountedRoom(); const send = ui.chatStorage.send.bind(ui.chatStorage);
    const prompts: Array<{ role: string; content: string }[]> = []; let fail = true;
    try {
      ui.chatStorage.send = async (...args) => {
        if (fail) { fail = false; throw new Error("Draft save unavailable"); }
        return send(...args);
      };
      globalThis.fetch = async (_url, init) => {
        prompts.push(JSON.parse(String(init?.body)).messages);
        return Response.json({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }] });
      };
      await ui.render("a"); await ui.type("Original question"); await ui.click("Request Reply");
      await ui.wait(() => !ui.chatEngine.isGenerating(ui.a.id) && ui.dom.window.document.body.textContent!.includes("Draft save unavailable"));
      assert.ok(ui.button("Retry draft"), "a failed unsaved question has an explicit Retry");
      assert.equal(prompts.length, 0);
      await ui.type("Newer unsaved text"); await ui.click("Retry draft");
      await ui.wait(() => !ui.chatEngine.isGenerating(ui.a.id) && !ui.button("Stop reply"));
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].filter((m) => m.role === "user" && m.content.includes("Original question")).length, 1);
      const messages = (await ui.chatStorage.readSession(ui.a.id)).messages;
      assert.deepEqual(messages.filter((m) => m.role === "user").map((m) => m.content), ["Original question"]);
      assert.equal(messages.filter((m) => m.role === "assistant").length, 1);
      assert.equal(ui.input()?.value, "Newer unsaved text", "Retry cannot clear a later edit");
    } finally { await ui.close(); }
  });

for (const boundary of ["navigation", "page-remount"])
  regressionContract(`chat.unsaved-draft-${boundary}-boundary`, "async-race-safety",
    "CF-02: unsaved recovery is page-local and cannot expose a contextless persisted Retry", async () => {
      const ui = await mountedRoom();
      try {
        ui.chatStorage.send = async () => { throw new Error("Draft save unavailable"); };
        await ui.render("a"); await ui.type("Original question"); await ui.click("Request Reply");
        await ui.wait(() => !ui.chatEngine.isGenerating(ui.a.id) && ui.dom.window.document.body.textContent!.includes("Draft save unavailable"));
        assert.ok(ui.button("Retry draft"));
        if (boundary === "navigation") await ui.render("b");
        await ui.render("a", boundary === "page-remount" ? "fresh-page" : undefined);
        assert.equal(ui.button("Retry draft"), undefined);
        assert.deepEqual((await ui.chatStorage.readSession(ui.a.id)).messages, []);
      } finally { await ui.close(); }
    });

for (const edited of [false, true])
  regressionContract(`chat.saved-reply-draft-${edited ? "preserves-edit" : "clears-on-return"}`, "async-race-safety",
    "CF-03: a late Reply save clears only its own draft revision after the session returns", async () => {
      const ui = await mountedRoom(); const gate = ui.hold<void>();
      const send = ui.chatStorage.send.bind(ui.chatStorage); let saved = false;
      try {
        ui.chatStorage.send = async (...args) => { const message = await send(...args); saved = true; await gate.promise; return message; };
        await ui.render("a"); await ui.type("Reply draft"); await ui.click("Request Reply");
        await ui.wait(() => saved);
        if (edited) { await ui.type("Changed"); await ui.type("Reply draft"); }
        await ui.refresh(ui.withoutA); await ui.wait(() => !ui.input() || !!ui.input()?.disabled);
        await ui.wait(() => !ui.chatEngine.isGenerating(ui.a.id));
        await ui.settle(gate, undefined);
        await ui.refresh(ui.full); await ui.wait(() => !!ui.input() && !ui.input()!.disabled);
        assert.equal(ui.input()?.value, edited ? "Reply draft" : "", "cleanup respects edit version, even for identical text");
        if (!edited) { assert.equal(ui.button("Send")?.disabled, true); await ui.click("Send"); }
        assert.equal((await ui.chatStorage.readSession(ui.a.id)).messages.filter((m) => m.role === "user").length, 1);
      } finally { await ui.close(); }
    });

regressionContract("chat.reply-lock-released-without-session", "async-race-safety",
  "Reply finishing while the room temporarily lacks a session releases its own lock", async () => {
    const ui = await mountedRoom();
    const pending = ui.hold<Awaited<ReturnType<typeof ui.chatEngine.requestReply>>>();
    const calls: string[] = [];
    try {
      ui.chatEngine.requestReply = (sessionId) => {
        calls.push(sessionId);
        return calls.length === 1 ? pending.promise : Promise.resolve(null);
      };
      await ui.render("a"); await ui.type("Question"); await ui.click("Request Reply");
      assert.deepEqual(calls, [ui.a.id]);
      await ui.refresh(ui.withoutA); await ui.wait(() => !ui.input() || !!ui.input()?.disabled);
      await ui.settle(pending, null);
      await ui.refresh(ui.full); await ui.wait(() => !!ui.input() && !ui.input()!.disabled);
      assert.equal(ui.button("Stop reply"), undefined, "generating state is released while the session is absent");
      await ui.click("Request Reply");
      assert.deepEqual(calls, [ui.a.id, ui.a.id], "the old replyLock does not block the next Reply");
    } finally { await ui.close(); }
  });

regressionContract("chat.send-lock-released-without-session", "async-race-safety",
  "a saved Send clears its draft when the original session returns, without a duplicate Send", async () => {
    const ui = await mountedRoom();
    const pending = ui.hold<void>();
    const calls: string[] = [];
    try {
      ui.chatEngine.send = async (sessionId, content, quoteMessageId) => {
        calls.push(sessionId);
        await pending.promise;
        return ui.chatStorage.send(sessionId, content, quoteMessageId);
      };
      await ui.render("a"); await ui.type("Draft"); await ui.click("Send");
      assert.deepEqual(calls, [ui.a.id]);
      await ui.refresh(ui.withoutA); await ui.wait(() => !ui.input() || !!ui.input()?.disabled);
      await ui.settle(pending, undefined);
      await ui.refresh(ui.full); await ui.wait(() => !!ui.input() && !ui.input()!.disabled);
      await ui.wait(() => ui.input()?.value === "");
      assert.equal(ui.button("Send")?.disabled, true, "a saved draft cannot be sent again after its session returns");
      await ui.click("Send");
      assert.deepEqual(calls, [ui.a.id], "the completed Send is not duplicated");
      assert.equal((await ui.chatStorage.readSession(ui.a.id)).messages.filter((message) => message.content === "Draft").length, 1);
    } finally { await ui.close(); }
  });

regressionContract("chat.saved-send-preserves-other-session-draft", "async-race-safety",
  "a saved Send cannot clear a different session's identical draft", async () => {
    const ui = await mountedRoom();
    const pending = ui.hold<void>();
    try {
      ui.chatEngine.send = async (sessionId, content, quoteMessageId) => {
        await pending.promise;
        return ui.chatStorage.send(sessionId, content, quoteMessageId);
      };
      await ui.render("a"); await ui.type("Same text"); await ui.click("Send");
      await ui.render("b"); await ui.type("B's draft"); await ui.type("Same text");
      await ui.settle(pending, undefined);
      assert.equal(ui.input()?.value, "Same text", "B's draft survives A's successful save");
      await ui.render("a");
      assert.equal(ui.input()?.value, "Same text", "returning to A must not clear text B edited");
      assert.equal((await ui.chatStorage.readSession(ui.a.id)).messages.filter((message) => message.content === "Same text").length, 1);
      assert.equal((await ui.chatStorage.readSession(ui.b.id)).messages.length, 0);
    } finally { await ui.close(); }
  });

for (const action of ["Reply", "Send"] as const)
  regressionContract(`chat.${action.toLowerCase()}-lock-owned-by-current-session`, "async-race-safety",
    `an old ${action} completion cannot release the new session's lock`, async () => {
      const ui = await mountedRoom();
      const old = ui.hold<never>(), current = ui.hold<never>();
      const calls: string[] = [];
      try {
        if (action === "Reply") ui.chatEngine.requestReply = (sessionId) => {
          calls.push(sessionId); return sessionId === ui.a.id ? old.promise : current.promise;
        };
        else ui.chatEngine.send = (sessionId) => {
          calls.push(sessionId); return sessionId === ui.a.id ? old.promise : current.promise;
        };
        await ui.render("a"); await ui.type("A draft"); await ui.click(action === "Reply" ? "Request Reply" : "Send");
        await ui.render("b"); await ui.type("B draft"); await ui.click(action === "Reply" ? "Request Reply" : "Send");
        assert.deepEqual(calls, [ui.a.id, ui.b.id]);
        await ui.settle(old, null as never);
        if (action === "Reply") assert.ok(ui.button("Stop reply"), "B must remain generating while its Reply is pending");
        else assert.equal(ui.button("Send")?.disabled, true, "B must remain sending while its Send is pending");
        assert.equal(ui.input()?.value, "B draft", "the old completion cannot clear B's draft");
        await ui.settle(current, null as never);
        if (action === "Reply") assert.equal(ui.button("Stop reply"), undefined);
        else assert.equal(ui.button("Send")?.disabled, true, "B's completed Send clears its own draft");
      } finally { await ui.close(); }
    });

