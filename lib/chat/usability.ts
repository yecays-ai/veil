import type { ChatMessage } from "./types";

export function createTransientFeedback(update: (text: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  return {
    show(text: string) {
      cancel(); update(text);
      timer = setTimeout(() => { timer = undefined; update(""); }, 1800);
    },
    cancel,
  };
}

export const hasPendingUserContent = (messages: readonly ChatMessage[]) =>
  messages.some((message) => message.role === "user" && message.status === "sent" && !message.requestedBy);

export function shouldRequestAutoReply(keyboardClosed: boolean, enabled: boolean,
  messages: readonly ChatMessage[]): boolean {
  return keyboardClosed && enabled && hasPendingUserContent(messages);
}

export function visibleReplyText(message: ChatMessage, streaming: boolean) {
  return message.role === "assistant" && message.status === "streaming" && !streaming
    ? "" : message.content;
}

export class KeyboardCloseDetector {
  private wasOpen = false;
  private width: number;
  private height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  get isOpen() { return this.wasOpen; }
  reset(width: number, height: number) { this.width = width; this.height = height; this.wasOpen = false; }
  measure(width: number, height: number, inset: number, focused: boolean) {
    if (Math.abs(width - this.width) >= 80) {
      this.width = width; this.height = height; this.wasOpen = false;
      return false;
    }
    this.height = Math.max(this.height, height);
    const open = inset >= 80 || this.height - height >= 80;
    if (open) { if (focused) this.wasOpen = true; return false; }
    if (!this.wasOpen) return false;
    this.wasOpen = false; this.height = height;
    return true;
  }
}
