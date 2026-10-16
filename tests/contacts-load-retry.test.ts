import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, Fragment } from "react";
import { addContact, browserContactStorage, normalizeContacts, type ContactDocument } from "../lib/contact-storage";
import { liveContacts } from "../lib/contacts-bindings-live";
import { normalizeFoundation } from "../lib/foundation-types";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("Contacts pages expose shared load Retry, deduplicate clicks, and ignore late completion after unmount", { timeout: 5000 }, async () => {
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

  const requests: ReturnType<typeof deferred<ContactDocument>>[] = [];
  const originalRead = browserContactStorage.load;
  browserContactStorage.load = () => {
    const request = deferred<ContactDocument>();
    requests.push(request);
    return request.promise;
  };
  const fixture = { foundation: normalizeFoundation({ characters: [
    { characterId: "peter", name: "Peter" }, { characterId: "lan", name: "Lan" },
  ] }) };
  const foundationHook = { useFoundation: () => ({ document: fixture.foundation, ready: true }) };
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request, ...rest) {
    if (request.endsWith(".css")) return {};
    if (request.endsWith("/contact-memory-cards")) return { ContactMemoryCards: () => null }; // Memory shortcuts open their own stores; not under test here.
    if (request.endsWith("/foundation-provider")) return foundationHook;
    return originalLoad.call(this, request, ...rest);
  };

  let root: ReturnType<typeof import("react-dom/client").createRoot> | undefined;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const waitForRequests = async (count: number) => {
    for (let attempt = 0; attempt < 20 && requests.length < count; attempt++) await flush();
    assert.equal(requests.length, count, `exactly ${count} Contacts read(s) start`);
  };
  const contactDocument = (ids: string[]) => ids.reduce((document, id) => addContact(document, id), normalizeContacts(null));
  const pageSet = (ContactsHome: typeof import("../components/contacts-pages").ContactsHome,
    AddContactPage: typeof import("../components/contacts-pages").AddContactPage,
    CreateGroupPage: typeof import("../components/contacts-pages").CreateGroupPage,
    ContactInfo: typeof import("../components/contact-info").ContactInfo) => createElement(Fragment, null,
    createElement(ContactsHome), createElement(AddContactPage),
    createElement(CreateGroupPage, { characterIds: ["peter", "lan"] }),
    createElement(ContactInfo, { characterId: "peter" }));

  try {
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    const { createRoot } = await import("react-dom/client");
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const { ContactsHome, AddContactPage, CreateGroupPage } = await import("../components/contacts-pages");
    const { ContactInfo } = await import("../components/contact-info");
    root = createRoot(dom.window.document.getElementById("root")!);
    const render = (children: ReturnType<typeof pageSet>) => act(async () => {
      root!.render(createElement(AppRouterContext.Provider, { value: {
        push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {},
      } as never }, children));
    });

    await render(pageSet(ContactsHome, AddContactPage, CreateGroupPage, ContactInfo));
    await waitForRequests(1);
    await act(async () => { requests[0].reject(new Error("private storage detail")); await flush(); });
    assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 4,
      "Contacts, Add Contact, Create Group, and Contact Info each show the shared load error");
    assert.equal([...dom.window.document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Retry").length, 4);

    await act(async () => {
      const buttons = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
        .filter((button) => button.textContent?.trim() === "Retry");
      buttons.forEach((button) => button.click());
      buttons.forEach((button) => button.click());
      await flush();
    });
    await waitForRequests(2);
    requests[1].resolve(contactDocument(["peter", "lan"]));
    await act(async () => { await flush(); });
    assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 0, "a successful Retry clears every load error");
    assert.equal(dom.window.document.querySelectorAll('a[href^="/contacts/"]').length > 0, true,
      "Contacts renders its loaded rows");
    assert.equal([...dom.window.document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "Added").length, 2,
      "Add Contact renders the loaded Characters");
    assert.match(dom.window.document.body.textContent ?? "", /2 contacts selected/);
    assert.ok([...dom.window.document.querySelectorAll("h1")].some((heading) => heading.textContent === "Peter"),
      "Contact Info renders the loaded contact");

    let lateRead!: Promise<void>;
    await act(async () => { lateRead = liveContacts.retry(); await flush(); });
    await waitForRequests(3);
    await act(async () => { root!.unmount(); });
    requests[2].resolve(contactDocument(["peter"]));
    await act(async () => { await lateRead; });
    root = createRoot(dom.window.document.getElementById("root")!);
    await render(pageSet(ContactsHome, AddContactPage, CreateGroupPage, ContactInfo));
    assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 0,
      "the completed shared read is available after remount without stale page errors");
    assert.equal(requests.length, 3, "remount reuses the completed shared snapshot");
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    loader._load = originalLoad;
    browserContactStorage.load = originalRead;
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
});
