import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import type { ChatMessage } from "../lib/chat/types";
import type { Memory } from "../lib/memory/types";
import { memoryEntryHash } from "../lib/memory/context";

const row = (id: string, journal = false): Memory => ({ id, characterId: "a", kind: journal ? "journal" : "fact",
  text: journal ? "Bring an umbrella." : "Enjoys rainy evenings.", subject: "character", status: "active", origin: journal ? "journal" : "manual",
  sources: [], lineage: {}, fingerprint: id, createdAt: 1, updatedAt: 1, ...(journal ? { keywords: ["rain"] } : {}) });
const message = (refs: ChatMessage["memoryRefs"]): ChatMessage => ({ id: "reply", sessionId: "session", role: "assistant", content: "Hello", createdAt: 1,
  status: "complete", order: 1, memoryRefs: refs });

async function mount(run: (env: { container: HTMLElement; dom: JSDOM; render: (message: ChatMessage) => Promise<void>; reads: string[] }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "localStorage", "Event", "MouseEvent", "KeyboardEvent"] as const) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  saved.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client");
  const { MessageMemory } = await import("../components/chat/message-memory");
  const { browserMemoryStorage } = await import("../lib/memory/instance");
  const originalRows = browserMemoryStorage.listMemories, originalOperations = browserMemoryStorage.listOperations;
  const reads: string[] = [];
  browserMemoryStorage.listMemories = async (id) => { reads.push(id); return [row("long"), row("journal", true)]; };
  browserMemoryStorage.listOperations = async (id) => { reads.push(id); return []; };
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  function Host({ reply }: { reply: ChatMessage }) {
    const [open, setOpen] = useState(false);
    return createElement("div", null, createElement("button", { onClick: () => setOpen(true) }, "Memory"),
      open && createElement(MessageMemory, { key: reply.id, message: reply, characterId: "a", onClose: () => setOpen(false) }));
  }
  try { await run({ container, dom, reads, render: async (reply) => { await act(async () => { root.render(createElement(Host, { reply })); }); } }); }
  finally {
    await act(async () => { root.unmount(); });
    browserMemoryStorage.listMemories = originalRows; browserMemoryStorage.listOperations = originalOperations;
    for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete (globalThis as Record<string, unknown>)[name]; }
    dom.window.close();
  }
}

test("the empty message opens a named Sheet, switches tabs, and closes without leaving text or overlay", async () => {
  await mount(async ({ container, reads, render, dom }) => {
    await render(message([]));
    const opener = container.querySelector<HTMLButtonElement>("button")!;
    opener.focus();
    await act(async () => { opener.click(); });
    const dialog = container.querySelector('[role="dialog"]')!;
    assert.ok(dialog);
    assert.equal(dialog.querySelector("h2")?.textContent, "Long Term Memory");
    assert.equal(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "Long Term Memories");
    assert.match(dialog.querySelector('[role="tabpanel"]')!.textContent!, /No recalled memories yet/);
    const journal = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === "Journal")!;
    await act(async () => { journal.click(); });
    assert.equal(journal.getAttribute("aria-selected"), "true");
    await act(async () => { (dialog as HTMLElement).click(); });
    assert.ok(container.querySelector('[role="dialog"]'), "clicking inside is not dismissal");
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Close Long Term Memory"]')!.click(); });
    assert.equal(container.querySelector(".settings-modal-overlay"), null);
    assert.equal(container.textContent, "Memory");
    assert.equal(dom.window.document.activeElement, opener);
    await act(async () => { opener.click(); });
    assert.equal(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, "Long Term Memories");
    await act(async () => { container.querySelector<HTMLElement>(".settings-modal-overlay")!.click(); });
    assert.equal(container.querySelector('[role="dialog"]'), null);
    await act(async () => { opener.click(); });
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(container.querySelector('[role="dialog"]'), null);
    assert.deepEqual(reads, [], "an empty recall does not read the bank or call a model");
  });
});

test("the Sheet separates the exact linked memory and Journal versions without changing them", async () => {
  const memories = [row("long"), row("journal", true)];
  const refs = await Promise.all(memories.map(async r => ({ id: r.id, hash: await memoryEntryHash(r), ...(r.origin === "journal" ? { journal: true as const } : {}) })));
  await mount(async ({ container, reads, render }) => {
    await render(message(refs));
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const panel = () => container.querySelector('[role="tabpanel"]')!;
    assert.match(panel().textContent!, /Enjoys rainy evenings/);
    assert.doesNotMatch(panel().textContent!, /Bring an umbrella/);
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === "Journal")!.click(); });
    assert.match(panel().textContent!, /Bring an umbrella/);
    assert.doesNotMatch(panel().textContent!, /Enjoys rainy evenings/);
    assert.deepEqual(reads, ["a", "a"], "tab switches reuse the one read, scoped to the Character");
  });
});

test("unrecorded legacy replies use the empty Sheet instead of a permanent chat notice", async () => {
  await mount(async ({ container, render }) => {
    await render(message(undefined));
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
    assert.match(container.querySelector('[role="tabpanel"]')!.textContent!, /No recalled memories yet/);
  });
});
