import type { MouseEvent } from "react";

export const DISCARD_PROMPT = "Discard unsaved changes?";

/** Leaving is free when nothing changed; otherwise the user decides whether to drop the draft. */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm(DISCARD_PROMPT);
}

/** Capture-phase click handler: an in-app link click on a dirty editor asks first, and "No" stays put. */
export function guardLinkClicks(dirty: boolean) {
  return (event: MouseEvent<HTMLElement>) => {
    if (dirty && (event.target as HTMLElement).closest("a") && !window.confirm(DISCARD_PROMPT)) event.preventDefault();
  };
}
