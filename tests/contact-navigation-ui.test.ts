import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/contacts/[characterId]/page.tsx", "utf8");
const loading = readFileSync("app/contacts/[characterId]/loading.tsx", "utf8");
const info = readFileSync("components/contact-info.tsx", "utf8");

test("Contact Info route fallback reuses the real inert Contact Info surface", () => {
  assert.match(loading, /useParams/);
  assert.match(loading, /<ContactInfo characterId=\{characterId\} pending \/>/);
  assert.doesNotMatch(loading, /RouteLoading/);
  assert.match(info, /pending \? <span className="contact-back"[^>]*aria-disabled="true"/);
});

test("direct chat passes an explicit internal return source to Contact Info", () => {
  const pages = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(pages, /contactReturnSourceFromQuery\(useSearchParams\(\)\.get\("from"\)\)/);
  assert.doesNotMatch(page, /searchParams/);
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
