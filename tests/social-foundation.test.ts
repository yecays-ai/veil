import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { APP_REGISTRY } from "../lib/app-registry";
import { defaultDesktop, addAppToDesktop } from "../lib/desktop-layout";
import { defaultSnapshot, normalizeSnapshot } from "../lib/theme-types";
import { defaultFoundation, normalizeFoundation, normalizeUser,
  normalizeCharacterInput } from "../lib/foundation-types";
import { saveUser } from "../lib/foundation";
import { contactMatches } from "../lib/contact-search";
import { ChatStorage } from "../lib/chat/storage";

test("four root Apps register without generation bindings except Messages", () => {
  assert.deepEqual(APP_REGISTRY.filter((app) => ["messages", "contacts", "moments", "profile"].includes(app.id))
    .map((app) => app.id), ["messages", "contacts", "moments", "profile"]);
  for (const id of ["contacts", "moments"])
    assert(!("bindingCapabilities" in APP_REGISTRY.find((app) => app.id === id)!));
});

test("new Dock and exact legacy default migrate while customized Dock survives", () => {
  const dock = ["messages", "contacts", "moments", "profile"];
  assert.deepEqual(defaultSnapshot().dockLayout, dock);
  assert.deepEqual(normalizeSnapshot({ dockLayout: ["messages"] }).dockLayout, dock);
  assert.deepEqual(normalizeSnapshot({ dockLayout: ["messages", "settings"] }).dockLayout,
    ["messages", "settings"]);
  assert.deepEqual(normalizeSnapshot({ dockLayout: ["profile"] }).dockLayout, ["profile"]);
  assert(!defaultDesktop().iconLayout.some((icon) => dock.includes(icon.id)));
  const added = addAppToDesktop(defaultDesktop(), "messages", 1);
  assert(added.iconLayout.some((icon) => icon.id === "messages"));
});

test("legacy identities normalize absent presence and status, and User edits persist", () => {
  const old = defaultFoundation();
  const normalized = normalizeFoundation({ ...old, user: { name: "Me" },
    characters: [{ characterId: "p", name: "Peter" }] });
  assert.equal(normalized.user.presence, "offline");
  assert.equal(normalized.user.statusMessage, null);
  assert.equal(normalized.characters[0].presence, "offline");
  assert.equal(normalized.characters[0].statusMessage, null);
  assert.equal(normalizeCharacterInput({ name: "Peter", presence: "bogus" }).presence, "offline");
  const changed = saveUser(normalized, { ...normalizeUser({ name: "Me" }),
    presence: "away", statusMessage: "Out for coffee" });
  assert.equal(changed.user.presence, "away");
  assert.equal(changed.user.statusMessage, "Out for coffee");
});

test("Contacts search is case-insensitive and empty status is safe", () => {
  assert(contactMatches("Peter Parker", undefined, "pEtEr"));
  assert(contactMatches("Peter Parker", "Spidey", "spidey"));
  assert(!contactMatches("Peter Parker", undefined, "Lan"));
  assert(contactMatches("Peter Parker", undefined, "   "));
  assert.equal(normalizeCharacterInput({ name: "Peter", statusMessage: " " }).statusMessage, null);
});

test("opening a Contact's Message uses the existing unique Character session", async () => {
  const db = new IDBFactory();
  const storage = new ChatStorage(() => db);
  const first = await storage.openSession("peter");
  const second = await storage.openSession("peter");
  assert.equal(first.id, second.id);
  assert.equal((await storage.listSessions()).length, 1);
});

test("root pages reuse Foundation and existing Chat without fictional social data", () => {
  for (const path of ["app/contacts/page.tsx", "app/contacts/[characterId]/page.tsx",
    "app/moments/page.tsx", "app/profile/details/page.tsx"])
    assert(existsSync(path));
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  const profile = readFileSync("components/profile-pages.tsx", "utf8");
  const moments = readFileSync("app/moments/page.tsx", "utf8");
  const messages = readFileSync("components/chat/messages-home.tsx", "utf8");
  assert.match(contacts, /document\.characters\.filter/);
  assert.match(contacts, /chatStorage\.openSession\(character\.characterId\)/);
  assert.match(profile, /document\.user\.name/);
  assert.match(profile, /href="\/profile\/details"/);
  assert.match(profile, /href="\/settings"/);
  assert.match(messages, /chatStorage\.listSessions/);
  assert.match(messages, /Search chats/);
  assert.doesNotMatch(messages, /Back to Home|document\.user|在线/);
  assert.doesNotMatch(moments, /SocialAccount|posts|followers|publish/);
});
