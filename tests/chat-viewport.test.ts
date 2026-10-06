import assert from "node:assert/strict";
import test from "node:test";
import { chatKeyboardInset } from "../lib/chat/viewport";

test("composer follows the lowest reliable iOS keyboard edge", () => {
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 635 }, 82, 844), 127);
  assert.equal(chatKeyboardInset(844, { offsetTop: 82, height: 635 }, 0, 844), 127);
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 635 }, 0, 717), 127);
});

test("keyboard inset remains inside the Phone Shell", () => {
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 900 }, 0, 844), 0);
  assert.equal(chatKeyboardInset(844, { offsetTop: 0, height: 510 }, 0, 844), 334);
});
