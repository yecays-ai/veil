import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Settings exposes bounded WorldBook list, detail and entry editor routes", () => {
  const settings = read("app/settings/page.tsx");
  const list = read("components/settings/worldbooks/worldbook-list.tsx");
  const detail = read("components/settings/worldbooks/worldbook-detail.tsx");
  const editor = read("components/settings/worldbooks/worldbook-entry-editor.tsx");
  assert.match(settings, /href: "\/settings\/worldbooks"/);
  for (const source of [list, detail, editor]) assert.match(source, /<PageShell className="settings-app worldbook-manager"/);
  assert.match(list, /Import|New|Export|Delete/);
  assert.match(detail, /Import Entry|Export Book|Add Entry|Move/);
  for (const label of ["Keywords", "Regex keyword matching", "Case sensitive", "Position", "Scan Depth",
    "Priority", "Sticky", "Cooldown", "Delay", "Replace from JSON", "Export Entry"])
    assert.ok(editor.includes(label), `missing editor control: ${label}`);
  for (const unsupported of ["Probability", "atDepth", "injection role", "branch/version"])
    assert.ok(!editor.includes(unsupported), `unsupported editor control: ${unsupported}`);
});
