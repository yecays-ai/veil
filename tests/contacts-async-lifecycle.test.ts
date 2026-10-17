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
let imageReader: () => Promise<string> = async () => "data:image/png;base64,old";

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
  // Contact Info's Shared Media listens to chat storage; an open BroadcastChannel would keep the test process alive.
  install("BroadcastChannel", undefined);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/foundation-provider")) return foundationHook;
    if (request.endsWith("/use-contacts")) return contactsHook;
    // The Memory shortcuts open their own stores; this suite covers Contact Info's own async lifecycle.
    if (request.endsWith("/contact-memory-cards")) return { ContactMemoryCards: () => null };
    if (request.endsWith("/theme-storage")) return { readImage: () => imageReader() };
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
    setImageReader: (reader: () => Promise<string>) => { imageReader = reader; },
    retrySave: () => { fail = false; gate = deferred<void>(); }, dom };
  current = result;
  return result;
}

test("ContactInfo resets contact-owned state and ignores old work when characterId changes in place", { timeout: 3000 }, async () => {
  const ui = await app();
  const open = chatStorage.openSession;
  const pendingImage = deferred<string>();
  const pendingMessage = deferred<Awaited<ReturnType<typeof chatStorage.openSession>>>();
  let messageRequest = pendingMessage;
  try {
    const { ContactInfo } = await import("../components/contact-info");
    ui.setImageReader(() => pendingImage.promise);
    chatStorage.openSession = () => ui.track(messageRequest.promise);
    const render = (characterId: string) => ui.render(createElement(ContactInfo, { characterId }));

    await render("peter"); await ui.click("Edit");
    const name = ui.dom.window.document.querySelector<HTMLInputElement>(".contact-hero-name-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(ui.dom.window.HTMLInputElement.prototype, "value")!.set!.call(name, "Peter draft");
      name.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
    });

    await ui.click("Save");
    assert.equal(ui.button("Save").disabled, true, "the old contact save is pending");
    await render("lan");
    assert.equal(ui.dom.window.document.querySelector(".contact-hero-name-input"), null, "the previous contact draft is cleared");
    assert.equal(ui.button("Edit").disabled, false, "busy state does not carry to the new contact");
    await ui.click("Edit");
    const lanName = ui.dom.window.document.querySelector<HTMLInputElement>(".contact-hero-name-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(ui.dom.window.HTMLInputElement.prototype, "value")!.set!.call(lanName, "Lan draft");
      lanName.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
    });
    await ui.finish(ui.release);
    assert.equal(ui.dom.window.document.querySelector<HTMLInputElement>(".contact-hero-name-input")?.value, "Lan draft",
      "the old save completion cannot clear the new contact draft");
    assert.equal(ui.document.contacts.find((item) => item.characterId === "peter")?.remark, "Peter draft");
    assert.notEqual(ui.document.contacts.find((item) => item.characterId === "lan")?.remark, "Peter draft",
      "the in-flight save remains scoped to the contact that started it");

    await ui.click("Cancel");
    await render("peter"); await ui.click("Edit");
    const picker = ui.dom.window.document.querySelector<HTMLInputElement>(".contact-hero-background-input")!;
    Object.defineProperty(picker, "files", { configurable: true, value: [new ui.dom.window.File(["image"], "old.png", { type: "image/png" })] });
    await act(async () => { picker.dispatchEvent(new ui.dom.window.Event("change", { bubbles: true })); });
    assert.equal(ui.dom.window.document.querySelector('[role="status"]')?.textContent, "Opening image…");

    await render("lan");
    assert.equal(ui.dom.window.document.querySelector(".contact-hero-name-input"), null, "the previous contact draft is cleared");
    assert.equal(ui.dom.window.document.querySelector(".contact-hero-identity h1")?.textContent, "Lan");
    assert.equal(ui.dom.window.document.querySelector('[role="status"]'), null, "image-reading state is cleared");
    assert.equal(ui.button("Edit").disabled, false, "the new contact is interactive");
    await act(async () => { pendingImage.resolve("data:image/png;base64,late"); await pendingImage.promise; });
    await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    assert.equal(ui.dom.window.document.querySelector("[role=dialog]"), null, "the old image cannot open a crop dialog");

    await render("peter"); await ui.click("Edit");
    ui.setImageReader(async () => "data:image/png;base64,crop");
    const cropPicker = ui.dom.window.document.querySelector<HTMLInputElement>(".contact-hero-background-input")!;
    Object.defineProperty(cropPicker, "files", { configurable: true, value: [new ui.dom.window.File(["image"], "crop.png", { type: "image/png" })] });
    await act(async () => { cropPicker.dispatchEvent(new ui.dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setImmediate(resolve)); });
    assert.equal(ui.dom.window.document.querySelector("#image-crop-title")?.textContent, "Adjust Hero Background");
    await render("lan");
    assert.equal(ui.dom.window.document.querySelector("#image-crop-title"), null, "an open crop dialog is cleared when switching contacts");

    await render("peter"); await ui.click("Delete Contact");
    assert.ok(ui.dom.window.document.querySelector("dialog"), "delete dialog opens for the current contact");
    await render("lan");
    assert.equal(ui.dom.window.document.querySelector("dialog"), null, "delete dialog state does not cross contacts");

    await render("peter"); await ui.click("Message");
    assert.equal(ui.button("Message").disabled, true, "message action marks the current contact busy");
    await render("lan");
    assert.equal(ui.button("Message").disabled, false, "old busy state is reset for the new contact");
    pendingMessage.reject(new Error("old contact failed"));
    await act(async () => { await Promise.allSettled([pendingMessage.promise]); });
    await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null, "old failure cannot publish on the new contact");
    assert.deepEqual(ui.pushes, [], "old operation cannot navigate using the new contact");

    const currentFailure = deferred<Awaited<ReturnType<typeof chatStorage.openSession>>>();
    messageRequest = currentFailure;
    await ui.click("Message");
    currentFailure.reject(new Error("current contact failed"));
    await act(async () => { await Promise.allSettled([currentFailure.promise]); });
    await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    assert.match(ui.dom.window.document.querySelector('[role="alert"]')?.textContent ?? "", /current contact failed/);
    await render("peter");
    assert.equal(ui.dom.window.document.querySelector('[role="alert"]'), null, "contact-specific errors are cleared on identity change");
  } finally {
    pendingImage.resolve("data:image/png;base64,cleanup"); pendingMessage.resolve({ id: "cleanup" } as never);
    await ui.cleanup(); chatStorage.openSession = open;
    imageReader = async () => "data:image/png;base64,old";
  }
});

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
