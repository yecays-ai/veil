import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("high-frequency dynamic destinations provide a small shared loading boundary", () => {
  const routeLoading = readFileSync("components/route-loading.tsx", "utf8");
  assert.match(routeLoading, /<p role="status">Loading…<\/p>/);
  for (const path of [
    "app/messages/group/[sessionId]/loading.tsx",
    "app/social/[characterId]/loading.tsx",
  ]) assert.match(readFileSync(path, "utf8"), /RouteLoading/);
  // Contact Info renders its own pending shell so the page does not swap layouts when the route resolves.
  const contacts = readFileSync("app/contacts/[characterId]/loading.tsx", "utf8");
  assert.match(contacts, /<ContactInfo characterId=\{characterId\} pending \/>/);
});

test("Messages prefetches its two Contacts chooser routes after it is ready", () => {
  const source = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(source, /router\.prefetch\("\/contacts\?mode=single"\)/);
  assert.match(source, /router\.prefetch\("\/contacts\?mode=multi"\)/);
});
