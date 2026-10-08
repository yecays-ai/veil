import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Module from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import { contactReturnSourceFromQuery, contactReturnTarget } from "../lib/contact-navigation";
import { arrivedFromApp, clearReturnState, peekReturnState, rememberNavigationOrigin,
  resetNavigationOriginForTests } from "../lib/navigation-origin";

test("return source: only the explicit direct marker returns to the chat; anything else uses the parent", () => {
  assert.equal(contactReturnSourceFromQuery("direct"), "direct");
  for (const value of [null, undefined, "", "external", "DIRECT"]) assert.equal(contactReturnSourceFromQuery(value), undefined);
  assert.equal(contactReturnTarget("peter", contactReturnSourceFromQuery("direct")), "/messages/peter");
  assert.equal(contactReturnTarget("peter", contactReturnSourceFromQuery(null)), "/contacts");
});

test("origin record: direct entry has none, in-app arrival is exact, and view state is consumed on request", () => {
  resetNavigationOriginForTests();
  assert.equal(arrivedFromApp("/characters/a"), false, "direct entry or deep link uses its fallback");
  rememberNavigationOrigin("/universe", "/characters/a", { view: { x: 1, y: 2, scale: 1.5 } });
  assert.equal(arrivedFromApp("/characters/a"), true);
  assert.equal(arrivedFromApp("/characters/b"), false, "other pages do not inherit the origin");
  assert.deepEqual(peekReturnState("/universe"), { view: { x: 1, y: 2, scale: 1.5 } });
  assert.equal(peekReturnState("/elsewhere"), undefined);
  clearReturnState("/universe");
  assert.equal(peekReturnState("/universe"), undefined);
  resetNavigationOriginForTests();
});

test("contact and character routes are cacheable shells that never read request data on the server", () => {
  const contact = readFileSync("app/contacts/[characterId]/page.tsx", "utf8");
  const character = readFileSync("app/characters/[characterId]/page.tsx", "utf8");
  for (const page of [contact, character]) assert.match(page, /export function generateStaticParams\(\)/);
  assert.doesNotMatch(contact, /searchParams|cookies|headers/);
  assert.doesNotMatch(contact + character, /setTimeout|delay|sleep/);
});

async function mountedApp() {
  const dom = new JSDOM('<div class="phone-shell"><div id="root"></div></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "localStorage"] as const)
    install(name, dom.window[name]);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("ResizeObserver", class { observe() {} disconnect() {} });
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("self", dom.window);
  // Stylesheets are bundler concerns; the compiled test runtime loads them as empty modules.
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (request: string, ...rest: unknown[]) {
    return request.endsWith(".css") ? {} : originalLoad.call(this, request, ...rest);
  };
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  const { FoundationProvider } = await import("../components/foundation-provider");
  const { browserFoundationStorage } = await import("../lib/foundation-storage");
  const { browserContactStorage } = await import("../lib/contact-storage");
  const { normalizeFoundation } = await import("../lib/foundation-types");
  const foundation = normalizeFoundation({ characters: [{ characterId: "peter", name: "Peter" }, { characterId: "lan", name: "Lan" }] });
  const calls = { foundation: 0, contacts: 0, back: 0, push: [] as string[] };
  const originalFoundation = browserFoundationStorage.load, originalContacts = browserContactStorage.load;
  browserFoundationStorage.load = async () => { calls.foundation++; return foundation; };
  browserContactStorage.load = async () => { calls.contacts++; return { version: 1, contacts: [
    { id: "c1", characterId: "peter", createdAt: 100, remark: null, heroBackground: null }] } as never; };
  const router = { back: () => { calls.back++; }, push: (href: string) => { calls.push.push(href); },
    replace() {}, forward() {}, refresh() {}, prefetch() {} };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = (pathname: string, query: string, child: ReactNode) => act(async () => {
    root.render(createElement(FoundationProvider, null,
      createElement(AppRouterContext.Provider, { value: router as never },
        createElement(PathnameContext.Provider, { value: pathname },
          createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) as never }, child)))));
  });
  const settle = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, "mounted UI condition timed out");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    }
  };
  const $ = (selector: string) => dom.window.document.querySelector<HTMLElement>(selector);
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    browserFoundationStorage.load = originalFoundation; browserContactStorage.load = originalContacts;
    loader._load = originalLoad;
    dom.window.close();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  };
  return { render, settle, $, calls, cleanup, foundation };
}

test("re-entering the same Contact Info paints the contact on the first frame with no repeated reads", async () => {
  const app = await mountedApp();
  try {
    const { ContactProfile } = await import("../components/contacts-pages");
    await app.render("/contacts/peter", "from=direct", createElement(ContactProfile, { characterId: "peter" }));
    await app.settle(() => !!app.$(".contact-info") && !app.$(".contact-info-unavailable"));
    assert.equal(app.$(".contact-back")?.getAttribute("href"), "/messages/peter", "the direct marker is honoured from the client query");
    const reads = { foundation: app.calls.foundation, contacts: app.calls.contacts };
    assert.deepEqual(reads, { foundation: 1, contacts: 1 });
    // Leave the page (Back), then immediately open the same contact again.
    await app.render("/messages/peter", "", createElement("div", { id: "chat" }));
    assert.ok(app.$("#chat") && !app.$(".contact-info"));
    await app.render("/contacts/peter", "from=direct", createElement(ContactProfile, { characterId: "peter" }));
    // No awaiting between the commit and these assertions: this is the first painted frame.
    assert.ok(app.$(".contact-info"), "contact content is present in the first frame");
    assert.equal(app.$(".contact-info-unavailable"), null, "no Loading placeholder is shown");
    assert.doesNotMatch(app.$(".contact-info")!.textContent ?? "", /Loading/);
    assert.deepEqual({ foundation: app.calls.foundation, contacts: app.calls.contacts }, reads, "shared snapshots are reused, not re-read");
  } finally { await app.cleanup(); }
});

test("Character Back follows an in-app Universe source via history, and falls back to Characters on direct entry", async () => {
  resetNavigationOriginForTests();
  const app = await mountedApp();
  try {
    const { CharacterPage } = await import("../components/profile-pages");
    await app.render("/characters/lan", "", createElement(CharacterPage, { characterId: "lan" }));
    await app.settle(() => !!app.$(".app-page-back"));
    const direct = app.$(".app-page-back")!;
    assert.equal(direct.tagName, "A", "direct entry or deep link uses a fallback link");
    assert.equal(direct.getAttribute("href"), "/characters");
    await act(async () => { rememberNavigationOrigin("/universe", "/characters/lan"); });
    const fromUniverse = app.$(".app-page-back")!;
    assert.equal(fromUniverse.tagName, "BUTTON", "arrival from the Universe switches to history Back");
    await act(async () => { fromUniverse.click(); });
    assert.equal(app.calls.back, 1);
    assert.deepEqual(app.calls.push, [], "Back does not push a new entry onto the stack");
  } finally { await app.cleanup(); resetNavigationOriginForTests(); }
});

test("Universe canvas records its pan/zoom when opening a Character and restores it once on return", async () => {
  resetNavigationOriginForTests();
  const app = await mountedApp();
  try {
    const { RelationshipCanvas } = await import("../components/relationship-canvas");
    const document = { ...app.foundation, universe: { ...app.foundation.universe, nodePositions: {
      peter: { x: 10, y: 10 }, lan: { x: 300, y: 120 } }, relations: [] } };
    const canvas = () => createElement(RelationshipCanvas, { document, move: async () => {}, edit: () => {} });
    rememberNavigationOrigin("/universe", "/characters/peter", { view: { x: 40, y: -10, scale: 1.5 } });
    await app.render("/universe", "", canvas());
    assert.match(app.$(".relationship-canvas")!.getAttribute("style") ?? "", /translate\(40px, ?-10px\) scale\(1\.5\)/);
    assert.equal(peekReturnState("/universe"), undefined, "restored view is consumed, not sticky");
    const node = [...dom(app).querySelectorAll<HTMLElement>(".character-node")].find((el) => el.textContent?.includes("Lan"))!;
    await act(async () => { node.click(); });
    assert.deepEqual(app.calls.push, ["/characters/lan"]);
    assert.ok(arrivedFromApp("/characters/lan"));
    assert.deepEqual(peekReturnState("/universe"), { view: { x: 40, y: -10, scale: 1.5 } });
  } finally { await app.cleanup(); resetNavigationOriginForTests(); }
});

function dom(app: { $: (selector: string) => HTMLElement | null }) { return app.$(".phone-shell")!; }
