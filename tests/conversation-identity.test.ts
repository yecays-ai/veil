import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("routes and chat runtime resolve the Character from the loaded Conversation", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const hook = readFileSync("components/chat/use-chat-session.ts", "utf8");
  const list = readFileSync("components/chat/messages-home.tsx", "utf8");
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(room, /useChatSession\(conversationId, ready\)/);
  assert.match(room, /characterId = session\?\.characterId/);
  assert.match(hook, /\.readSession\(conversationId\)/);
  assert.doesNotMatch(hook, /openSession/);
  assert.match(list, /visible\.map\(\(session\)/);
  assert.match(list, /encodeURIComponent\(session.id\)/);
  assert.match(contacts, /encodeURIComponent\(session.id\)/);
});
