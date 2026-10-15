import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("app/messages/chat.css", "utf8");
const timeline = readFileSync("components/chat/messages/message-list.tsx", "utf8");
const transfer = readFileSync("components/chat/transfers/transfer-card.tsx", "utf8");
const gift = readFileSync("components/chat/gifts/gift-card.tsx", "utf8");

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing rule ${selector}`);
  return match[1];
};

test("transfer and gift cards keep a stable responsive width without fixed heights", () => {
  const container = rule(".chat-message-transfer, .chat-message-gift");
  assert.match(container, /width:\s*min\(260px, calc\(100% - var\(--chat-avatar-size\)/);
  assert.match(container, /max-width:\s*none/);
  const transferCard = rule(".chat-transfer-card");
  assert.match(transferCard, /width:\s*100%/);
  assert.doesNotMatch(transferCard, /height:/);
  assert.match(transferCard, /grid-template-rows:/);
  const giftCard = rule(".chat-gift-card");
  assert.match(giftCard, /width:\s*100%/);
  assert.doesNotMatch(giftCard, /height:/);
  assert.match(rule(".chat-result-card"), /width:\s*100%/);
});

test("amount stays complete and transfer note remains fully reachable", () => {
  const amount = rule(".chat-transfer-amount");
  assert.match(amount, /font-size:\s*clamp/);
  assert.match(amount, /overflow:\s*hidden/);
  assert.match(amount, /white-space:\s*nowrap/);
  assert.match(rule(".chat-transfer-amount-long"), /font-size:\s*clamp/);
  assert.match(transfer, /amount\.length > 15/);
  const note = rule(".chat-transfer-note");
  assert.match(note, /overflow:\s*auto/);
  assert.match(transfer, /tabIndex=\{transfer\.note \? 0 : undefined\}/);
  assert.doesNotMatch(note, /line-clamp/);
});

test("gift preview clamps rendered lines while its existing detail keeps the full content", () => {
  const content = rule(".chat-gift-content");
  assert.match(content, /-webkit-line-clamp:\s*2/);
  assert.match(content, /max-height:\s*2\.6em/);
  assert.match(gift, /role="dialog"[\s\S]*?<p>\{gift\.content\}<\/p>/);
});

test("special card backgrounds inherit the final role bubble background without taking bubble box styles", () => {
  assert.match(transfer, /chat-card-color-source chat-bubble-role-\$\{message\.role\}/);
  assert.match(gift, /chat-card-color-source chat-bubble-role-\$\{message\.role\}/);
  assert.match(rule(".chat-card-color-source"), /display:\s*contents/);
  assert.match(rule(".chat-transfer-card"), /background:\s*inherit/);
  assert.match(rule(".chat-gift-card"), /background:\s*inherit/);
  assert.match(rule(".chat-bubble-role-assistant"), /background:\s*var\(--theme-surface\)/);
  assert.match(rule(".chat-bubble-role-user"), /background:\s*color-mix/);
});

test("sender alignment is owned by the message container", () => {
  assert.match(rule(".chat-turn-user .chat-message"), /margin-left:\s*auto/);
  assert.match(rule(".chat-turn-assistant .chat-message"), /margin-right:\s*auto/);
  assert.match(timeline, /chat-message\$\{specialKind\}/);
});

test("top reactions reserve layout height and use ordered sender-side stacks", () => {
  assert.match(timeline, /chat-bubble-shell-has-reactions/);
  assert.match(timeline, /className="chat-reaction-stack"/);
  assert.match(rule(".chat-bubble-shell-has-reactions"), /padding-top:\s*10px/);
  assert.match(rule(".chat-reaction-stack"), /top:\s*1px/);
  assert.match(rule(".chat-reaction-stack"), /display:\s*flex/);
  assert.match(rule(".chat-reaction-stack"), /gap:\s*2px/);
  assert.match(rule(".chat-turn-assistant .chat-reaction-stack"), /right:\s*-4px/);
  assert.match(rule(".chat-turn-user .chat-reaction-stack"), /left:\s*-4px/);
  assert.doesNotMatch(rule(".chat-reaction-badge"), /position:\s*absolute|top:|bottom:/);
});
