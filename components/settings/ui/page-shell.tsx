"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

// Adapted from momo.float.phone's PageShell: safe header, centered title,
// independent page body, and per-page actions. Next routes own navigation.
export function PageShell({
  title,
  backHref,
  backLabel,
  rightAction,
  children,
  overlay,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  rightAction?: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const screen = ref.current?.closest(".phone-shell");
      if (!screen || !ref.current) return;
      const overlap = Math.max(
        0,
        screen.getBoundingClientRect().bottom -
          viewport.offsetTop -
          viewport.height,
      );
      ref.current.style.setProperty(
        "--settings-keyboard-inset",
        `${overlap}px`,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <div className="settings-app" ref={ref}>
      <div className="settings-page-shell" inert={!!overlay}>
        <header className="settings-page-header">
          <div className="settings-header-safe-area" />
          <div className="settings-header-content">
            <Link
              className="settings-back"
              href={backHref}
              aria-label={backLabel}
            >
              <Chevron />
            </Link>
            <h1>{title}</h1>
            <div className="settings-header-right">{rightAction}</div>
          </div>
        </header>
        <div className="settings-page-body">{children}</div>
      </div>
      {overlay}
    </div>
  );
}
export function Chevron({ forward = false }: { forward?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={forward ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} />
    </svg>
  );
}
