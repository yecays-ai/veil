import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Binding routes expose one global, Character and real-App editor without legacy fields", () => {
  for (const path of ["app/settings/bindings/page.tsx", "app/settings/bindings/global/page.tsx",
    "app/settings/bindings/[characterId]/page.tsx",
    "app/settings/bindings/[characterId]/[appId]/page.tsx"])
    assert(existsSync(path));
  assert(!existsSync("app/messages/settings/page.tsx"));
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const editor = readFileSync("components/settings/bindings/binding-manager.tsx", "utf8");
  const resources = readFileSync("components/settings/bindings/use-binding-manager.ts", "utf8");
  assert.match(settings, /href: "\/settings\/bindings"/);
  for (const label of ["Text API", "Preset", "WorldBook", "Regex"])
    assert.match(editor, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(editor, /Voice|Image API|Embedding|MCP|Skills|Workspace/);
  assert.match(editor, /APP_REGISTRY\.map/);
  assert.match(editor, /Reset to Global/);
  assert.match(editor, /Inherit Character/);
  assert.match(resources, /item\.id !== DEFAULT_REGEX_GROUP_ID/);
  assert.match(resources, /cleanStaleBindings/);
});
