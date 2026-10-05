import assert from "node:assert/strict";
import test from "node:test";
import { fitVisualViewport } from "../lib/chat/viewport";

test("chat room follows a keyboard-shrunken visual viewport", () => {
  assert.deepEqual(
    fitVisualViewport({ top: 0, bottom: 844 }, { offsetTop: 0, height: 510 }),
    { height: 510, offsetTop: 0 },
  );
  assert.deepEqual(
    fitVisualViewport({ top: 0, bottom: 844 }, { offsetTop: 96, height: 414 }),
    { height: 414, offsetTop: 96 },
  );
});

test("chat viewport stays clipped to a desktop Phone Shell", () => {
  assert.deepEqual(
    fitVisualViewport({ top: 24, bottom: 868 }, { offsetTop: 0, height: 900 }),
    { height: 844, offsetTop: 0 },
  );
});
