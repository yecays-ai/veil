export type ChatSession = {
  id: string;
  characterId: string;
  updatedAt: number;
  lastMessageId?: string;
  lastMessagePreview?: string;
  remark: string | null;
  autoReplyOnKeyboardDismiss: boolean;
  nextOrder: number;
};

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
};

export type ApiConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};
export const DEFAULT_API_CONFIG_ID = "chat-default";
export type PromptTurn = { role: ChatMessage["role"]; content: string };
export type ReplyBatch = {
  session: ChatSession;
  messages: ChatMessage[];
  pending: ChatMessage[];
  assistant: ChatMessage;
};
