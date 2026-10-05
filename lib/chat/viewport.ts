export type VisualViewportFrame = {
  height: number;
  offsetTop: number;
};

export function fitVisualViewport(
  screenHeight: number,
  viewport: { offsetTop: number; height: number },
): VisualViewportFrame {
  const offsetTop = Math.max(0, viewport.offsetTop);
  return {
    height: Math.max(
      0,
      Math.min(screenHeight, viewport.height + offsetTop),
    ),
    offsetTop,
  };
}
