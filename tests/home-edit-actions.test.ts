import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Part 5 F11: Add Widget and Edit Pages have no behaviour yet, so they must not look usable.
async function mount(props: { disabled?: boolean } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement"] as const) install(name, dom.window[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  // React reads the DOM at import time, so it has to load after the jsdom globals exist.
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { HomeEditShell } = await import("../components/home-edit-shell");
  const calls = { done: 0, added: [] as string[] };
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(createElement(HomeEditShell, {
    onDone: () => { calls.done++; },
    onAddApp: async (id) => { calls.added.push(id); return null; },
    availableApps: [],
    disabled: props.disabled ?? false,
  })));
  const button = (label: string) => [...dom.window.document.querySelectorAll("button")]
    .find((item) => item.textContent === label) as HTMLButtonElement | undefined;
  const click = async (label: string) => act(async () => { button(label)!.click(); });
  return {
    calls, button, click,
    $: (selector: string) => dom.window.document.querySelector(selector),
    html: () => dom.window.document.body.innerHTML,
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

test("Add Widget and Edit Pages are disabled and clicking them does nothing", async () => {
  const h = await mount();
  try {
    await h.click("Edit");
    for (const label of ["Add Widget", "Edit Pages"]) {
      const item = h.button(label)!;
      assert.ok(item, `${label} is listed`);
      assert.equal(item.disabled, true, `${label} must not look usable`);
    }
    const before = h.html();
    await h.click("Add Widget"); await h.click("Edit Pages");
    assert.equal(h.html(), before, "a click on an unimplemented action changes nothing");
    assert.equal(h.calls.done, 0);
  } finally { await h.cleanup(); }
});

test("the working actions still work: Edit toggles the menu, Add App opens the picker, Done leaves", async () => {
  const h = await mount();
  try {
    assert.equal(h.$(".home-edit-menu"), null);
    await h.click("Edit");
    assert.ok(h.$(".home-edit-menu"), "Edit opens the menu");
    assert.equal(h.button("Add App")!.disabled, false);
    await h.click("Add App");
    assert.equal(h.$(".home-edit-menu"), null, "choosing Add App closes the menu");
    assert.ok(h.$('[role="dialog"][aria-label="Add App"]'), "and opens the Add App picker");
    assert.match(h.html(), /All apps are on Home/);
    await h.click("Close");
    assert.equal(h.$('[role="dialog"]'), null);
    await h.click("Edit"); await h.click("Edit");
    assert.equal(h.$(".home-edit-menu"), null, "Edit toggles the menu closed again");
    await h.click("Done");
    assert.equal(h.calls.done, 1, "Done calls onDone once");
  } finally { await h.cleanup(); }
});

test("while Home is busy Edit and Done are disabled", async () => {
  const h = await mount({ disabled: true });
  try {
    assert.equal(h.button("Edit")!.disabled, true);
    assert.equal(h.button("Done")!.disabled, true);
  } finally { await h.cleanup(); }
});
