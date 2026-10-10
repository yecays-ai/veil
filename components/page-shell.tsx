"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { confirmDiscard, guardLinkClicks } from "./leave-guard";

export function Chevron({ forward = false }: { forward?: boolean }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d={forward ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} />
    </svg>
  );
}

// Adapted from momo.float.phone's PageShell. The phone shell owns whether the
// top inset is a real safe area or simulated status UI; pages consume one value.
export function PageShell({
  title,
  backHref,
  backLabel,
  onBack,
  guardLeave = false,
  rightAction,
  children,
  overlay,
  bodyClassName = "",
  className = "",
}: {
  title: ReactNode;
  backHref: string;
  backLabel: string;
  onBack?: () => void;
  /** The page holds an unsaved draft: leaving through its links or Back button asks first. */
  guardLeave?: boolean;
  rightAction?: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
  bodyClassName?: string;
  className?: string;
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
      ref.current.style.setProperty("--app-keyboard-inset", `${overlap}px`);
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
    <div className={`app-page ${className}`} ref={ref} onClickCapture={guardLinkClicks(guardLeave)}>
      <div className="app-page-shell" inert={!!overlay}>
        <header className="app-page-header" data-ui="header">
          <div className="app-page-header-safe-area" />
          <div className="app-page-header-content">
            {onBack ? <button type="button" className="app-page-back" aria-label={backLabel}
              style={{ border: 0, background: "none", color: "inherit", padding: 0, cursor: "pointer" }}
              onClick={() => { if (confirmDiscard(guardLeave)) onBack(); }}><Chevron /></button> :
              <Link className="app-page-back" href={backHref} aria-label={backLabel}><Chevron /></Link>}
            <h1 className="app-page-title">{title}</h1>
            <div className="app-page-header-right">{rightAction}</div>
          </div>
        </header>
        <div className={`app-page-body ${bodyClassName}`} data-ui="body">
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
}
