export const MESSAGE_MENU_GAP_PX = 9;

export type Box = { left: number; right: number; top: number; bottom: number };

export function messageMenuPosition(
  bubble: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
) {
  const below = Math.max(0, viewport.height - margin - Math.max(
    bubble.bottom + MESSAGE_MENU_GAP_PX, margin));
  const above = Math.max(0, Math.min(
    bubble.top - MESSAGE_MENU_GAP_PX, viewport.height - margin) - margin);
  const placeBelow = menu.height <= below ||
    (menu.height > above && below >= above);
  const availableHeight = placeBelow ? below : above;
  const left = Math.max(margin, Math.min(
    (bubble.left + bubble.right - menu.width) / 2,
    viewport.width - margin - menu.width));
  const top = placeBelow
    ? Math.max(bubble.bottom + MESSAGE_MENU_GAP_PX, margin)
    : Math.min(bubble.top - MESSAGE_MENU_GAP_PX, viewport.height - margin) -
      Math.min(menu.height, availableHeight);
  return { left, top, maxHeight: availableHeight, placeBelow };
}

export function selectMessageRange(ids: readonly string[], startId: string) {
  const index = ids.indexOf(startId);
  return index < 0 ? [] : ids.slice(index);
}

/**
 * The reaction bar, the message and the action menu move as one stack: the bar sits directly above the bubble and the
 * menu directly below it. When the stack does not fit, the bubble is moved rather than shrinking either part or
 * moving them to the other side. Returns how far the bubble should move down (negative: up); 0 when it already fits.
 */
export function messageStackShift(
  bubble: Box,
  bar: { height: number },
  menu: { height: number },
  viewport: { height: number; safeTop: number },
  margin = 8,
) {
  const safeTop = Math.max(viewport.safeTop, margin);
  const safeBottom = viewport.height - margin;
  const stackTop = bubble.top - MESSAGE_MENU_GAP_PX - bar.height;
  const stackBottom = bubble.bottom + MESSAGE_MENU_GAP_PX + menu.height;
  if (stackBottom - stackTop > safeBottom - safeTop || stackTop < safeTop) return safeTop - stackTop;
  return stackBottom > safeBottom ? safeBottom - stackBottom : 0;
}

/** Bar left edge: aligned with the bubble side it belongs to, kept inside the viewport. */
export function reactionBarLeft(bubble: Box, barWidth: number, viewportWidth: number, role: "user" | "assistant" | "system", margin = 8) {
  const preferred = role === "user" ? bubble.right - barWidth : bubble.left;
  return Math.max(margin, Math.min(preferred, viewportWidth - margin - barWidth));
}
