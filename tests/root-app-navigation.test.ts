import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("four root Apps share the existing Home back affordance", () => {
  const header = readFileSync("components/root-app-header.tsx", "utf8");
  assert.match(header, /backHref = "\/", backLabel = "Back to Home"/);
  assert.match(header, /href=\{backHref\} aria-label=\{backLabel\}/);
  assert.match(header, /className="app-page-back"/);
  assert.match(header, /<Chevron \/>/);
  for (const file of ["components/chat/messages-home.tsx", "components/contacts-pages.tsx",
    "app/moments/page.tsx", "components/profile-pages.tsx"])
    assert.match(readFileSync(file, "utf8"), /<RootAppHeader title=/);
});

test("secondary pages retain their parent navigation", () => {
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  const profile = readFileSync("components/profile-pages.tsx", "utf8");
  const thread = readFileSync("components/chat/chat-header.tsx", "utf8");
  assert.match(contacts, /backHref="\/contacts"/);
  assert.match(profile, /backHref="\/profile"/);
  assert.match(thread, /href="\/messages"|router\.push\("\/messages"\)/);
});
