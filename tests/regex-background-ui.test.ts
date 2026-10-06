import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultSnapshot, normalizeSnapshot } from "../lib/theme-types";

test("Regex has one Settings entry and inline Default/Custom Rules", () => {
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const list = readFileSync("components/settings/regex/regex-list.tsx", "utf8");
  const row = readFileSync("components/settings/regex/regex-inline-rule.tsx", "utf8");
  assert.doesNotMatch(settings, /\/settings\/chat-formatting|Advanced Regex/);
  assert.match(settings, /label: "Regex"/);
  assert.match(list, /<h2>Default Rules<\/h2>/);
  assert.match(list, /<h2>Custom Rules<\/h2>/);
  for (const label of ["Name", "Find", "Replace", "Applies To", "Mode"])
    assert.match(row, new RegExp(label));
  assert.match(row, /<Switch aria-label=\{`Enable \$\{rule\.name \|\| "rule"\}`\}/);
  assert.doesNotMatch(row, /<input type="checkbox" checked=\{rule\.enabled\}/);
  assert.doesNotMatch(row, />Enabled<\/label>/);
  assert.match(row, /aria-expanded=\{open\}/);
});

test("Chat Background uses existing crop dialog and blurs only its layer", () => {
  const editor = readFileSync("components/chat/chat-background-settings.tsx", "utf8");
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const css = readFileSync("app/messages/chat.css", "utf8");
  assert.match(editor, /<ImageCropDialog source=\{crop\}/);
  assert.match(editor, /onCancel=\{\(\) => setCrop\(null\)\}/);
  assert.match(editor, /saveChatImageToIndexedDB\(await \(await fetch\(value\)\)\.blob\(\)\)/);
  assert.match(room, /--chat-background-blur/);
  assert.match(css, /\.chat-room\[data-chat-background="custom"\]::before\s*\{[^}]*filter: blur/);
  assert.doesNotMatch(css.match(/\.chat-room\s*\{[^}]+\}/)?.[0] ?? "", /filter:/);
});

test("legacy wallpaper position fields are ignored without losing the image", () => {
  const source = defaultSnapshot();
  const legacy = { ...source, profile: { ...source.profile,
    wallpaper: { ...source.profile.wallpaper, source: "https://example.com/photo.png",
      x: 30, y: 65, scale: 145 } } };
  const normalized = normalizeSnapshot(legacy);
  assert.equal(normalized.profile.wallpaper.source, "https://example.com/photo.png");
  assert(!("x" in normalized.profile.wallpaper));
  assert(!("y" in normalized.profile.wallpaper));
  assert(!("scale" in normalized.profile.wallpaper));
});
