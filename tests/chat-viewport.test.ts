import assert from "node:assert/strict";
import test from "node:test";
import { chatHeaderOffset, chatKeyboardInset, createStableHeaderOffset } from "../lib/chat/viewport";

test("transient keyboard offsets returning to zero never move the Header", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const offsets: number[] = [];
  const header = createStableHeaderOffset((offset) => offsets.push(offset));
  header.update(chatHeaderOffset(82, 0));
  context.mock.timers.tick(60);
  header.update(chatHeaderOffset(0, 40));
  context.mock.timers.tick(60);
  header.update(chatHeaderOffset(0, 0));
  context.mock.timers.tick(200);
  assert.deepEqual(offsets, []);
});

test("stable final Header offset applies while Composer measurements remain immediate", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const offsets: number[] = [];
  const header = createStableHeaderOffset((offset) => offsets.push(offset));
  header.update(chatHeaderOffset(0, 82));
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 635 }, 82, 844), 127);
  context.mock.timers.tick(119);
  assert.deepEqual(offsets, []);
  context.mock.timers.tick(1);
  assert.deepEqual(offsets, [82]);
  header.update(0);
  context.mock.timers.tick(120);
  assert.deepEqual(offsets, [82, 0]);
  header.update(50);
  header.cancel();
  context.mock.timers.tick(120);
  assert.deepEqual(offsets, [82, 0]);
});

test("header follows whichever iOS viewport signal reports keyboard panning", () => {
  assert.equal(chatHeaderOffset(82, 0), 82);
  assert.equal(chatHeaderOffset(0, 82), 82);
  assert.equal(chatHeaderOffset(82, 82), 82);
  assert.equal(chatHeaderOffset(0, 0), 0);
});

test("composer follows the lowest reliable iOS keyboard edge", () => {
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 635 }, 82, 844), 127);
  assert.equal(chatKeyboardInset(844, { offsetTop: 82, height: 635 }, 0, 844), 127);
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 635 }, 0, 717), 127);
});

test("keyboard inset remains inside the Phone Shell", () => {
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 900 }, 0, 844), 0);
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 510 }, 0, 844), 334);
});
