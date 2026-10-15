// In-memory record of which conversations have an unsent draft in the composer. Nothing is stored: it exists only while a
// chat page holds the draft, so a closed page, a switched conversation or a refresh simply clears it. Life Mode replies
// read it to avoid answering over someone who is still writing.
const drafts = new Set<string>();
const listeners = new Set<(sessionId: string) => void>();

/** True while a chat page shows unsent text in this conversation's composer. */
export const hasComposingDraft = (sessionId: string) => drafts.has(sessionId);

/** Reports whether the composer of a conversation holds text. Listeners hear only real changes. */
export function setComposingDraft(sessionId: string, composing: boolean) {
  if (drafts.has(sessionId) === composing) return;
  if (composing) drafts.add(sessionId); else drafts.delete(sessionId);
  for (const listener of [...listeners]) listener(sessionId);
}

/** Hears every change of any conversation's draft state; returns the unsubscribe. */
export function subscribeComposing(listener: (sessionId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
