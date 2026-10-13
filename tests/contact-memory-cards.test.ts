import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { chatStorage } from "../lib/chat/storage";
import type { StateView } from "../lib/memory/state-runtime";
import type { MemoryStorage } from "../lib/memory/storage";
import type { Memory } from "../lib/memory/types";

const row = (over: Partial<Memory>) => ({ status: "active", origin: "auto", ...over }) as Memory;
const entry = (id: string, key: string, value: string, status: StateView["entries"][number]["status"] = "active") => ({ id, key, value, status });
const stateOf = (characterId: string, entries: StateView["entries"]): StateView => ({ characterId, background: "Background", entries });

type Props = { character: { characterId: string; backstory: string }; disabled?: boolean; storage: MemoryStorage; loadState: (c: { characterId: string }) => Promise<StateView> };
async function mount(run: (env: { root: HTMLElement; render: (props: Props) => Promise<void> }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const names = ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "IS_REACT_ACT_ENVIRONMENT", "BroadcastChannel"];
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach((name) => Object.defineProperty(globalThis, name, { configurable: true, writable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "BroadcastChannel" ? undefined : dom.window[name as keyof typeof dom.window] }));
  const originalSubscribe = chatStorage.subscribe; chatStorage.subscribe = () => () => undefined;
  const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...args) { return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...args); };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { ContactMemoryCards } = await import("../components/contact-memory-cards");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const router = { bfcacheId: "contact-cards-test", push() {}, back() {}, replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const root = dom.window.document.getElementById("root")!, react = createRoot(root);
  try {
    await run({ root, render: (props) => act(async () => react.render(createElement(AppRouterContext.Provider, { value: router }, createElement(PathnameContext.Provider, { value: "/contacts/c" }, createElement(ContactMemoryCards, props))))) });
  } finally {
    await act(async () => react.unmount());
    loader._load = originalLoad; chatStorage.subscribe = originalSubscribe; dom.window.close();
    names.forEach((name, i) => previous[i] ? Object.defineProperty(globalThis, name, previous[i]!) : delete (globalThis as Record<string, unknown>)[name]);
  }
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const memories = (rows: Memory[]) => ({ listMemories: async () => rows }) as unknown as MemoryStorage;

test("Contact Info cards show the Active count and a short State preview, each linking into the Memory app", async () => {
  await mount(async ({ root, render }) => {
    const entries = [entry("1", "home", "Lives in Queens"), entry("2", "job", "Teacher"), entry("3", "pet", "Has a cat"), entry("4", "car", "Drives a van"),
      entry("5", "plan", "Pending item", "pending")];
    await render({ character: { characterId: "c 1", backstory: "Background" }, storage: memories([row({}), row({ origin: "journal" }), row({ status: "superseded" }), row({ origin: "manual" })]),
      loadState: async () => stateOf("c 1", entries) });
    await settle();
    const text = root.textContent!;
    assert.match(text, /2 memories/, "Journal and replaced memories are not counted");
    assert.match(text, /home: Lives in Queens/); assert.match(text, /\+1 more/, "only three entries are previewed; pending is not current");
    assert.doesNotMatch(text, /Pending item|Drives a van/);
    assert.deepEqual([...root.querySelectorAll("a")].map((a) => a.getAttribute("href")), ["/memory/c%201?tab=state", "/memory/c%201?tab=memories"]);
    assert.equal(root.querySelectorAll("input, textarea").length, 0, "State is read-only here");
  });
});

test("Contact Info cards report failed reads instead of showing 0 or an empty State", async () => {
  await mount(async ({ root, render }) => {
    await render({ character: { characterId: "c", backstory: "Background" }, storage: { listMemories: async () => { throw new Error("x"); } } as unknown as MemoryStorage,
      loadState: async () => { throw new Error("y"); } });
    await settle();
    assert.match(root.textContent!, /Unavailable/); assert.match(root.textContent!, /Could not load State/);
    assert.doesNotMatch(root.textContent!, /0 memories|No lasting changes/);
  });
});

test("switching Contact never shows the previous Character's count or State, and a pending page has no links", async () => {
  await mount(async ({ root, render }) => {
    const slow = new Promise<Memory[]>(() => undefined);
    await render({ character: { characterId: "a", backstory: "Background" }, storage: memories([row({}), row({})]), loadState: async () => stateOf("a", [entry("1", "home", "A-home")]) });
    await settle(); assert.match(root.textContent!, /2 memories/); assert.match(root.textContent!, /A-home/);
    await render({ character: { characterId: "b", backstory: "Background" }, storage: { listMemories: () => slow } as unknown as MemoryStorage,
      loadState: () => new Promise(() => undefined), disabled: true });
    assert.doesNotMatch(root.textContent!, /2 memories|A-home/);
    assert.equal(root.querySelectorAll("a").length, 0, "inert while the Contact page is pending or being edited");
  });
});
