import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import { act, createElement, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { chatDiagnosticRecorder, recordChatDiagnostic } from "../lib/diagnostics/chat-first-paint";

for (const mode of ["query", "session", "standalone", "disabled"] as const)
  test(`opted-in first document hydration captures child layout events: ${mode}`, async () => {
    const { ChatDiagnosticsGate } = await import("../components/diagnostics/chat-diagnostics");
    const { FoundationProvider } = await import("../components/foundation-provider");
    const { ThemeProvider } = await import("../components/theme-provider");
    const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
    function Child() {
      useLayoutEffect(() => {
        recordChatDiagnostic("ChatRoom-commit-mount", { characterId: "private-character" });
        recordChatDiagnostic("chat-react-commit", { messageCount: 1 });
      }, []);
      return createElement("p", null, "Normal child content");
    }
    const tree = () => createElement(PathnameContext.Provider, { value: "/messages/private-character" },
      createElement(ThemeProvider, null, createElement(FoundationProvider, null,
        createElement(ChatDiagnosticsGate, null, createElement(Child)))));
    chatDiagnosticRecorder.setEnabled(false); chatDiagnosticRecorder.clearCurrentNavigation();
    const html = renderToString(tree());
    assert.equal(chatDiagnosticRecorder.isEnabled(), false, "server rendering cannot opt in");
    const dom = new JSDOM(`<div id="root">${html}</div>`, {
      url: `http://localhost/messages/private-character${mode === "query" ? "?keep=1&veilDiagnostics=1&other=two#section" : ""}`,
      pretendToBeVisual: true,
    });
    if (mode === "query") dom.window.history.replaceState({ preserved: "state" }, "", dom.window.location.href);
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const install = (name: string, value: unknown) => {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "HTMLAnchorElement", "localStorage"] as const)
      install(name, dom.window[name]);
    install("indexedDB", new IDBFactory()); install("BroadcastChannel", undefined);
    install("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: mode === "standalone" }) });
    const key = "veil.chat-first-paint-diagnostics";
    if (mode === "session") dom.window.sessionStorage.setItem(key, "1");
    if (mode === "standalone") dom.window.localStorage.setItem(key, "1");
    const { hydrateRoot } = await import("react-dom/client");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    const hydrationErrors: unknown[] = [];
    try {
      await act(async () => { root = hydrateRoot(dom.window.document.getElementById("root")!, tree(),
        { onRecoverableError: (error) => hydrationErrors.push(error) });
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      assert.deepEqual(hydrationErrors, [], "opt-in cannot change server/client markup");
      assert.ok(dom.window.document.body.textContent?.includes("Normal child content"));
      const events = chatDiagnosticRecorder.currentNavigation().events;
      if (mode === "disabled") {
        assert.equal(events.length, 0); assert.equal(chatDiagnosticRecorder.isEnabled(), false);
        assert.equal(dom.window.document.querySelector("[data-chat-diagnostics]"), null);
      } else {
        for (const name of ["ChatRoom-commit-mount", "chat-react-commit"]) {
          const event = events.find((item) => item.name === name);
          assert.ok(event, `${name} from the first child layout effect is retained`);
          assert.equal(event.navigationId, events[0].navigationId);
          assert.equal(event.route, "/messages/[character]");
        }
        assert.doesNotMatch(chatDiagnosticRecorder.exportCurrentNavigation(), /private-character/);
        const stop = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Stop");
        // The panel is initially collapsed; open it and disable diagnostics through its real controls.
        assert.equal(stop, undefined);
        await act(async () => { dom.window.document.querySelector<HTMLButtonElement>("[data-chat-diagnostics] button")!.click(); });
        await act(async () => { [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "Stop")!.click(); });
        assert.equal(chatDiagnosticRecorder.isEnabled(), false);
        assert.equal((mode === "standalone" ? dom.window.localStorage : dom.window.sessionStorage).getItem(key), null);
        if (mode === "query") {
          assert.equal(dom.window.location.pathname, "/messages/private-character");
          assert.equal(dom.window.location.search, "?keep=1&other=two");
          assert.equal(dom.window.location.hash, "#section");
          assert.equal(JSON.stringify(dom.window.history.state), JSON.stringify({ preserved: "state" }));
          assert.equal(new URLSearchParams(dom.window.location.search).get("veilDiagnostics"), null);
        }
      }
    } finally {
      if (root) await act(async () => root!.unmount());
      chatDiagnosticRecorder.setEnabled(false); chatDiagnosticRecorder.clearCurrentNavigation(); dom.window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
