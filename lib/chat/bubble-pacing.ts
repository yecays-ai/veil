import type { ChatMessage } from "./types";
import { DEFAULT_BUBBLE_TIMING, normalizeBubbleTiming, type BubbleTiming } from "./types";

export const CHAT_TIMESTAMP_GAP_MS = 15 * 60 * 1000;

export function bubbleDelayMs(content: string, timing: BubbleTiming = DEFAULT_BUBBLE_TIMING) {
  const safe = normalizeBubbleTiming(timing);
  const length = Array.from(content).length;
  return length <= 60 ? safe.shortMs : length <= 200 ? safe.mediumMs : safe.longMs;
}

export function shouldShowTimestamp(current: ChatMessage, previous?: ChatMessage) {
  return !previous || current.createdAt - previous.createdAt >= CHAT_TIMESTAMP_GAP_MS;
}

export function sameVisualMessageGroup(current: ChatMessage, adjacent?: ChatMessage) {
  return !!adjacent && current.role === adjacent.role &&
    Math.abs(current.createdAt - adjacent.createdAt) < CHAT_TIMESTAMP_GAP_MS;
}

export type RevealState = {
  sessionId?: string;
  awaiting: boolean;
  knownIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
  replyIds: readonly string[];
  pending: boolean;
};
const emptyState = (): RevealState => ({ awaiting: false, knownIds: new Set(), hiddenIds: new Set(), replyIds: [], pending: false });

// IDs only: text, ordering and persistence remain owned by ChatStorage.
export class BubbleRevealQueue {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private startedAt = 0;
  private finalizedSeen = false;
  private timing: BubbleTiming = { ...DEFAULT_BUBBLE_TIMING };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(state: RevealState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  cancel = () => {
    this.revision++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.publish(emptyState());
  };
  begin(sessionId: string, messages: readonly ChatMessage[], streaming: boolean, startedAt: number,
    timing: BubbleTiming = DEFAULT_BUBBLE_TIMING) {
    this.cancel();
    this.timing = normalizeBubbleTiming(timing);
    this.startedAt = startedAt;
    this.finalizedSeen = false;
    if (!streaming) this.publish({ ...emptyState(), sessionId, awaiting: true,
      knownIds: new Set(messages.map((message) => message.id)), pending: true });
    return this.revision;
  }
  complete(sessionId: string, messages: readonly ChatMessage[], readyAt: number, revision: number) {
    if (revision !== this.revision || this.state.sessionId !== sessionId || !this.state.awaiting) return;
    if (!messages.length || messages.some((message) => message.status !== "complete" || message.sessionId !== sessionId)) {
      this.cancel(); return;
    }
    const token = this.revision;
    this.publish({ ...this.state, awaiting: false, replyIds: messages.map((message) => message.id),
      hiddenIds: new Set(messages.map((message) => message.id)) });
    const reveal = (index: number) => {
      if (token !== this.revision) return;
      const hiddenIds = new Set(this.state.hiddenIds);
      hiddenIds.delete(messages[index].id);
      this.publish({ ...this.state, hiddenIds, pending: hiddenIds.size > 0 });
      if (index + 1 < messages.length)
        this.timer = setTimeout(() => reveal(index + 1), bubbleDelayMs(messages[index + 1].content, this.timing));
      else this.timer = undefined;
    };
    const firstDelay = Math.max(0, bubbleDelayMs(messages[0].content, this.timing) - Math.max(0, readyAt - this.startedAt));
    if (firstDelay === 0) reveal(0);
    else this.timer = setTimeout(() => reveal(0), firstDelay);
  }
  settle(sessionId: string, revision: number | undefined) {
    if (revision === this.revision && this.state.sessionId === sessionId && this.state.awaiting) this.cancel();
  }
  discard(ids: readonly string[]) {
    if (ids.some((id) => this.state.replyIds.includes(id))) this.cancel();
  }
  reconcile(messages: readonly ChatMessage[]) {
    if (this.state.awaiting || !this.state.replyIds.length) return;
    const ids = new Set(messages.filter((message) => message.status === "complete").map((message) => message.id));
    if (this.state.replyIds.every((id) => ids.has(id))) this.finalizedSeen = true;
    else if (this.finalizedSeen) this.cancel();
  }
}

export function hiddenForReveal(message: ChatMessage, state: RevealState) {
  return state.hiddenIds.has(message.id) || (state.awaiting &&
    message.role === "assistant" && !state.knownIds.has(message.id));
}

export function groupVisibleMessages(messages: readonly ChatMessage[]) {
  return messages.map((message, index) => {
    const previous = messages[index - 1], next = messages[index + 1];
    return {
      message,
      showTimestamp: shouldShowTimestamp(message, previous),
      isGroupStart: !sameVisualMessageGroup(message, previous),
      isGroupEnd: !sameVisualMessageGroup(message, next),
    };
  });
}
