import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profile = readFileSync("components/profile-pages.tsx", "utf8");
const profileSettings = readFileSync("app/profile/settings/page.tsx", "utf8");
const systemSettings = readFileSync("app/settings/page.tsx", "utf8");

test("Profile Settings has its own route and only mounts the three Chat Settings", () => {
  assert.match(profile, /href="\/profile\/settings">Settings/);
  assert.match(profileSettings, /<GlobalProfileSettings\s*\/>/);
  assert.match(profileSettings, /backHref="\/profile"/);
  assert.doesNotMatch(profileSettings, /RuntimeSettings|TextApiSettings|CardGrid|Bindings|WorldBook|Regex/);

  const chatSettings = readFileSync("components/settings/global-profile-settings.tsx", "utf8");
  for (const section of ["Global Chat Background", "Message Bubble Timing", "Here &amp; There Comments"])
    assert.match(chatSettings, new RegExp(section));
  assert.equal((chatSettings.match(/className="global-profile-section"/g) ?? []).length, 3);
});

test("system Settings keeps Runtime and Creator configuration without Profile Chat Settings", () => {
  assert.match(systemSettings, /<RuntimeSettings\s*\/>/);
  for (const item of ["Text API", "Presets", "Bindings", "WorldBooks", "Regex"])
    assert.match(systemSettings, new RegExp(`label: "${item}"`));
  assert.doesNotMatch(systemSettings, /GlobalProfileSettings|Global Chat Background|Message Bubble Timing|Here.*There Comments/);
});
