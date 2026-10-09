import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, StrictMode, useState } from "react";
import { regressionContract } from "./regression-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function mountEditor(update: () => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/messages/peter", pretendToBeVisual: true,
  });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent"] as const)
    install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  const { createRoot } = await import("react-dom/client");
  const { CustomCSSSettings } = await import("../components/chat/custom-css-settings");
  const { chatStorage } = await import("../lib/chat/storage");
  const originalUpdate = chatStorage.updateSessionSettings;
  chatStorage.updateSessionSettings = async () => update();
  const session = { id: "peter", characterId: "peter", customCSS: "" } as never;
  function Host() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(CustomCSSSettings, { session, onBack: () => setOpen(false) })
      : createElement("div", null,
        createElement("span", null, "Chat Info"),
        createElement("button", { onClick: () => setOpen(true) }, "Open Custom CSS"));
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(createElement(StrictMode, null, createElement(Host))); });
  const click = async (selector: string) => {
    const element = dom.window.document.querySelector<HTMLButtonElement>(selector);
    assert.ok(element, `missing button: ${selector}`);
    await act(async () => { element.click(); });
  };
  return {
    doc: dom.window.document,
    click,
    async closeAndReopen() {
      await click('[aria-label="Back to Chat Info"]');
      assert.match(dom.window.document.body.textContent ?? "", /Chat Info/);
      await click("button");
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      chatStorage.updateSessionSettings = originalUpdate;
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      dom.window.close();
    },
  };
}

regressionContract("chat.custom-css-save-returns-current-editor", "async-race-safety",
  "a successful save returns from the current Custom CSS editor", async () => {
    const pending = deferred<void>();
    const ui = await mountEditor(() => pending.promise);
    try {
      const apply = [...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply");
      assert.ok(apply);
      await act(async () => { apply.click(); });
      await act(async () => { pending.resolve(); await pending.promise; });
      assert.match(ui.doc.body.textContent ?? "", /Chat Info/);
      assert.doesNotMatch(ui.doc.body.textContent ?? "", /Conversation custom CSS/);
    } finally { await ui.unmount(); }
  });

regressionContract("chat.custom-css-stale-success-keeps-reopened-editor", "async-race-safety",
  "an obsolete successful save cannot close a reopened Custom CSS editor", async () => {
    const pending = deferred<void>();
    const ui = await mountEditor(() => pending.promise);
    try {
      const apply = [...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")!;
      await act(async () => { apply.click(); });
      await ui.closeAndReopen();
      await act(async () => { pending.resolve(); await pending.promise; });
      assert.ok(ui.doc.querySelector('[aria-label="Custom CSS"]'));
      assert.equal(ui.doc.querySelector('[role="alert"]'), null);
      assert.equal([...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")?.disabled, false);
    } finally { await ui.unmount(); }
  });

regressionContract("chat.custom-css-stale-failure-is-isolated", "async-race-safety",
  "an obsolete failed save cannot affect a reopened Custom CSS editor", async () => {
    const pending = deferred<void>();
    const ui = await mountEditor(() => pending.promise);
    try {
      const apply = [...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")!;
      await act(async () => { apply.click(); });
      await ui.closeAndReopen();
      await act(async () => { pending.reject(new Error("old save failed")); await pending.promise.catch(() => {}); });
      assert.ok(ui.doc.querySelector('[aria-label="Custom CSS"]'));
      assert.equal(ui.doc.querySelector('[role="alert"]'), null);
      assert.equal([...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")?.disabled, false);
    } finally { await ui.unmount(); }
  });

regressionContract("chat.custom-css-current-failure-is-visible", "async-race-safety",
  "a failed save still reports an error and re-enables the current editor", async () => {
    const pending = deferred<void>();
    const ui = await mountEditor(() => pending.promise);
    try {
      const apply = [...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")!;
      await act(async () => { apply.click(); });
      await act(async () => { pending.reject(new Error("save failed")); await pending.promise.catch(() => {}); });
      assert.ok(ui.doc.querySelector('[aria-label="Custom CSS"]'));
      assert.equal(ui.doc.querySelector('[role="alert"]')?.textContent, "save failed");
      assert.equal([...ui.doc.querySelectorAll("button")].find((button) => button.textContent === "Apply")?.disabled, false);
    } finally { await ui.unmount(); }
  });
