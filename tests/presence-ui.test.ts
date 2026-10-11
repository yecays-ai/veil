import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

const HOUR = 3_600_000;
const character = { characterId: "a", timezone: "UTC" };

async function withDom(run: (env: { container: HTMLElement; storage: Storage }) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "StorageEvent", "localStorage"] as const) install(name, dom.window[name]);
  install("self", dom.window);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  try { await run({ container: dom.window.document.getElementById("root")!, storage: dom.window.localStorage }); }
  finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
    }
    dom.window.close();
  }
}
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

test("the presence line shows status and Last Seen after loading, keeps its place while loading, persists the derived online time, and writes nothing for an unknown Character", async () => {
  await withDom(async ({ container, storage }) => {
    const { createRoot } = await import("react-dom/client");
    const { CharacterPresenceLine, CharacterPresenceBadge } = await import("../components/presence");
    const { PRESENCE_STORAGE_KEY } = await import("../lib/presence/storage");
    const now = Date.now();
    // Unreadable data is not "loaded": nothing is shown, nothing is written, and a later mount reads again.
    storage.setItem(PRESENCE_STORAGE_KEY, "{not json");
    const broken = createRoot(container);
    await act(async () => { broken.render(createElement(CharacterPresenceLine, { character })); });
    await settle();
    assert.equal(container.querySelector(".contact-presence")!.textContent, "");
    assert.equal(container.querySelector(".presence-badge"), null);
    assert.equal(storage.getItem(PRESENCE_STORAGE_KEY), "{not json");
    await act(async () => { broken.unmount(); });
    storage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify({ version: 1, characters: [{ characterId: "a",
      routine: { routine: { blocks: [], defaultStatus: "online", jitterMinutes: 0 }, changedAt: 1, source: null },
      situations: [{ status: "busy", reason: null, startsAt: now - HOUR, endsAt: now + HOUR, changedAt: now - HOUR, source: null }],
      signature: null, situationChange: null, lastOnlineAt: now - 3 * HOUR, lastMessageAt: null }, ] }));
    const root = createRoot(container);
    try {
      await act(async () => { root.render(createElement("div", null, createElement(CharacterPresenceLine, { character }),
        createElement(CharacterPresenceBadge, { character }))); });
      // First render, before the stored data has been read: the line exists but says nothing.
      const line = container.querySelector(".contact-presence")!;
      assert.ok(line);
      await settle();
      assert.equal(container.querySelector(".contact-presence") === line, true, "the line is updated in place");
      assert.equal(line.textContent, "Busy · Last seen 1h ago");
      assert.equal(container.querySelectorAll(".presence-busy").length, 2, "line and badge show the same status");
      const stored = JSON.parse(storage.getItem(PRESENCE_STORAGE_KEY)!).characters[0];
      assert.ok(stored.lastOnlineAt > now - 3 * HOUR && stored.lastOnlineAt <= now - HOUR + 1_000, "the later derived online time was persisted");
      // A Character with no stored data reads Offline, and viewing it writes nothing.
      const before = storage.getItem(PRESENCE_STORAGE_KEY);
      await act(async () => { root.render(createElement(CharacterPresenceLine, { character: { characterId: "unknown", timezone: null } })); });
      await settle();
      assert.equal(container.querySelector(".contact-presence")!.textContent, "Offline");
      assert.equal(storage.getItem(PRESENCE_STORAGE_KEY), before);
    } finally { await act(async () => { root.unmount(); }); }
  });
});

test("the chat header keeps one status line for a contact, empty or filled, and none for the loading title", async () => {
  await withDom(async ({ container }) => {
    const { createRoot } = await import("react-dom/client");
    const { ChatHeader } = await import("../components/chat/chat-header");
    const root = createRoot(container);
    const contact = { characterId: "a", name: "Ada", profile: { name: "Ada", avatar: null } };
    const render = (props: { contact: typeof contact | null; status?: string }) => act(async () => {
      root.render(createElement(ChatHeader, { ...props, settingsTrigger: { current: null } }));
    });
    try {
      await render({ contact: null });
      assert.equal(container.querySelector(".chat-contact-status"), null);
      await render({ contact, status: "" });
      const status = container.querySelector(".chat-contact-status")!;
      assert.equal(status.textContent, "");
      assert.equal(container.querySelector(".chat-contact-text strong")!.textContent, "Ada");
      assert.equal(container.querySelector("a.chat-contact-summary")!.getAttribute("aria-label"), "Open Contact Info for Ada");
      await render({ contact, status: "Busy · Last seen 1h ago" });
      assert.equal(container.querySelector("a.chat-contact-summary")!.getAttribute("aria-label"), "Open Contact Info for Ada, Busy · Last seen 1h ago");
      assert.equal(container.querySelector(".chat-contact-status") === status, true, "the status line is updated in place");
      assert.equal(status.textContent, "Busy · Last seen 1h ago");
    } finally { await act(async () => { root.unmount(); }); }
  });
});
