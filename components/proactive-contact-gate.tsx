"use client";

import { useEffect } from "react";

/** A page owner, independent of chat routes: lets Characters write first while VEIL is open and visible. */
export function ProactiveContactGate() {
  useEffect(() => {
    let disposed = false, dispose = () => {};
    void import("../lib/chat/proactive-browser").then(({ startBrowserProactive }) => {
      if (disposed) return;
      dispose = startBrowserProactive();
    }).catch(() => { /* No fallback: without the trigger Characters simply do not write first. */ });
    return () => { disposed = true; dispose(); };
  }, []);
  return null;
}
