/** iOS may report keyboard panning through either viewport offset or page scroll. */
export function chatHeaderOffset(viewportTop: number, scrollTop: number): number {
  return Math.max(0, viewportTop, scrollTop);
}

export function chatKeyboardInset(
  screenHeight: number,
  viewport: { offsetTop: number; height: number },
  scrollTop: number,
  innerHeight: number,
): number {
  const visibleBottom = Math.min(
    screenHeight,
    Math.max(
      viewport.offsetTop + viewport.height,
      scrollTop + viewport.height,
      innerHeight < screenHeight ? innerHeight : 0,
    ),
  );
  return Math.max(0, screenHeight - visibleBottom);
}
