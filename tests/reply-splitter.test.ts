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

test("standalone Blank line placeholders with case, punctuation and whitespace variants are discarded", () => {
  const placeholders = ["Blank", "Blank line", "Blank line...", " blank line ... ",
    "BLANK LINE!!!", "Blank\u00a0line…", "Blank\u200b line ..", "Blank."];
  for (const placeholder of placeholders)
    assert.deepEqual(splitAssistantReply(`First paragraph\n\n${placeholder}\n\nSecond paragraph`),
      ["First paragraph", "Second paragraph"], placeholder);
  assert.deepEqual(splitAssistantReply(
    "First paragraph\n\nBlank\n\nSecond paragraph\n\nBlank line...\n\nThird paragraph"),
  ["First paragraph", "Second paragraph", "Third paragraph"]);
});

test("ordinary prose, one-line text and legitimate multi-bubble replies remain intact", () => {
  assert.deepEqual(splitAssistantReply("The phrase Blank line... appeared in the log."),
    ["The phrase Blank line... appeared in the log."]);
  assert.deepEqual(splitAssistantReply("A blank line separates these thoughts."),
    ["A blank line separates these thoughts."]);
  assert.deepEqual(splitAssistantReply("First\n\nA real message about blank lines\n\nThird"),
    ["First", "A real message about blank lines", "Third"]);
});
