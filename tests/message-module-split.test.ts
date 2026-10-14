import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
const actions = readFileSync("components/chat/message-actions/message-actions-overlay.tsx", "utf8");

test("ChatRoom composes the independent timeline and action overlay", () => {
  assert.match(room, /import \{ MessageList \} from "\.\/messages\/message-list"/);
  assert.match(room, /import \{ MessageActionsOverlay \} from "\.\/message-actions\/message-actions-overlay"/);
  assert.match(room, /<MessageList\b/);
  assert.match(room, /<MessageActionsOverlay\b/);
  assert.doesNotMatch(room, /import \{ ReactionBar, ReactionPickerSheet \}/);
  assert.doesNotMatch(room, /import \{ StickerImage \}/);
});

test("the extracted modules retain message rendering and action ownership", () => {
  assert.match(timeline, /groupedMessages\.map/);
  assert.match(timeline, /<StickerImage/);
  assert.match(timeline, /<MessageFooter/);
  assert.match(actions, /<ReactionBar/);
  assert.match(actions, /getMessageActions\(activeMessage\)/);
});
