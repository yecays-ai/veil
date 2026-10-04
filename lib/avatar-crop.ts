export type CropPoint = { x: number; y: number };
export function rectangularCropGeometry(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  point: CropPoint,
) {
  const scale =
    Math.max(viewportWidth / width, viewportHeight / height) *
    Math.max(1, Math.min(3, zoom));
  const limitX = (width * scale - viewportWidth) / 2,
    limitY = (height * scale - viewportHeight) / 2;
  const offset = {
    x: Math.max(-limitX, Math.min(limitX, point.x)),
    y: Math.max(-limitY, Math.min(limitY, point.y)),
  };
  return {
    scale,
    offset,
    source: {
      x: (width - viewportWidth / scale) / 2 - offset.x / scale,
      y: (height - viewportHeight / scale) / 2 - offset.y / scale,
      width: viewportWidth / scale,
      height: viewportHeight / scale,
    },
  };
}

export function cropGeometry(
  width: number,
  height: number,
  size: number,
  zoom: number,
  point: CropPoint,
) {
  const geometry = rectangularCropGeometry(
    width,
    height,
    size,
    size,
    zoom,
    point,
  );
  return {
    scale: geometry.scale,
    offset: geometry.offset,
    source: {
      x: geometry.source.x,
      y: geometry.source.y,
      size: geometry.source.width,
    },
  };
}
