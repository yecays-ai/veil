"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useFoundation } from "../foundation-provider";
import { useContacts } from "../use-contacts";
import { useBindings } from "../use-bindings";
import { useTheme } from "../theme-provider";
import { chatDiagnosticRecorder, recordChatDiagnostic } from "../../lib/diagnostics/chat-first-paint";

const ENABLE_KEY = "veil.chat-first-paint-diagnostics";
let memoryOptIn = false;
function readOptIn() {
  try { return window.sessionStorage.getItem(ENABLE_KEY) === "1"; }
  catch { return memoryOptIn; }
}
function writeOptIn(enabled: boolean) {
  memoryOptIn = enabled;
  try {
    if (enabled) window.sessionStorage.setItem(ENABLE_KEY, "1");
    else window.sessionStorage.removeItem(ENABLE_KEY);
  } catch { /* In-memory opt-in still works for this document. */ }
}
const NAV_SELECTOR = 'a[href^="/messages"], a[href^="/contacts"], button[data-chat-navigation]';

export function ChatDiagnosticsGate({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("veilDiagnostics") === "1";
    const active = requested || readOptIn();
    if (requested) writeOptIn(true);
    chatDiagnosticRecorder.setEnabled(active);
    setEnabled(active);
    setChecked(true);
  }, []);
  function toggle(next: boolean) {
    writeOptIn(next);
    chatDiagnosticRecorder.setEnabled(next);
    setEnabled(next);
  }
  return <>
    {children}
    {checked && enabled && <ChatDiagnosticsObserver onDisable={() => toggle(false)} />}
  </>;
}

function ChatDiagnosticsObserver({ onDisable }: { onDisable: () => void }) {
  const pathname = usePathname();
  const foundation = useFoundation();
  const contacts = useContacts();
  const bindings = useBindings();
  const theme = useTheme();

  useEffect(() => {
    const route = pathname ?? "/";
    chatDiagnosticRecorder.setRoute(route);
    chatDiagnosticRecorder.ensureNavigation(route);
    const timing = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    recordChatDiagnostic("document-navigation-timing", {
      navigationType: timing?.type ?? "unknown",
      domContentLoadedMs: timing?.domContentLoadedEventEnd ?? 0,
      loadEventEndMs: timing?.loadEventEnd ?? 0,
    });
  // Initial document timing belongs to this observer lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatDiagnosticRecorder.setRoute(pathname ?? "/");
    recordChatDiagnostic("route-committed", { route: pathname ?? "/" });
  }, [pathname]);
  useEffect(() => {
    recordChatDiagnostic("provider-ready", { provider: "foundation", ready: foundation.ready });
  }, [foundation.ready, pathname]);
  useEffect(() => {
    recordChatDiagnostic("provider-ready", { provider: "contacts", ready: contacts.ready, error: !!contacts.error });
  }, [contacts.ready, contacts.error, pathname]);
  useEffect(() => {
    recordChatDiagnostic("provider-ready", { provider: "theme", ready: theme.ready });
  }, [theme.ready, pathname]);
  useEffect(() => {
    recordChatDiagnostic("provider-ready", { provider: "bindings", ready: bindings.ready, error: !!bindings.error });
  }, [bindings.ready, bindings.error, pathname]);

  useEffect(() => {
    let pointer: { at: number; type: string; element: Element } | null = null;
    const findTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest("[data-chat-diagnostics]")) return null;
      return target.closest(NAV_SELECTOR);
    };
    const pointerDown = (event: PointerEvent) => {
      const element = findTarget(event.target);
      if (!element || !event.isPrimary) return;
      pointer = { at: performance.now(), type: event.pointerType || "pointer", element };
    };
    const touchStart = (event: TouchEvent) => {
      if ("PointerEvent" in window) return;
      const element = findTarget(event.target);
      if (element) pointer = { at: performance.now(), type: "touch", element };
    };
    const click = (event: MouseEvent) => {
      const element = findTarget(event.target);
      if (!element) return;
      const href = element instanceof HTMLAnchorElement ? element.getAttribute("href") : null;
      const target = href ?? element.getAttribute("data-chat-navigation") ?? "navigation-control";
      const sameTarget = pointer?.element === element;
      chatDiagnosticRecorder.beginNavigation(target, sameTarget ? pointer?.at : undefined,
        sameTarget ? pointer?.type : "keyboard");
      pointer = null;
      recordChatDiagnostic("navigation-activation", { target });
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("touchstart", touchStart, true);
      document.removeEventListener("click", click, true);
    };
  }, []);

  return <DiagnosticsPanel onDisable={onDisable} />;
}

function DiagnosticsPanel({ onDisable }: { onDisable: () => void }) {
  const [open, setOpen] = useState(false);
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const current = chatDiagnosticRecorder.currentNavigation();
  async function copy() {
    const output = chatDiagnosticRecorder.exportCurrentNavigation();
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(output); return; }
      throw new Error("Clipboard API unavailable");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = output;
      textarea.setAttribute("readonly", "");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) recordChatDiagnostic("clipboard-copy-failed");
    }
  }
  return <aside data-chat-diagnostics="" style={{
    position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 2px)",
    right: "calc(env(safe-area-inset-right, 0px) + 4px)", zIndex: 2147483000,
    pointerEvents: "none", color: "#fff", font: "12px/1.35 system-ui, sans-serif",
  }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
      style={{ pointerEvents: "auto", minHeight: 22, border: "1px solid #ffffff66", borderRadius: 12,
        padding: "2px 8px", color: "#fff", background: "#111d", font: "11px system-ui" }}>
      DIAG · T+{Math.round(current.elapsedSinceClickMs)}ms
    </button>
    {open && <section aria-label="Chat first paint diagnostics" style={{
      pointerEvents: "auto", width: "min(300px, calc(100vw - 16px))", maxHeight: "34vh",
      overflow: "auto", marginTop: 4, padding: 10, borderRadius: 10, background: "#101820f2",
      border: "1px solid #ffffff55", boxShadow: "0 4px 18px #0008",
    }}>
      <strong>Current navigation · {current.id ?? "none"}</strong>
      <p style={{ margin: "4px 0", opacity: .8 }}>JS monotonic time. React commit and decode are not proof of screen paint; use the screen recording for visible frames.</p>
      <div style={{ display: "flex", gap: 6, position: "sticky", top: 0, background: "#101820" }}>
        <button type="button" onClick={() => void copy()}>Copy</button>
        <button type="button" onClick={() => { chatDiagnosticRecorder.clearCurrentNavigation(); refresh((value) => value + 1); }}>Clear current</button>
        <button type="button" onClick={onDisable}>Stop</button>
        <button type="button" onClick={() => setOpen(false)}>Hide</button>
      </div>
      <ol style={{ paddingLeft: 22 }}>
        {current.events.slice(-24).map((event) => <li key={event.sequence}>
          +{event.fromClickMs ?? event.fromPointerDownMs ?? 0}ms {event.name}
          {Object.keys(event.details).length > 0 && <small> {JSON.stringify(event.details)}</small>}
        </li>)}
      </ol>
    </section>}
  </aside>;
}
