import assert from "node:assert/strict";
import test from "node:test";
import {
  cropGeometry,
  rectangularCropGeometry,
} from "../lib/avatar-crop";

test("square crop covers portrait/landscape images and clamps dragged edges", () => {
  for (const [width, height] of [
    [800, 400],
    [400, 800],
    [512, 512],
  ])
    for (const zoom of [1, 1.5, 3])
      for (const point of [
        { x: 0, y: 0 },
        { x: 10000, y: -10000 },
        { x: -10000, y: 10000 },
      ]) {
        const crop = cropGeometry(width, height, 240, zoom, point);
        assert(crop.source.x >= -1e-8 && crop.source.y >= -1e-8);
        assert(crop.source.x + crop.source.size <= width + 1e-8);
        assert(crop.source.y + crop.source.size <= height + 1e-8);
        assert(crop.scale * width >= 240 && crop.scale * height >= 240);
      }
});
test("reposition and zoom change the exported composition", () => {
  const centered = cropGeometry(800, 400, 240, 1, { x: 0, y: 0 });
  const left = cropGeometry(800, 400, 240, 1, { x: 120, y: 0 });
  assert.equal(centered.source.x, 200);
  assert.equal(left.source.x, 0);
  const zoomed = cropGeometry(800, 400, 240, 2, { x: 0, y: 0 });
  assert.equal(zoomed.source.size, centered.source.size / 2);
});

test("rectangular crops cover portrait and wide upload targets", () => {
  for (const [viewportWidth, viewportHeight] of [
    [180, 280],
    [240, 96],
  ]) {
    const crop = rectangularCropGeometry(
      1600,
      900,
      viewportWidth,
      viewportHeight,
      1.5,
      { x: 10000, y: -10000 },
    );
    assert(crop.source.x >= -1e-8 && crop.source.y >= -1e-8);
    assert(crop.source.x + crop.source.width <= 1600 + 1e-8);
    assert(crop.source.y + crop.source.height <= 900 + 1e-8);
    assert(crop.scale * 1600 >= viewportWidth);
    assert(crop.scale * 900 >= viewportHeight);
  }
});
