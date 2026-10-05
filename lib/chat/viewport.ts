/** iOS may report keyboard panning through either viewport offset or page scroll. */
export function chatHeaderOffset(viewportTop: number, scrollTop: number): number {
  return Math.max(0, viewportTop, scrollTop);
}

/** Only Header compensation waits for viewport events to settle. */
export function createStableHeaderOffset(apply: (offset: number) => void) {
  let applied = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    update(offset: number) {
      cancel();
      if (offset === applied) return;
      timer = setTimeout(() => {
        timer = undefined;
        applied = offset;
        apply(offset);
      }, 120);
    },
    cancel,
  };
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
