export const MESSAGE_LONG_PRESS_MS = 500;
export const MESSAGE_LONG_PRESS_MOVE_PX = 10;
export const MESSAGE_MENU_GAP_PX = 9;

export type Box = { left: number; right: number; top: number; bottom: number };

export function movedPastLongPressTolerance(
  start: { x: number; y: number },
  current: { x: number; y: number },
) {
  return Math.abs(current.x - start.x) > MESSAGE_LONG_PRESS_MOVE_PX ||
    Math.abs(current.y - start.y) > MESSAGE_LONG_PRESS_MOVE_PX;
}

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
