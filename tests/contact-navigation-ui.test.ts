import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/contacts/[characterId]/page.tsx", "utf8");
const info = readFileSync("components/contact-info.tsx", "utf8");

test("direct chat passes an explicit internal return source to Contact Info", () => {
  assert.match(page, /from === "direct" \? "direct" : undefined/);
  assert.match(info, /const backHref = contactReturnTarget\(characterId, returnSource\)/);
  assert.match(info, /router\.push\(backHref\)/);
  assert.match(info, /<Link href=\{backHref\} aria-label="Back to Contacts"/);
});

test("Delete Contact dialog starts on its dialog container, preserving button focus-visible navigation", () => {
  assert.match(info, /dialog\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(info, /tabIndex=\{-1\}/);
  assert.doesNotMatch(info, /autoFocus/);
  assert.doesNotMatch(info, /button:focus\s*\{\s*outline:\s*none/);
});
