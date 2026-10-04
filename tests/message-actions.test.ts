import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_MENU_GAP_PX,
  messageMenuPosition,
  movedPastLongPressTolerance,
  selectMessageRange,
} from "../lib/chat/message-actions";

test("long press movement tolerance ignores slight movement and cancels at more than 10px", () => {
  assert.equal(movedPastLongPressTolerance({ x: 10, y: 10 }, { x: 20, y: 20 }), false);
  assert.equal(movedPastLongPressTolerance({ x: 10, y: 10 }, { x: 21, y: 10 }), true);
});

test("message menu stays anchored 9px below and horizontally clamped", () => {
  const position = messageMenuPosition(
    { left: 280, right: 340, top: 100, bottom: 140 },
    { width: 200, height: 120 }, { width: 360, height: 700 });
  assert.equal(position.placeBelow, true);
  assert.equal(position.top, 140 + MESSAGE_MENU_GAP_PX);
  assert.equal(position.left, 152);
});

test("message menu flips above when the lower viewport cannot fit it", () => {
  const position = messageMenuPosition(
    { left: 80, right: 180, top: 500, bottom: 550 },
    { width: 220, height: 160 }, { width: 360, height: 600 });
  assert.equal(position.placeBelow, false);
  assert.equal(position.top, 500 - MESSAGE_MENU_GAP_PX - 160);
});

test("select from here includes the anchor and every later stored message", () => {
  assert.deepEqual(selectMessageRange(["a", "b", "c", "d"], "b"), ["b", "c", "d"]);
  assert.deepEqual(selectMessageRange(["a"], "missing"), []);
});
