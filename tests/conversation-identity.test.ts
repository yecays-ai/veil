import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("Character routes open the existing direct chat and keep Messages/Contacts navigation compatible", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const hook = readFileSync("components/chat/use-chat-session.ts", "utf8");
  const list = readFileSync("components/chat/messages-home.tsx", "utf8");
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(room, /ChatRoom\(\{ characterId \}/);
  assert.match(hook, /\.openSession\(characterId\)/);
  assert.match(list, /encodeURIComponent\(character.characterId\)/);
  assert.match(contacts, /encodeURIComponent\(character.characterId\)/);
  const route = readFileSync("app/messages/[characterId]/page.tsx", "utf8");
  assert.match(route, /characterId=\{characterId\}/);
});
