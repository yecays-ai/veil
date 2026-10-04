"use client";
import { useMemo } from "react";
import { removeCssImports, scopeSessionCSS } from "../../lib/chat/custom-css";

export function SessionCustomCSS({ css }: { css: string }) {
  const scoped = useMemo(
    () => scopeSessionCSS(removeCssImports(css), ".chat-room-wrapper"),
    [css],
  );
  return scoped ? <style data-chat-session-css dangerouslySetInnerHTML={{ __html: scoped }} /> : null;
}
