import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import test from "node:test";
import type { ChatMessage } from "../lib/chat/types";

test("gift card opens its full-content dialog with keyboard activation", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/messages/peter", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "KeyboardEvent"] as const)
    install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  const { createRoot } = await import("react-dom/client");
  const { GiftCard } = await import("../components/chat/gifts/gift-card");
  const message: ChatMessage = {
    id: "gift-1", sessionId: "session-1", role: "assistant", content: "gift", status: "complete",
    createdAt: 1, order: 1,
    gift: { icon: "🎁", content: "The complete custom gift description", sender: "assistant", recipient: "user", status: "pending" },
  };
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(GiftCard, {
      message, actor: "user", characterName: "Peter", onAction: () => {}, onOpenActions: () => {},
      onPointerDown: () => {}, onContextMenu: () => {},
    })); });
    const card = container.querySelector<HTMLElement>('.chat-gift-card[role="button"]')!;
    assert.equal(card.tabIndex, 0);
    await act(async () => { card.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent ?? "", /The complete custom gift description/);
    await act(async () => { container.querySelector<HTMLButtonElement>(".chat-gift-detail-close")!.click(); });
    await act(async () => { card.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })); });
    assert.match(container.querySelector<HTMLElement>('[role="dialog"]')?.textContent ?? "", /The complete custom gift description/);
  } finally {
    await act(async () => { root.unmount(); });
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});
