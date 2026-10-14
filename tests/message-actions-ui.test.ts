import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
const actions = readFileSync("components/chat/message-actions/message-actions-overlay.tsx", "utf8");
const css = readFileSync("app/messages/chat.css", "utf8");

test("message actions open from a bubble tap with the bubble element as anchor", () => {
  assert.match(timeline, /onClick=\{\(event\) => onOpenActions\(event, message\)\}/);
  assert.match(room, /setMenuAnchor\(e\.currentTarget\)/);
  assert.doesNotMatch(room, /longPress|setTimeout\([^)]*Message Actions/i);
  assert.match(room, /globalThis\.document\.addEventListener\("selectionchange", trackSelection\)/);
  assert.match(room, /nativeSelectionActive\.current \|\|/);
  assert.match(timeline, /onContextMenu=\{onContextMenuMessage\}/);
  assert.doesNotMatch(timeline, /onContextMenu=\{[^}]*preventDefault/);
});

test("message text selection remains native and the anchored positioning observers remain", () => {
  assert.doesNotMatch(css, /(?:-webkit-)?user-select\s*:\s*none/i);
  assert.doesNotMatch(css, /-webkit-touch-callout\s*:\s*none/i);
  assert.match(room, /new ResizeObserver\(position\)/);
  assert.match(room, /window\.visualViewport\?\.addEventListener\("resize", position\)/);
  assert.match(room, /window\.visualViewport\?\.addEventListener\("scroll", position\)/);
  assert.match(room, /window\.addEventListener\("scroll", position, true\)/);
});

test("the fixed 4 by 2 action set uses one Lucide icon family", () => {
  for (const mapping of [
    ["Copy", "Copy"], ["Edit", "Pencil"], ["Quote", "Quote"],
    ["Memory", "Brain"], ["Select", "CircleCheck"], ["Favorite", "Bookmark"],
    ["Delete", "Trash2"], ["Regenerate", "RotateCcw"],
  ]) assert.match(actions, new RegExp(`label="${mapping[0]}" icon=\\{${mapping[1]}\\}`));
  assert.equal((actions.match(/<Action label=/g) || []).length, 8);
  assert.match(actions, /<Icon size=\{25\} strokeWidth=\{1\.75\}/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,/);
  assert.match(css, /width:\s*min\(360px, 92%\)/);
});
