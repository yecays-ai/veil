export const CONVERSATION_DELETE_WIDTH = 84;
export const CONVERSATION_SWIPE_ACTIVATION = 8;
export const CONVERSATION_SWIPE_OPEN_THRESHOLD = CONVERSATION_DELETE_WIDTH / 2;

export function isHorizontalConversationSwipe(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= CONVERSATION_SWIPE_ACTIVATION &&
    Math.abs(deltaX) > Math.abs(deltaY);
}

export function conversationSwipeOffset(startOffset: number, deltaX: number): number {
  return Math.max(-CONVERSATION_DELETE_WIDTH, Math.min(0, startOffset + deltaX));
}

export function shouldRevealConversationDelete(offset: number): boolean {
  return offset <= -CONVERSATION_SWIPE_OPEN_THRESHOLD;
}
