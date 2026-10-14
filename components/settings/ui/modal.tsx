"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// BottomSheet/ConfirmDialog structure adapted from the reference modal primitives.
// Overlays stay inside the phone, with focus trapping and restoration for keyboard users.
function Modal({
  title,
  children,
  onClose,
  sheet = false,
  suspended = false,
  headerAction,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  sheet?: boolean;
  suspended?: boolean;
  headerAction?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const titleId = useId();
  useEffect(() => {
    if (suspended) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    if (!element) return;
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ),
      ).filter((node) => node.getClientRects().length > 0);
    (focusable()[0] ?? element).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          element.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !element.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [suspended]);
  return (
    <div
      className={`settings-modal-overlay ${sheet ? "settings-modal-bottom" : ""} ${className}`}
      inert={suspended}
      aria-hidden={suspended || undefined}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={sheet ? "settings-modal-sheet" : "settings-modal-dialog"}
      >
        <header className="settings-modal-header">
          <button
            className="settings-icon-button"
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <span aria-hidden="true">×</span>
          </button>
          <h2 id={titleId}>{title}</h2>
          <div>{headerAction}</div>
        </header>
        <div className="settings-modal-body">{children}</div>
      </div>
    </div>
  );
}
export function BottomSheet(props: Omit<Parameters<typeof Modal>[0], "sheet">) {
  return <Modal {...props} sheet />;
}
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{children}</p>
      <div className="settings-action-row">
        <button className="settings-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="settings-button settings-danger"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
