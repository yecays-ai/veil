export type ChatSession = {
  id: string;
  characterId: string;
  type?: "direct" | "group";
  participantIds?: string[];
  title?: string;
  updatedAt: number;
  pinned?: boolean;
  lastMessageId?: string;
  lastMessagePreview?: string;
  remark: string | null;
  autoReplyOnKeyboardDismiss: boolean;
  streamOnline?: boolean;
  backgroundImage?: string;
  backgroundBlur?: number;
  customCSS?: string;
  nextOrder: number;
};

export type ChatBackgroundSettings = {
  id: "chat-background";
  globalChatBackgroundImage?: string;
  blur?: number;
};

export type GlobalProfileSettings = {
  id: "global-profile-settings";
  bubbleDelayMsPerCharacter: number;
  hereThereEnabled: boolean;
  nextCommentAt: number | null;
};

export const DEFAULT_BUBBLE_DELAY_MS_PER_CHARACTER = 15;
export function normalizeBubbleDelayMsPerCharacter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value : DEFAULT_BUBBLE_DELAY_MS_PER_CHARACTER;
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
};

export type PromptTurn = { role: ChatMessage["role"]; content: string };
export type ReplyBatch = {
  session: ChatSession;
  messages: ChatMessage[];
  pending: ChatMessage[];
  assistant: ChatMessage;
};
