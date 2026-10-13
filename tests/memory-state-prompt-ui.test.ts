import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { CharacterStatePanel } from "../components/character-state-panel";
import { ChatStorage, chatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { assembleChatPrompt } from "../lib/chat/prompt";
import { createBuiltinPreset, createPresetDocument } from "../lib/preset";
import type { StateView } from "../lib/memory/state-runtime";
import { createChatEngine } from "./chat-engine-fixture";

const character = { characterId: "peter", ...normalizeCharacterInput({ name: "Peter", backstory: "Original student background" }) };
const view = (id = character.characterId, background = character.backstory): StateView => ({ characterId: id, background,
  entries: [{ id: "s", key: "career", value: "Now a full-time scientist", status: "active" },
    { id: "p", key: "home", value: "PENDING PRIVATE VALUE", status: "pending" },
    { id: "c", key: "family", value: "CONFLICT PRIVATE VALUE", status: "suspended" }] });
const foundation = () => ({ ...defaultFoundation(), runtime: { ...defaultFoundation().runtime, timeAware: false }, characters: [character] });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }

test("actual Character marker overlays current facts once, excludes nonactive State, and preserves Memory context", () => {
  const result = assembleChatPrompt(foundation(), character, [], [], { entries: ["Memory and Journal context"] },
    createBuiltinPreset(), new Date(0), undefined, [], undefined, undefined, view());
  const text = result.messages.map((m) => m.content).join("\n");
  assert.equal(text.split("Now a full-time scientist").length - 1, 1);
  assert.equal(text.split(character.backstory!).length - 1, 1);
  assert.match(text, /backgroundBaseline/); assert.match(text, /stateAuthority/);
  assert.match(text, /Memory and Journal context/); assert.doesNotMatch(text, /PRIVATE VALUE/);
  const noState = assembleChatPrompt(foundation(), character, [], [], undefined, undefined, new Date(0));
  const pending = assembleChatPrompt(foundation(), character, [], [], undefined, undefined, new Date(0), undefined, [], undefined, undefined,
    { ...view(), entries: view().entries.filter((r) => r.status !== "active") });
  assert.deepEqual(pending, noState, "pending/conflict only retains existing baseline Prompt exactly");
});

test("disabled or user-role Character markers do not inject State; repeated markers get one overlay", () => {
  const preset = createBuiltinPreset(), marker = preset.prompts.find((p) => p.source === "marker" && p.marker === "character")!;
  marker.role = "user";
  const args = [foundation(), character, [], [], undefined, preset, new Date(0), undefined, [], undefined, undefined, view()] as const;
  assert.doesNotMatch(JSON.stringify(assembleChatPrompt(...args)), /Now a full-time scientist/);
  marker.role = "system"; marker.enabled = false;
  assert.doesNotMatch(JSON.stringify(assembleChatPrompt(...args)), /Now a full-time scientist/);
  marker.enabled = true; preset.promptOrder.push({ identifier: marker.identifier, enabled: true });
  const result = assembleChatPrompt(...args);
  assert.equal(result.messages.map((m) => m.content).join("\n").split("Now a full-time scientist").length - 1, 1);
});

test("engine reads State at request generation and sends one provider call; unavailable State adds no retry", async () => {
  for (const failure of [false, true]) {
    const factory = new IDBFactory(), storage = new ChatStorage(() => factory); let calls = 0, reads = 0, actual = "";
    const engine = createChatEngine(storage, async () => foundation(), async function* (_config, messages) {
      calls++; actual = messages.map((m) => m.content).join("\n"); yield "Hello";
    }, async () => createPresetDocument(), undefined, undefined, undefined, undefined, undefined, undefined,
    async () => {}, async () => undefined, async () => {}, async () => [], async () => { reads++; if (failure) throw Error("read failed"); return view(); });
    const session = await storage.openSession(character.characterId); await engine.send(session.id, "Hi"); await engine.requestReply(session.id);
    assert.equal(reads, 1); assert.equal(calls, 1);
    assert.equal(actual.includes("Now a full-time scientist"), !failure);
  }
});

test("engine cancellation while State is loading cannot dispatch a late provider request", async () => {
  const factory = new IDBFactory(), storage = new ChatStorage(() => factory), pending = deferred<StateView>(), entered = deferred<void>(); let calls = 0;
  const engine = createChatEngine(storage, async () => foundation(), async function* () { calls++; yield "Hello"; }, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined, async () => {}, async () => [],
    async () => { entered.resolve(); return pending.promise; });
  const session = await storage.openSession(character.characterId); await engine.send(session.id, "Hi"); const sending = engine.requestReply(session.id);
  await entered.promise; engine.stop(session.id); pending.resolve(view()); await sending; assert.equal(calls, 0);
});

async function mounted(run: (env: { container: HTMLElement; render: (id?: string, background?: string | null) => Promise<void>;
  loads: ReturnType<typeof deferred<StateView>>[]; unmount: () => Promise<void>; focus: () => Promise<void>; live: () => number }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://veil.test" });
  const keys = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT", "BroadcastChannel"];
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const values = [dom.window, dom.window.document, dom.window.HTMLElement, true, undefined];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: values[index] }));
  const original = chatStorage.subscribe; let live = 0;
  chatStorage.subscribe = () => { live++; return () => { live--; }; };
  const loads: ReturnType<typeof deferred<StateView>>[] = [];
  const load = async () => { const pending = deferred<StateView>(); loads.push(pending); return pending.promise; };
  const { createRoot } = await import("react-dom/client"); const container = dom.window.document.getElementById("root")!, root = createRoot(container); let ended = false;
  const unmount = async () => { if (!ended) { await act(async () => { root.unmount(); }); ended = true; } };
  try {
    await run({ container, loads, live: () => live, unmount,
      render: (id = character.characterId, background = character.backstory) => act(async () => { root.render(createElement(CharacterStatePanel, { character: { characterId: id, backstory: background }, load })); }),
      focus: () => act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); }) });
  } finally {
    await unmount(); chatStorage.subscribe = original; dom.window.close();
    keys.forEach((key, i) => { if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!); else Reflect.deleteProperty(globalThis, key); });
  }
}

test("read-only State UI loads and clearly labels pending/conflict without editing controls", async () => {
  await mounted(async (env) => {
    await env.render(); assert.match(env.container.textContent!, /Loading State/); assert.equal(env.live(), 1);
    await act(async () => { env.loads[0].resolve(view()); });
    assert.match(env.container.textContent!, /Now a full-time scientist/); assert.match(env.container.textContent!, /Pending review · not active/);
    assert.match(env.container.textContent!, /Suspended · not active/); assert.equal(env.container.querySelectorAll("button,input,textarea").length, 0);
    await env.unmount(); assert.equal(env.live(), 0);
  });
});

test("State UI hides the old role and rejects late replies after role/background switch and unmount", async () => {
  await mounted(async (env) => {
    await env.render(); await env.render("other", "Other background");
    await act(async () => { env.loads[0].resolve(view()); }); assert.doesNotMatch(env.container.textContent!, /scientist/);
    await act(async () => { env.loads[1].resolve({ ...view("other", "Other background"), entries: [] }); });
    assert.match(env.container.textContent!, /No lasting changes/);
    await env.render("other", "Changed background"); assert.doesNotMatch(env.container.textContent!, /No lasting changes/);
    await env.unmount(); await act(async () => { env.loads[2].resolve(view()); });
    const calls = env.loads.length; await env.focus(); assert.equal(env.loads.length, calls); assert.equal(env.live(), 0);
  });
});

test("State UI rejects foreign authority, offers Retry and ignores superseded refresh", async () => {
  await mounted(async (env) => {
    await env.render(); await act(async () => { env.loads[0].resolve(view("wrong")); });
    assert.match(env.container.querySelector('[role="alert"]')!.textContent!, /Could not load/);
    await act(async () => { (env.container.querySelector("button") as HTMLButtonElement).click(); });
    await env.focus();
    await act(async () => { env.loads[1].resolve(view()); }); assert.doesNotMatch(env.container.textContent!, /scientist/);
    await act(async () => { env.loads[2].resolve(view()); }); assert.match(env.container.textContent!, /scientist/);
  });
});
