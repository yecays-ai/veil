import type { ChatMessage, MessageQuote } from "./types";

/** The text-only part of float's [引用:preview] protocol. */
export function parseQuotedReply(content: string) {
  const match = content.match(/^\s*\[引用[：:]([^\]]+)\]\s*([\s\S]*)$/);
  return match && match[1].trim() && match[2].trim()
    ? { preview: match[1].trim(), content: match[2].trim() }
    : { preview: null, content };
}

export function quoteMessage(message: ChatMessage): MessageQuote {
  if ((message.role !== "user" && message.role !== "assistant") || message.status === "streaming")
    throw new Error("This message cannot be quoted.");
  return { messageId: message.id, role: message.role,
    preview: parseQuotedReply(message.content).content.slice(0, 50) };
}

export function messageHistoryContent(message: ChatMessage): string {
  return messageHistoryContentWithBody(message, message.content);
}
export function messageHistoryContentWithBody(message: ChatMessage, content: string): string {
  return message.quote
    ? `[Reply to ${message.quote.role} message ${JSON.stringify(message.quote.messageId)}: ${JSON.stringify(message.quote.preview)}]\n${content}`
    : content;
}
