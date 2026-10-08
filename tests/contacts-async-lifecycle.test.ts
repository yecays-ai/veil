import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import { addContact, createContactStorage, normalizeContacts, type ContactDocument } from "../lib/contact-storage";
import { normalizeFoundation } from "../lib/foundation-types";
import { chatStorage } from "../lib/chat/storage";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// The mounted components and their event handlers are real; only their page data and router are fixtures.
let current: Awaited<ReturnType<typeof app>> | undefined;
const foundationHook = { useFoundation: () => ({ document: current!.foundation, ready: true }) };
const contactsHook = { useContacts: () => current!.contacts() };

async function app(hasContacts = true) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/contacts", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "Event"] as const) install(name, dom.window[name]);
  install("self", dom.window);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/foundation-provider")) return foundationHook;
    if (request.endsWith("/use-contacts")) return contactsHook;
    return originalLoad.call(this, request, ...rest);
  };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const foundation = normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }, { characterId: "lan", name: "Lan" }] });
  let document = normalizeContacts(null), fail = false, writes = 0, commits = 0;
  if (hasContacts) for (const character of foundation.characters) document = addContact(document, character.characterId);
  const values = new Map<string, string>([["veil.contacts.v1", JSON.stringify(document)]]);
  const storage = createContactStorage(() => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => {
    if (fail) throw new Error("Quota exceeded");
    writes++; values.set(key, value);
  } }), () => undefined);
  let gate = deferred<void>();
  const operations: Promise<unknown>[] = [];
  const track = <T,>(operation: Promise<T>) => { operations.push(operation); return operation; };
  const commit = (update: (value: ContactDocument) => ContactDocument) => {
    commits++;
    return track((async () => {
      await gate.promise;
      document = await storage.transact(update);
      return document;
    })());
  };
  const pushes: string[] = [];
  const router = { push: (href: string) => pushes.push(href), replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
  const render = async (child: ReactNode) => { await act(async () => {
    root.render(createElement(AppRouterContext.Provider, { value: router as never }, child));
  }); };
  const button = (label: string) => {
    const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
    assert.ok(found, `button ${label} exists`); return found;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); }); };
  const finish = async (action: () => void) => { await act(async () => {
    action();
    await Promise.allSettled(operations);
  }); };
  const cleanup = async () => {
    await finish(() => gate.resolve());
    await act(async () => { root.unmount(); });
    loader._load = originalLoad; dom.window.close(); current = undefined;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  const result = { foundation, contacts: () => ({ document, ready: true, error: "", commit }), pushes, render, click, button, finish, cleanup, track,
    get commits() { return commits; }, get writes() { return writes; }, get document() { return document; },
    release: () => gate.resolve(), failSave: () => { fail = true; },
    retrySave: () => { fail = false; gate = deferred<void>(); }, dom };
  current = result;
  return result;
}

test("Add Contact locks synchronously, reports save failure, then permits a successful retry", { timeout: 3000 }, async () => {
  const ui = await app(false);
  try {
    const { AddContactPage } = await import("../components/contacts-pages");
    await ui.render(createElement(AddContactPage));
    const add = ui.button("Add Contact");
    // Two clicks before React commits the busy render exercise the ref lock, not just disabled UI.
    await act(async () => { add.click(); add.click(); });
    assert.equal(ui.commits, 1);
    assert.equal(ui.button("Adding…").disabled, true);
    ui.failSave(); await ui.finish(ui.release);
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]')?.textContent, "Quota exceeded");
    assert.equal(ui.dom.window.document.querySelector('[role="status"]'), null);
    assert.equal(ui.writes, 0); assert.equal(ui.button("Add Contact").disabled, false);
    ui.retrySave(); await ui.click("Add Contact"); await ui.finish(ui.release);
    assert.equal(ui.commits, 2); assert.equal(ui.writes, 1);
    assert.equal(ui.document.contacts.length, 1);
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null);
    assert.equal(ui.dom.window.document.querySelector('[role="status"]')?.textContent, "Peter added to Contacts.");
    assert.equal(ui.button("Added").disabled, true);
  } finally { await ui.cleanup(); }
});

for (const failure of [false, true]) test(`Add Contact ignores late ${failure ? "failure" : "success"} after leaving and remounting`, { timeout: 3000 }, async () => {
  const ui = await app(false);
  try {
    const { AddContactPage } = await import("../components/contacts-pages");
    await ui.render(createElement(AddContactPage)); await ui.click("Add Contact");
    await ui.render(createElement("p", null, "Destination"));
    await ui.render(createElement(AddContactPage));
    if (failure) ui.failSave();
    await ui.finish(ui.release);
    assert.equal(ui.dom.window.document.querySelector('[role="status"]'), null);
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null);
    assert.equal(ui.writes, failure ? 0 : 1, "a committed write is retained");
    assert.deepEqual(ui.pushes, []);
  } finally { await ui.cleanup(); }
});

for (const operation of ["message", "delete", "group"] as const)
  for (const leave of [false, true])
    for (const failure of [false, true]) test(`${operation}: ${failure ? "failure" : "success"} ${leave ? "after navigation/remount" : "on the active page"}`, { timeout: 3000 }, async () => {
      const ui = await app();
      const gate = deferred<Awaited<ReturnType<typeof chatStorage.openSession>>>();
      const open = chatStorage.openSession, group = chatStorage.createGroupSession;
      let calls = 0;
      chatStorage.openSession = () => { calls++; return ui.track(gate.promise); };
      chatStorage.createGroupSession = () => { calls++; return ui.track(gate.promise); };
      try {
        const { ContactInfo } = await import("../components/contact-info");
        const { CreateGroupPage } = await import("../components/contacts-pages");
        const page = () => operation === "group"
          ? createElement(CreateGroupPage, { characterIds: ["peter", "lan"] })
          : createElement(ContactInfo, { characterId: "peter" });
        await ui.render(page());
        if (operation === "group") {
          const input = ui.dom.window.document.querySelector<HTMLInputElement>('.group-name-field input')!;
          await act(async () => {
            Object.getOwnPropertyDescriptor(ui.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Friends");
            input.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
          });
          await ui.click("Create Group");
        } else if (operation === "delete") {
          await ui.click("Delete Contact");
          await act(async () => { ui.dom.window.document.querySelector<HTMLButtonElement>('dialog .contact-delete')!.click(); });
        } else await ui.click("Message");
        assert.equal(operation === "delete" ? ui.commits : calls, 1, "the operation really started");
        if (leave) { await ui.render(createElement("p", null, "Destination")); await ui.render(page()); }
        if (operation === "delete") {
          if (failure) ui.failSave();
          await ui.finish(ui.release);
        } else await ui.finish(() => failure ? gate.reject(new Error("Storage unavailable")) : gate.resolve({ id: "conversation" } as never));
        assert.deepEqual(ui.pushes, !leave && !failure ? [operation === "message" ? "/messages/peter" : operation === "delete" ? "/contacts" : "/messages/group/conversation"] : []);
        const alert = ui.dom.window.document.querySelector('[role="alert"]');
        if (!leave && failure) assert.match(alert?.textContent ?? "", /Storage unavailable|Quota exceeded/);
        else assert.equal(alert, null);
        if (operation === "delete") assert.equal(ui.document.contacts.some((item) => item.characterId === "peter"), failure);
      } finally {
        gate.resolve({ id: "cleanup" } as never);
        await ui.cleanup(); chatStorage.openSession = open; chatStorage.createGroupSession = group;
      }
    });
