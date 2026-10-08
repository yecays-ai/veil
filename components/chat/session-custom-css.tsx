"use client";
import { useMemo } from "react";
import { analyzeSessionCSS } from "../../lib/chat/custom-css";

export function SessionCustomCSS({ css }: { css: string }) {
  const scoped = useMemo(
    // Rules that cannot be limited to this conversation are dropped, never applied globally.
    () => analyzeSessionCSS(css, ".chat-room-wrapper").css,
    [css],
  );
  return scoped ? <style data-chat-session-css dangerouslySetInnerHTML={{ __html: scoped }} /> : null;
}
