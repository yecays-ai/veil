import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "../lib/chat/engine";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { DEFAULT_API_CONFIG_ID } from "../lib/chat/types";

test("Character routes open the existing direct chat and keep Messages/Contacts navigation compatible", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const hook = readFileSync("components/chat/use-chat-session.ts", "utf8");
  const list = readFileSync("components/chat/messages-home.tsx", "utf8");
  const contacts = readFileSync("components/contacts-pages.tsx", "utf8");
  assert.match(room, /characterId: routeCharacterId, conversationId/);
  assert.match(hook, /\.openSession\(characterId\)/);
  assert.match(hook, /chatStorage.readSession\(conversationId\)/);
  assert.match(list, /encodeURIComponent\(session.id\)/);
  assert.match(contacts, /encodeURIComponent\(session.id\)/);
  const route = readFileSync("app/messages/[characterId]/page.tsx", "utf8");
  assert.match(route, /characterId=\{characterId\}/);
});

test("independent chat IDs resolve the same Peter persona and each can send and reply", async () => {
  const factory = new IDBFactory(); const storage = new ChatStorage(() => factory);
  const foundation = defaultFoundation();
  foundation.characters = [{ characterId: "peter", ...normalizeCharacterInput({ name: "Peter", personality: "ONE_PETER" }) }];
  await storage.saveApiConfig({ id: DEFAULT_API_CONFIG_ID, baseUrl: "https://example.test/v1", model: "test", apiKey: "test" });
  const first = await storage.openSession("peter"); const second = await storage.createSession("peter");
  assert.notEqual(first.id, second.id); assert.notEqual(first.id, "peter");
  let requests = 0;
  const engine = createChatEngine(storage, async () => foundation, async function* (_, prompt) {
    requests++; assert.match(JSON.stringify(prompt), /ONE_PETER/); yield "Hello.\n\nI'm here.";
  });
  for (const session of [first, second]) {
    await engine.send(session.id, "Hi Peter");
    await engine.requestReply(session.id);
    const saved = await storage.readSession(session.id);
    assert.equal(saved.session.characterId, "peter");
    assert.deepEqual(saved.messages.map((message) => message.content), ["Hi Peter", "Hello.", "I'm here."]);
  }
  assert.equal(requests, 2);
  assert.equal(foundation.characters.length, 1);
  assert.equal((await storage.openSession("peter")).characterId, "peter");
});
