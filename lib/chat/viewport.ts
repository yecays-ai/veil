export type VisualViewportFrame = {
  height: number;
  offsetTop: number;
};

export function fitVisualViewport(
  screen: { top: number; bottom: number },
  viewport: { offsetTop: number; height: number },
): VisualViewportFrame {
  const top = Math.max(screen.top, viewport.offsetTop);
  const bottom = Math.min(
    screen.bottom,
    viewport.offsetTop + viewport.height,
  );
  return {
    height: Math.max(0, bottom - top),
    offsetTop: Math.max(0, top - screen.top),
  };
}
