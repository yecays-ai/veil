import assert from "node:assert/strict";
import test from "node:test";
import { getSearchHaystack, getSearchResultText, isSearchVisibleMessage,
  searchConversationMessages, SEARCH_RESULT_LIMIT, SEARCH_TEXT_SCAN_LIMIT } from "../lib/chat/search";
import type { ChatMessage } from "../lib/chat/types";

function message(id: string, content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id, sessionId: "conversation-a", role: "user", content, status: "sent", createdAt: 1, order: 1,
    ...overrides };
}

test("search is case-insensitive, trims query and scopes results to the current conversation", async () => {
  const current = message("current", "The Weather is lovely");
  const otherConversation = message("other", "The weather is cold", { sessionId: "conversation-b" });
  assert.deepEqual((await searchConversationMessages([current, otherConversation], "conversation-a", "  WEATHER  "))
    .map((item) => item.id), ["current"]);
});

test("empty and unmatched queries return no results; internal and transient messages are excluded", async () => {
  const items = [
    message("tool", "weather", { role: "system" }),
    message("stream", "weather", { role: "assistant", status: "streaming" }),
    message("blank", "   "),
    message("visible", "A normal message", { role: "assistant" }),
  ];
  assert.equal(isSearchVisibleMessage(items[0]), false);
  assert.equal(isSearchVisibleMessage(items[1]), false);
  assert.deepEqual(await searchConversationMessages(items, "conversation-a", "  "), []);
  assert.deepEqual(await searchConversationMessages(items, "conversation-a", "missing"), []);
});

test("search scans newest first, yields in bounded chunks and caps results at 80", async () => {
  const items = Array.from({ length: 260 }, (_, index) => message(`m${index}`, `match ${index}`, { order: index }));
  const results = await searchConversationMessages(items, "conversation-a", "MATCH");
  assert.equal(results.length, SEARCH_RESULT_LIMIT);
  assert.equal(results[0].id, "m259");
  assert.equal(results.at(-1)?.id, "m180");
});

test("searchable text is a bounded projection of visible message content only", () => {
  const text = "x".repeat(SEARCH_TEXT_SCAN_LIMIT + 10);
  const item = message("long", text);
  assert.equal(getSearchResultText(item).length, SEARCH_TEXT_SCAN_LIMIT);
  assert.equal(getSearchHaystack(item), getSearchResultText(item));
  assert.equal(isSearchVisibleMessage(message("empty", "  ")), false);
});
