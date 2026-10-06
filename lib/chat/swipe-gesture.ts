export const CONVERSATION_DELETE_WIDTH = 84;
export const CONVERSATION_SWIPE_ACTIVATION = 8;
export const CONVERSATION_SWIPE_OPEN_THRESHOLD = CONVERSATION_DELETE_WIDTH / 2;
export const CONVERSATION_SWIPE_MAX_OVERSCROLL = 16;
export const CONVERSATION_SWIPE_OVERSCROLL_RESISTANCE = 48;

export function isHorizontalConversationSwipe(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= CONVERSATION_SWIPE_ACTIVATION &&
    Math.abs(deltaX) > Math.abs(deltaY);
}

export function conversationSwipeOffset(startOffset: number, deltaX: number): number {
  const rawOffset = Math.min(0, startOffset + deltaX);
  const overscroll = Math.max(0, -rawOffset - CONVERSATION_DELETE_WIDTH);
  if (overscroll === 0) return rawOffset;

  const resistedOverscroll = CONVERSATION_SWIPE_MAX_OVERSCROLL * overscroll /
    (overscroll + CONVERSATION_SWIPE_OVERSCROLL_RESISTANCE);
  return -(CONVERSATION_DELETE_WIDTH + resistedOverscroll);
}

export function conversationSwipeReleaseTarget(offset: number): number {
  return offset <= -CONVERSATION_SWIPE_OPEN_THRESHOLD ? -CONVERSATION_DELETE_WIDTH : 0;
}
