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
