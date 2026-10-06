import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const presetCss = readFileSync("app/settings/presets/presets.css", "utf8");
const shellCss = readFileSync("app/page-shell.css", "utf8");

test("Preset wrappers preserve the bounded flex chain and PageShell owns vertical scrolling", () => {
  const wrapper = presetCss.match(/\.preset-route\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(wrapper, /display:\s*flex/);
  assert.match(wrapper, /flex-direction:\s*column/);
  assert.match(wrapper, /flex:\s*1\s*;/);
  assert.match(wrapper, /min-height:\s*0/);
  assert.match(wrapper, /min-width:\s*0/);
  assert.doesNotMatch(wrapper, /(?:^|;)\s*height:/);
  assert.doesNotMatch(presetCss, /overflow(?:-y)?:\s*(?:auto|scroll)/);
  for (const file of ["preset-detail.tsx", "prompt-editor.tsx"]) {
    const component = readFileSync(`components/settings/presets/${file}`, "utf8");
    assert.match(component, /className="preset-route"/);
    assert.match(component, /<PageShell/);
  }
  const body = shellCss.match(/\.app-page-body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(body, /flex:\s*1 1 auto/);
  assert.match(body, /min-height:\s*0/);
  assert.match(body, /overflow-y:\s*auto/);
  const header = shellCss.match(/\.app-page-header\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(header, /flex:\s*none/);
});

test("Settings keeps Presets under Data & Rules and has no Backup entry", () => {
  const page = readFileSync("app/settings/page.tsx", "utf8");
  const sections = [...page.matchAll(/<CardGrid\s+label="([^"]+)"([\s\S]*?)\/>/g)];
  const rules = sections.find((section) => section[1] === "Data & Rules")?.[2] ?? "";
  assert.match(rules, /href:\s*"\/settings\/presets"/);
  assert.doesNotMatch(rules, /Data & Backup|\/settings\/data"/);
  assert.doesNotMatch(page, /Data & Backup|\/settings\/data/);
  assert.equal(existsSync("lib/backup/types.ts"), false);
  assert.equal(existsSync("app/settings/data/page.tsx"), false);
});
