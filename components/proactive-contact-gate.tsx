"use client";

import { useEffect } from "react";

/** A page owner, independent of chat routes: Characters write first and answer in their own time while VEIL is open and visible. */
export function ProactiveContactGate() {
  useEffect(() => {
    let disposed = false;
    const stops: Array<() => void> = [];
    // Independent starts: one failing to load must not take the other down.
    void import("../lib/chat/proactive-browser").then(({ startBrowserProactive }) => {
      if (!disposed) stops.push(startBrowserProactive());
    }).catch(() => { /* No fallback: without the trigger Characters simply do not write first. */ });
    void import("../lib/chat/life-reply-browser").then(({ startBrowserLifeReply }) => {
      if (!disposed) stops.push(startBrowserLifeReply());
    }).catch(() => { /* No fallback: without it Life Mode conversations are not answered on their own. */ });
    return () => { disposed = true; stops.splice(0).forEach((stop) => stop()); };
  }, []);
  return null;
}
