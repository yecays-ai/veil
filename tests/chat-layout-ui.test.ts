import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const room = readFileSync("components/chat/chat-room.tsx", "utf8");
const css = readFileSync("app/messages/chat.css", "utf8");
const appearance = readFileSync("app/appearance.css", "utf8");

function rule(selector: string): string {
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${pattern}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing rule: ${selector}`);
  return match[1];
}

test("chat header is a glass overlay with the requested lightweight controls", () => {
  for (const icon of ["ChevronLeft", "ChevronRight", "Ellipsis"])
    assert.match(room, new RegExp(`<${icon}`));
  assert.doesNotMatch(room, /Video|>Back</);
  assert.match(css, /\.chat-header\s*\{[^}]*position:\s*absolute;[^}]*backdrop-filter:\s*blur/);
  assert.doesNotMatch(css, /\.chat-header\s*\{[^}]*(?:border-bottom|linear-gradient)/);
  assert.match(css, /\.chat-header\s*\{[^}]*position:\s*absolute;[^}]*top:\s*var\(--chat-viewport-top/);
  assert.doesNotMatch(room, /--chat-viewport-offset-top|--chat-visual-height/);
  assert.match(css, /\.chat-history\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(appearance, /\.theme-surface:not\(:has\(\.home-screen\)\) \.theme-home-wallpaper/);
});

test("assistant groups retain one avatar and a shared gutter while delivery stays on the last visible message", () => {
  assert.match(room, /groupedMessages\.map\(\(\{ message, showTimestamp, isGroupStart, isGroupEnd \}\)/);
  assert.match(room, /message\.role === "assistant" && <div className="chat-avatar-column chat-msg-avatar">\s*\{isGroupStart && <ChatAvatar/);
  assert.match(css, /--chat-avatar-size:\s*40px;/);
  assert.match(css, /--chat-avatar-gap:\s*8px;/);
  assert.match(css, /\.chat-avatar-column\s*\{[^}]*flex:\s*0 0 var\(--chat-avatar-size\)/);
  assert.match(css, /\.chat-turn-assistant::after\s*\{[^}]*content:\s*"";[^}]*flex:\s*0 0 var\(--chat-avatar-size\)/);
  assert.match(css, /\.chat-turn-assistant \.chat-avatar\s*\{[^}]*width:\s*var\(--chat-avatar-size\);[^}]*height:\s*var\(--chat-avatar-size\);[^}]*border-radius:\s*20px;/);
  assert.match(css, /\.chat-turn-assistant \.chat-message\s*\{[^}]*max-width:\s*calc\(100% - var\(--chat-avatar-size\) - var\(--chat-avatar-size\) - var\(--chat-avatar-gap\) - var\(--chat-avatar-gap\)\)/);
  assert.doesNotMatch(room, /chat-user-gutter/);
  assert.doesNotMatch(css, /chat-user-gutter/);
  assert.doesNotMatch(css, /\.chat-turn-assistant:not\(\.chat-group-start\)/);
  assert.doesNotMatch(room, /message\.role === "user" &&[^\n]*<(?:ChatAvatar|div className="chat-avatar-column")/);
  assert.match(room, /isGroupEnd \? resolveUserMessageDelivery\(message\) : null/);
  assert.match(room, /const lastVisibleMessageId = groupedMessages\.at\(-1\)\?\.message\.id/);
  assert.match(room, /delivery && !typing && message\.id === lastVisibleMessageId && <span className="chat-delivery-status">/);
  assert.match(room, /isGroupEnd \? " chat-group-end"/);
  assert.doesNotMatch(css, /\.chat-bubble::(?:before|after)/);
  assert.match(css, /\.chat-turn-user\s*\{\s*justify-content:\s*flex-end;\s*\}/);
});

test("same-sender bubbles group by corners without merging or tapering the outer side", () => {
  // Same-sender spacing tightens; the switch between senders keeps its own gap.
  assert.match(rule(".chat-turn"), /margin-bottom:\s*16px/);
  assert.match(rule(".chat-turn:not(.chat-group-end)"), /margin-bottom:\s*2px/);
  // Height-adaptive: a single-line bubble clamps to half its height (pill-round)
  // while taller bubbles stop at the 24px cap.
  assert.match(rule(".chat-bubble"), /border-radius:\s*24px/);
  // Incoming: the joined side is the left edge, the right side stays round.
  const assistantFirst = rule(".chat-turn-assistant.chat-group-start:not(.chat-group-end) .chat-bubble");
  assert.match(assistantFirst, /border-bottom-left-radius:\s*6px/);
  assert.doesNotMatch(assistantFirst, /border-top-left-radius|border-radius:/);
  const assistantMiddle = rule(".chat-turn-assistant.chat-group-middle .chat-bubble");
  assert.match(assistantMiddle, /border-top-left-radius:\s*6px/);
  assert.match(assistantMiddle, /border-bottom-left-radius:\s*6px/);
  const assistantLast = rule(".chat-turn-assistant.chat-group-end:not(.chat-group-start) .chat-bubble");
  assert.match(assistantLast, /border-top-left-radius:\s*6px/);
  assert.doesNotMatch(assistantLast, /border-bottom-left-radius|border-radius:/);
  // Outgoing mirrors it on the right edge.
  const userFirst = rule(".chat-turn-user.chat-group-start:not(.chat-group-end) .chat-bubble");
  assert.match(userFirst, /border-bottom-right-radius:\s*6px/);
  assert.doesNotMatch(userFirst, /border-top-right-radius|border-radius:/);
  const userMiddle = rule(".chat-turn-user.chat-group-middle .chat-bubble");
  assert.match(userMiddle, /border-top-right-radius:\s*6px/);
  assert.match(userMiddle, /border-bottom-right-radius:\s*6px/);
  const userLast = rule(".chat-turn-user.chat-group-end:not(.chat-group-start) .chat-bubble");
  assert.match(userLast, /border-top-right-radius:\s*6px/);
  assert.doesNotMatch(userLast, /border-bottom-right-radius|border-radius:/);
  // A standalone bubble carries both group classes, so every corner stays round.
  assert.match(room, /className="chat-turn chat-turn-assistant chat-msg-wrapper" role="status" aria-label="Typing"/);
  assert.match(room, /isGroupStart \|\| isGroupEnd \? "" : " chat-group-middle"/);
  // Corner rules never leak onto the typing indicator turn (no group class).
  assert.doesNotMatch(css, /^\.chat-turn-(?:assistant|user):not\(\.chat-group-start\) \.chat-bubble/m);
  assert.doesNotMatch(css, /^\.chat-turn-(?:assistant|user):not\(\.chat-group-end\) \.chat-bubble/m);
  assert.doesNotMatch(css, /\.chat-bubble::(?:before|after)/);
});

test("typing copy and enabled Send retain lightweight presentation", () => {
  assert.doesNotMatch(room, /Typing…/);
  assert.match(room, /const typingIndicator = typing &&/);
  assert.match(room, /className="chat-typing-dots" aria-hidden="true"><i \/><i \/><i \/>/);
  assert.match(css, /\.chat-typing-dots i\s*\{[^}]*width:\s*8px;[^}]*height:\s*8px;[^}]*animation:\s*chat-typing-pulse/);
  assert.match(css, /nth-child\(2\).*animation-delay:\s*\.16s/);
  assert.match(css, /nth-child\(3\).*animation-delay:\s*\.32s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.chat-typing-dots i \{ animation: none;/);
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
  assert.match(room, /Search Chat History/);
  assert.match(room, /Search messages in this conversation/);
  assert.match(room, /placeholder="Search messages"/);
  assert.match(room, /Pin Conversation/);
  assert.match(room, /checked=\{pinned\}/);
  assert.match(room, /Streaming Replies/);
  assert.match(room, /Reply When Keyboard Closes/);
  assert.match(room, /Clear Chat History/);
  assert.doesNotMatch(room, /chat-settings-menu/);
  assert.doesNotMatch(css, /\.chat-settings-menu/);
  assert.match(css, /\.chat-info-screen\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.chat-info-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.chat-info-group\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*20px/);
  assert.match(css, /\.chat-info-group \.chat-session-setting \+ \.chat-session-setting::before\s*\{[^}]*left:\s*20px/);
  assert.match(css, /input\.chat-info-switch:checked\s*\{\s*background:\s*var\(--theme-accent\);/);
  assert.match(css, /\.chat-app button\.chat-info-clear\s*\{[^}]*color:\s*#c9363e/);
  assert.match(room, /<span>Chat Background/);
  assert.match(room, /<ChatBackgroundSettings session=\{session\}/);
  assert.match(room, /data-chat-background=\{chatBackground\.url \? "custom" : "default"\}/);
  assert.match(room, /--chat-background-image/);
  assert.match(css, /\.chat-room\[data-chat-background="custom"\]::before\s*\{[^}]*z-index:\s*0/);
  assert.match(room, /<span>Custom CSS<small>/);
  assert.match(room, /<CustomCSSSettings session=\{session\}/);
  assert.match(room, /session\?\.customCSS && <SessionCustomCSS css=\{session\.customCSS\}/);
  assert.match(room, /className="chat-app chat-room chat-room-wrapper"/);
  assert.match(room, /chat-bubble-role-\$\{message\.role\}/);
  for (const hook of ["chat-bubble-role-assistant", "chat-msg-wrapper", "chat-msg-avatar",
    "chat-scroll-anchored", "chat-input-bar", "chat-input-textarea", "chat-input-actions"])
    assert.match(room, new RegExp(hook));
});

test("Chat history search returns through Chat Info and jumps by message ID without changing chat data", () => {
  assert.match(room, /onJumpToMessage=\{\(messageId\) => \{[\s\S]*setPendingSearchJumpId\(messageId\);[\s\S]*setChatInfoOpen\(false\);/);
  assert.match(room, /querySelectorAll<HTMLElement>\("\[data-message-id\]"\)/);
  assert.match(room, /element\.dataset\.messageId === pendingSearchJumpId/);
  assert.match(room, /container\.scrollTo\(\{ top: container\.scrollTop \+ centeredOffset, behavior: "smooth" \}\)/);
  assert.match(room, /setHighlightedMessageId\(pendingSearchJumpId\)/);
  assert.match(room, /onAnimationEnd=\{\(\) => \{ if \(highlightedMessageId === message\.id\) setHighlightedMessageId\(null\); \}\}/);
  assert.match(room, /function ChatHistorySearchPage/);
  assert.match(room, /searchConversationMessages\(messages, sessionId, trimmed, controller\.signal\)/);
  assert.match(room, /message\.role === "user" \? "Me" : characterName/);
  assert.match(room, /onClick=\{\(\) => onJumpToMessage\(message\.id\)\}/);
  assert.match(room, /message\.id !== pendingSearchJumpId && !!revealState && hiddenForReveal/);
  assert.match(css, /\.chat-turn-search-highlight \.chat-bubble\s*\{\s*animation: chat-search-highlight 1\.7s/);
  assert.doesNotMatch(room.slice(room.indexOf("onJumpToMessage={(messageId)"), room.indexOf("onUpdate={updateSetting}")), /chatStorage|chatEngine/);
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
  assert.match(room, /chatKeyboardInset\(/);
  assert.match(room, /composer\.current === globalThis\.document\.activeElement/);
  assert.match(room, /--chat-keyboard-inset/);
  assert.match(css, /\.chat-header\s*\{[^}]*min-height:\s*calc\(var\(--chat-safe-top, var\(--app-safe-top\)\) \+ 62px\)/);
  assert.match(css, /\.chat-composer\s*\{[^}]*bottom:\s*var\(--chat-keyboard-inset/);
});
