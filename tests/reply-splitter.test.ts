import assert from "node:assert/strict";
import test from "node:test";
import { splitAssistantReply } from "../lib/chat/reply-splitter";

test("assistant replies split only on two or more newlines", () => {
  assert.deepEqual(splitAssistantReply("A\n\nB\n\nC"), ["A", "B", "C"]);
  assert.deepEqual(splitAssistantReply("A\n\n\n\nB"), ["A", "B"]);
  assert.deepEqual(splitAssistantReply("A\nB"), ["A\nB"]);
});

test("assistant reply parts are trimmed, empty parts dropped, and one segment stays one", () => {
  assert.deepEqual(splitAssistantReply("  \n\n A  \n\n   \n\n B \n\n"), ["A", "B"]);
  assert.deepEqual(splitAssistantReply("  one natural message  "), ["one natural message"]);
  assert.deepEqual(splitAssistantReply(" \n\n\n "), []);
});

test("repeated literal Blank separators between paragraphs are treated as formatting", () => {
  assert.deepEqual(splitAssistantReply(
    "First paragraph\n\nBlank\n\nSecond paragraph\n\nBlank\n\nThird paragraph"),
  ["First paragraph", "Second paragraph", "Third paragraph"]);
  assert.deepEqual(splitAssistantReply("A\n\nBlank\n\nB"), ["A", "Blank", "B"]);
});
