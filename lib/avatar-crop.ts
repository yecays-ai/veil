export type CropPoint = { x: number; y: number };
export function cropGeometry(
  width: number,
  height: number,
  size: number,
  zoom: number,
  point: CropPoint,
) {
  const scale =
    Math.max(size / width, size / height) * Math.max(1, Math.min(3, zoom));
  const limitX = (width * scale - size) / 2,
    limitY = (height * scale - size) / 2;
  const offset = {
    x: Math.max(-limitX, Math.min(limitX, point.x)),
    y: Math.max(-limitY, Math.min(limitY, point.y)),
  };
  return {
    scale,
    offset,
    source: {
      x: (width - size / scale) / 2 - offset.x / scale,
      y: (height - size / scale) / 2 - offset.y / scale,
      size: size / scale,
    },
  };
}
