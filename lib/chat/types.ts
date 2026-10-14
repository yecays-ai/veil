export type ChatSession = {
  id: string;
  /**
   * Direct chat: its Character. Group chat: the first member, or "" once no member remains (a group
   * outlives its members). "" matches no Character, so no reader may treat it as a reference.
   */
  characterId: string;
  type?: "direct" | "group";
  participantIds?: string[];
  title?: string;
  updatedAt: number;
  pinned?: boolean;
  lastMessageId?: string;
  lastMessagePreview?: string;
  autoReplyOnKeyboardDismiss: boolean;
  streamOnline?: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  customCSS?: string;
  nextOrder: number;
  /** Absent in production until M5b explicitly activates tracking; old messages are never backfilled. */
  memorySequence?: import("../memory/sequence").SessionMemorySequence;
  /** Rolling summary of messages that left the History window; absent until one is written. Deleted with the history. */
  summary?: ChatSummary;
  /** When this Character was last offered a chance to message first (see proactive.ts); absent until the first attempt. Survives clearing the history. */
  proactiveAttempts?: number[];
  /** Assistant bubbles stored while no chat page showed this conversation; absent when none. Cleared on entering it or clearing the history. */
  unreadCount?: number;
  generation?: { id: string; draftId?: string; targetId?: string; mode?: "regenerate" | "continue";
    /** A Character-initiated attempt: if interrupted, recovery drops its empty draft instead of leaving a failed reply. */
    initiated?: true;
    stage: "preparing" | "provider" | "finalizing" };
};

/** Covers the History-eligible messages with `order <= throughOrder`; `digest` proves they are unchanged. */
export type ChatSummary = { text: string; throughOrder: number; digest: string; updatedAt: number };

export type ChatBackgroundSettings = {
  id: "chat-background";
  globalChatBackgroundImage?: string;
  blur?: number;
};

export type GlobalProfileSettings = {
  id: "global-profile-settings";
  bubbleTiming: BubbleTiming;
  hereThereEnabled: boolean;
  nextCommentAt: number | null;
};

export type BubbleTiming = { shortMs: number; mediumMs: number; longMs: number };
export const DEFAULT_BUBBLE_TIMING: Readonly<BubbleTiming> = { shortMs: 1200, mediumMs: 2400, longMs: 3600 };
export const MAX_BUBBLE_TIMING_MS = 60_000;
export function isValidBubbleTimingDelay(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_BUBBLE_TIMING_MS;
}
export function normalizeBubbleTiming(value: unknown): BubbleTiming {
  const saved = value && typeof value === "object" ? value as Partial<BubbleTiming> : {};
  return {
    shortMs: isValidBubbleTimingDelay(saved.shortMs) ? saved.shortMs : DEFAULT_BUBBLE_TIMING.shortMs,
    mediumMs: isValidBubbleTimingDelay(saved.mediumMs) ? saved.mediumMs : DEFAULT_BUBBLE_TIMING.mediumMs,
    longMs: isValidBubbleTimingDelay(saved.longMs) ? saved.longMs : DEFAULT_BUBBLE_TIMING.longMs,
  };
}

export function normalizeBackgroundBlur(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(20, Math.max(0, value)) : 0;
}

export type ChatImageAsset = {
  id: string;
  blob: Blob;
  createdAt: number;
};

export type MessageQuote = { messageId: string; preview: string; role: "user" | "assistant" };
export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "sent" | "streaming" | "complete" | "cancelled" | "error";
  createdAt: number;
  order: number;
  requestedBy?: string;
  error?: string;
  quote?: MessageQuote;
  turnId?: string;
  attemptId?: string;
  attemptFor?: string;
  attemptMode?: "regenerate" | "continue";
  outcome?: "success" | "stopped" | "failed" | "truncated" | "interrupted";
  finishReason?: string;
  failureStage?: "preparing" | "provider" | "finalizing";
  confirmed?: boolean;
  memorySequence?: import("../memory/sequence").MessageMemorySequence;
  /** Memory injected into the request that produced this reply. Absent on replies from before this was recorded. */
  memoryRefs?: MemoryRef[];
  /** One emoji per side. Absent until someone reacts, and removed again when the last one is cleared. */
  reactions?: import("./reactions").MessageReactions;
  /** A sticker message: `content` then holds its semantic text (for search, summaries, Memory and the prompt), not bubble text. Absent on text messages. */
  sticker?: import("./sticker-message").MessageSticker;
  /** A VEIL virtual transfer. The row ID is the stable transfer ID; no wallet or real payment is represented. */
  transfer?: import("./transfer").VirtualTransfer;
  /** Durable operation result, linked to the original transfer row and never counted as another transfer. */
  transferEvent?: import("./transfer").TransferEvent;
  /** A freely described gift card. The stable message row ID identifies the gift. */
  gift?: import("./gift").ChatGift;
  /** Durable accept/decline result linked to its original gift card. */
  giftEvent?: import("./gift").GiftEvent;
  /** The sender withdrew this message. Its original body is cleared when this marker is written. */
  recalled?: { at: number; by: "user" | "assistant" };
};

/** What a reply was given from Memory: the row and a hash of the injected content. Never the memory text itself. */
export type MemoryRef = { id: string; hash: string; journal?: true };
export const MEMORY_REF_LIMIT = 6;

export type PromptTurn = { role: ChatMessage["role"]; content: string };
export function isTruncatedReason(reason?: string) {
  return ["length", "max_tokens", "max_output_tokens"].includes(reason ?? "");
}
export type ReplyBatch = {
  session: ChatSession;
  messages: ChatMessage[];
  pending: ChatMessage[];
  assistant: ChatMessage;
};
