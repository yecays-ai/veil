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
  generation?: { id: string; draftId?: string; targetId?: string; mode?: "regenerate" | "continue";
    stage: "preparing" | "provider" | "finalizing" };
};

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
};

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
