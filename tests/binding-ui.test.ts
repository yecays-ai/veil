import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Binding routes put Global Defaults on the home page and expose Character and App editors", () => {
  for (const path of ["app/settings/bindings/page.tsx",
    "app/settings/bindings/[characterId]/page.tsx",
    "app/settings/bindings/[characterId]/[appId]/page.tsx"])
    assert(existsSync(path));
  assert(!existsSync("app/settings/bindings/global/page.tsx"));
  assert(!existsSync("app/messages/settings/page.tsx"));
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const editor = readFileSync("components/settings/bindings/binding-manager.tsx", "utf8");
  const resources = readFileSync("components/settings/bindings/use-binding-manager.ts", "utf8");
  assert.match(settings, /href: "\/settings\/bindings"/);
  for (const label of ["Text API", "Preset", "WorldBook", "Regex"])
    assert.match(editor, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(editor, /Voice|Image API|Embedding|MCP|Skills|Workspace/);
  assert.match(editor, /<BindingFields title="Global Defaults"/);
  assert.doesNotMatch(editor, /Manage defaults/);
  assert.match(editor, /document\.characters\.map/);
  assert.match(editor, /No Characters yet/);
  assert.match(editor, /bindingApps\.map/);
  assert.match(editor, /appBindingFields\(app\)/);
  assert.match(editor, /Inherited/);
  assert.match(editor, /Override/);
  assert.match(editor, /Reset to Global/);
  assert.match(editor, /Inherit Character/);
  assert.match(resources, /item\.id !== DEFAULT_REGEX_GROUP_ID/);
  assert.match(resources, /cleanStaleBindings/);
});
