import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const css = readFileSync("app/messages/chat.css", "utf8");
const appearance = readFileSync("app/appearance.css", "utf8");

test("chat header is a glass overlay with the requested lightweight controls", () => {
  for (const icon of ["ChevronLeft", "ChevronRight", "Ellipsis"])
    assert.match(room, new RegExp(`<${icon}`));
  assert.doesNotMatch(room, /Video|>Back</);
  assert.match(css, /\.chat-header\s*\{[^}]*position:\s*absolute;[^}]*backdrop-filter:\s*blur/);
  assert.doesNotMatch(css, /\.chat-header\s*\{[^}]*(?:border-bottom|linear-gradient)/);
  assert.match(css, /\.chat-header\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;/);
  assert.doesNotMatch(room, /--chat-viewport-offset-top|--chat-visual-height/);
  assert.match(css, /\.chat-history\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(appearance, /:not\(:has\(\.chat-room\)\)/);
});

test("assistant groups retain one avatar and a shared gutter while delivery uses group end", () => {
  assert.match(room, /groupedMessages\.map\(\(\{ message, showTimestamp, isGroupStart, isGroupEnd \}\)/);
  assert.match(room, /message\.role === "assistant" && <div className="chat-avatar-column">\s*\{isGroupStart && <ChatAvatar/);
  assert.match(css, /\.chat-avatar-column\s*\{[^}]*width:\s*40px;[^}]*flex:\s*0 0 40px;/);
  assert.match(css, /\.chat-turn-assistant \.chat-avatar\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*border-radius:\s*20px;/);
  assert.match(css, /\.chat-turn-assistant \.chat-message\s*\{[^}]*max-width:\s*calc\(100% - 48px\);/);
  assert.doesNotMatch(css, /\.chat-turn-assistant:not\(\.chat-group-start\)/);
  assert.doesNotMatch(room, /message\.role === "user" &&[^\n]*<(?:ChatAvatar|div className="chat-avatar-column")/);
  assert.match(room, /isGroupEnd \? resolveUserMessageDelivery\(message\) : null/);
  assert.match(room, /isGroupEnd \? " chat-group-end"/);
  assert.doesNotMatch(css, /\.chat-bubble::(?:before|after)/);
  assert.match(css, /\.chat-turn-user\s*\{\s*justify-content:\s*flex-end;\s*\}/);
});

test("typing copy and enabled Send retain lightweight presentation", () => {
  assert.match(room, /Typing…/);
  assert.doesNotMatch(room, /Replying/);
  const enabledSend = css.match(/\.chat-app button\.chat-send:not\(:disabled\)\s*\{([^}]*)\}/)?.[1];
  assert.ok(enabledSend);
  assert.doesNotMatch(enabledSend, /background|color:/);
  assert.match(css, /\.chat-app button\.chat-send:disabled\s*\{[^}]*opacity:/);
});

test("More opens a full-screen scrollable Chat Info view instead of a popover", () => {
  assert.match(room, /onClick=\{\(\) => setChatInfoOpen\(true\)\}/);
  assert.match(room, /className="chat-info-screen"/);
  assert.match(room, /<h1>Chat Info<\/h1>/);
  assert.match(room, /Streaming Replies/);
  assert.match(room, /Reply When Keyboard Closes/);
  assert.match(room, /Clear Chat/);
  assert.doesNotMatch(room, /chat-settings-menu/);
  assert.doesNotMatch(css, /\.chat-settings-menu/);
  assert.match(css, /\.chat-info-screen\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.chat-info-body\s*\{[^}]*overflow-y:\s*auto/);
});

test("message input focus has no accent outline, ring, or shadow", () => {
  assert.match(css, /\.chat-input-shell textarea:focus,[\s\S]*outline:\s*none !important;[\s\S]*box-shadow:\s*none !important;/);
});

test("composer keeps Send and conditional Request Reply as separate icon actions", () => {
  assert.match(room, /aria-label="More message options"/);
  assert.match(room, /className="chat-voice-slot"/);
  assert.match(room, /session\?\.autoReplyOnKeyboardDismiss !== true/);
  assert.match(room, /aria-label="Request Reply"[\s\S]*<Sparkles/);
  assert.match(room, /aria-label="Send"[\s\S]*<SendHorizontal/);
  assert.match(room, /disabled=\{!session \|\| sending \|\| !draft\.trim\(\)/);
  assert.doesNotMatch(room, />\s*(?:Send|Request Reply)\s*</);
});

test("composer overlays the wallpaper and tracks its measured height", () => {
  assert.match(css, /\.chat-composer\s*\{[^}]*position:\s*absolute;[^}]*backdrop-filter:\s*blur/);
  assert.match(css, /--chat-composer-height/);
  assert.match(room, /new ResizeObserver\(update\)/);
  assert.match(room, /Math\.min\(textarea\.scrollHeight, 120\)/);
});

test("iOS keyboard handling keeps header and history on the stable chat canvas", () => {
  assert.match(css, /\.chat-history\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.chat-composer\s*\{[^}]*bottom:\s*0;/);
  assert.doesNotMatch(room, /--chat-keyboard-inset/);
  assert.doesNotMatch(css, /--chat-keyboard-inset/);
});
