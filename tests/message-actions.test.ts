import assert from "node:assert/strict";
import test from "node:test";
import {
  MESSAGE_MENU_GAP_PX,
  messageMenuPosition,
  messageStackShift,
  reactionBarLeft,
  selectMessageRange,
} from "../lib/chat/message-actions";

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

const stackBar = { height: 52 }, stackMenu = { height: 180 }, stackViewport = { height: 800, safeTop: 90 };

test("message stack: a bubble that already fits is not moved", () => {
  assert.equal(messageStackShift({ left: 20, right: 200, top: 300, bottom: 360 }, stackBar, stackMenu, stackViewport), 0);
});

test("message stack: a bubble near the top moves down so the bar clears the header", () => {
  const shift = messageStackShift({ left: 20, right: 200, top: 100, bottom: 160 }, stackBar, stackMenu, stackViewport);
  assert.equal(100 + shift - MESSAGE_MENU_GAP_PX - 52, 90);
});

test("message stack: a bubble near the bottom moves up so the menu stays below it", () => {
  const shift = messageStackShift({ left: 20, right: 200, top: 700, bottom: 760 }, stackBar, stackMenu, stackViewport);
  assert.ok(shift < 0);
  assert.equal(760 + shift + MESSAGE_MENU_GAP_PX + 180, 800 - 8);
});

test("message stack: a bubble too tall for the stack is pinned with the bar at the top of the safe area", () => {
  const shift = messageStackShift({ left: 20, right: 200, top: 120, bottom: 900 }, stackBar, stackMenu, stackViewport);
  assert.equal(120 + shift - MESSAGE_MENU_GAP_PX - 52, 90);
});

test("reaction bar aligns with the bubble side and stays inside the viewport", () => {
  const bubble = { left: 20, right: 120, top: 0, bottom: 40 };
  assert.equal(reactionBarLeft(bubble, 300, 390, "assistant"), 20);
  assert.equal(reactionBarLeft({ left: 270, right: 370, top: 0, bottom: 40 }, 300, 390, "user"), 70);
  assert.equal(reactionBarLeft({ left: 270, right: 370, top: 0, bottom: 40 }, 300, 390, "assistant"), 82);
  assert.equal(reactionBarLeft({ left: 0, right: 60, top: 0, bottom: 40 }, 300, 390, "user"), 8);
});
