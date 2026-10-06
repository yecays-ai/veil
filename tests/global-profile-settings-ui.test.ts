import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync("components/settings/global-profile-settings.tsx", "utf8");
const css = readFileSync("app/settings/settings.css", "utf8");
const sharedCss = readFileSync("app/globals.css", "utf8");

test("Profile Chat Settings disclosure rows start collapsed and mount their own controls on demand", () => {
  assert.match(ui, /const \[backgroundExpanded, setBackgroundExpanded\] = useState\(false\)/);
  assert.match(ui, /const \[timingExpanded, setTimingExpanded\] = useState\(false\)/);
  assert.match(ui, /aria-expanded=\{backgroundExpanded\}[\s\S]*setBackgroundExpanded\(\(expanded\) => !expanded\)/);
  assert.match(ui, /aria-expanded=\{timingExpanded\}[\s\S]*setTimingExpanded\(\(expanded\) => !expanded\)/);
  assert.match(ui, /\{backgroundExpanded && <div className="global-profile-disclosure-content">[\s\S]*?global-background-card/);
  assert.match(ui, /\{timingExpanded && <div className="global-profile-disclosure-content">[\s\S]*?global-timing-fields/);
  assert.match(ui, /DEFAULT_BUBBLE_TIMING\[tier\]/);
  assert.match(ui, /1–60 characters[\s\S]*61–200 characters[\s\S]*200\+ characters/);
  assert.match(ui, /className="chat-info-group profile-chat-settings-group"[\s\S]*?global-profile-disclosure global-chat-disclosure-panel[\s\S]*?global-here-there-toggle/);
  assert.match(css, /\.profile-chat-settings \.global-profile-disclosure-row\[aria-expanded="true"\] > svg/);
  assert.match(css, /\.profile-chat-settings \.global-timing-row input\s*\{\s*width:\s*62px/);
  assert.match(css, /\.profile-chat-settings \.global-timing-row input\s*\{\s*width:\s*58px/);
});

test("Here & There remains one existing toggle row with no extra heading or explanation", () => {
  assert.equal((ui.match(/Here &amp; There Comments/g) ?? []).length, 1);
  assert.doesNotMatch(ui, /Allow occasional short Character remarks about the local time and weather\./);
  assert.match(ui, /className="chat-session-setting chat-info-toggle global-here-there-toggle"[\s\S]*?<strong>Here &amp; There Comments<\/strong>[\s\S]*?<Switch checked=\{settings\?\.hereThereEnabled \?\? true\}/);
  assert.match(ui, /await chatStorage\.updateHereThereEnabled\(enabled\)/);
});

test("Profile Settings reuses Chat Info group and row typography without changing shared section labels", () => {
  assert.match(ui, /className="chat-session-setting chat-info-row global-profile-disclosure-row"/);
  assert.match(css, /\.profile-chat-settings \.global-profile-disclosure-row\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*500/);
  assert.match(css, /\.profile-chat-settings \.global-here-there-toggle\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*500/);
  assert.match(sharedCss, /\.chat-info-group\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*20px;[^}]*background:\s*var\(--theme-surface\)/);
  assert.match(css, /\.settings-app \.settings-section-label\s*\{[^}]*font-size:\s*13px;[^}]*opacity:\s*0\.65/);
});
