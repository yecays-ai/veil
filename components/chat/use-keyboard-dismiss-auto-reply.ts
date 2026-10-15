"use client";
import { useEffect, useRef, type RefObject } from "react";
import { KeyboardCloseDetector, shouldRequestAutoReply } from "../../lib/chat/usability";
import { chatStorage } from "../../lib/chat/storage";
import { chatEngine } from "../../lib/chat/engine";

// Adapted from momo.float.phone's viewport measurement, polling and debounce
// guards. VEIL requires a measured open -> close rather than blur alone.
export function useKeyboardDismissAutoReply(
  root: RefObject<HTMLElement | null>,
  options: { sessionId?: string; enabled: boolean; blocked: boolean; onReply: () => Promise<void> },
) {
  const current = useRef(options);
  useEffect(() => { current.current = options; });
  useEffect(() => {
    if (!options.enabled || !options.sessionId) return;
    const sessionId = options.sessionId;
    const viewport = window.visualViewport;
    if (!viewport || !window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
    const detector = new KeyboardCloseDetector(window.innerWidth, viewport.height);
    let alive = true, timer = 0, frame = 0, poll = 0, revision = 0;
    const input = () => root.current?.querySelector<HTMLTextAreaElement>("#chat-input");
    const focused = () => {
      const active = globalThis.document.activeElement;
      return !!active && !!root.current?.contains(active) && active.matches("textarea, input");
    };
    const inset = () => Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    const cancel = () => { revision++; window.clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (current.current.blocked || chatEngine.isGenerating(sessionId)) return;
      const token = revision;
      timer = window.setTimeout(async () => {
        timer = 0;
        const allowed = () => alive && token === revision && current.current.enabled &&
          current.current.sessionId === sessionId && !current.current.blocked &&
          !chatEngine.isGenerating(sessionId) && !detector.isOpen && inset() < 80 && !input()?.value.trim();
        if (!allowed()) return;
        try {
          const stored = await chatStorage.readSession(sessionId);
          if (allowed() && shouldRequestAutoReply(true, stored.session.autoReplyOnKeyboardDismiss, stored.messages))
            await current.current.onReply();
        } catch { /* The normal chat loader/reply path reports storage errors. */ }
      }, 1000);
    };
    const measure = () => {
      frame = 0;
      if (detector.measure(window.innerWidth, viewport.height, inset(), focused())) schedule();
      else if (detector.isOpen || inset() >= 80) cancel();
    };
    const requestMeasure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const onFocus = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !root.current?.contains(event.target) || !event.target.matches("textarea, input")) return;
      cancel();
      if (!poll) poll = window.setInterval(measure, 200);
      requestMeasure();
    };
    const onInput = (event: Event) => { if (event.target === input()) cancel(); };
    const onOrientation = () => { cancel(); detector.reset(window.innerWidth, viewport.height); requestMeasure(); };
    viewport.addEventListener("resize", requestMeasure);
    viewport.addEventListener("scroll", requestMeasure);
    window.addEventListener("resize", requestMeasure);
    window.addEventListener("orientationchange", onOrientation);
    globalThis.document.addEventListener("focusin", onFocus);
    globalThis.document.addEventListener("focusout", requestMeasure);
    globalThis.document.addEventListener("input", onInput);
    if (focused()) poll = window.setInterval(measure, 200);
    requestMeasure();
    return () => {
      alive = false; cancel(); cancelAnimationFrame(frame); window.clearInterval(poll);
      viewport.removeEventListener("resize", requestMeasure);
      viewport.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", requestMeasure);
      window.removeEventListener("orientationchange", onOrientation);
      globalThis.document.removeEventListener("focusin", onFocus);
      globalThis.document.removeEventListener("focusout", requestMeasure);
      globalThis.document.removeEventListener("input", onInput);
    };
  }, [root, options.enabled, options.sessionId]);
}
