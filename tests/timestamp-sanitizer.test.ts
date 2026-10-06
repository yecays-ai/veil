import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { sanitizeHistoryTimestamps } from "../lib/chat/timestamp-sanitizer";
import { createChatEngine } from "./chat-engine-fixture";
import { ChatStorage } from "../lib/chat/storage";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";

const stamp = "[2026-10-05 13:26 Asia/Shanghai]";

test("valid VEIL timestamp lines disappear at reply and paragraph starts only", () => {
  for (const zone of ["Asia/Shanghai", "America/New_York", "Europe/London", "UTC", "Etc/GMT+8"])
    assert.equal(sanitizeHistoryTimestamps(`[2026-10-05 13:26 ${zone}]\nHello`), "Hello");
  assert.equal(sanitizeHistoryTimestamps(stamp), "");
  assert.equal(sanitizeHistoryTimestamps(`${stamp}\nA\n\n${stamp}\nB\n\n${stamp}\nC`), "A\n\nB\n\nC");
  assert.equal(sanitizeHistoryTimestamps(`${stamp}\r\nHello`), "Hello");
  assert.equal(sanitizeHistoryTimestamps(`We discussed ${stamp} yesterday.`), `We discussed ${stamp} yesterday.`);
});

test("ordinary brackets, dates, times and malformed metadata remain unchanged", () => {
  for (const content of ["[seriously?]", "[laughs]", "October 5 at 13:26", "[2026-10-05]",
    "[2026-10-05 13:26]", "[2026-10-05 13:26 Bad/Zone]", "[2026-02-30 13:26 UTC]",
    "[2026-10-05 25:26 UTC]", "[2026-10-05 13:99 UTC]", "[2026-10-05 13:26 UTC] is an example.",
    "Text\n[2026-10-05 13:26 UTC]\nmore text"]) {
    assert.equal(sanitizeHistoryTimestamps(content), content);
    assert.equal(sanitizeHistoryTimestamps(content, true), content);
  }
});

test("every possible split within metadata is withheld until ordinary body text arrives", () => {
  for (let end = 1; end <= stamp.length; end++)
    assert.equal(sanitizeHistoryTimestamps(stamp.slice(0, end), true), "");
  assert.equal(sanitizeHistoryTimestamps(`A\n\n${stamp.slice(0, 18)}`, true), "A\n\n");
  assert.equal(sanitizeHistoryTimestamps("[ser", true), "[ser");
  assert.equal(sanitizeHistoryTimestamps("[2026-10-", false), "[2026-10-");
});

async function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("a");
  await storage.send(session.id, "hello");
  const document = defaultFoundation();
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  return { storage, session, document };
}

test("engine stores only sanitized streaming previews and finalized split messages", async () => {
  const { storage, session, document } = await setup();
  const previews: string[] = [];
  const engine = createChatEngine(storage, async () => document, async function* () {
    for (const chunk of ["[2026-10-", "05 13:26 Asia/", "Shanghai]\nHello", "\n\n[2026-10-05 ", "13:26 Europe/London]\nWorld"]) {
      yield chunk;
      previews.push((await storage.readSession(session.id)).messages.at(-1)!.content);
    }
  });
  await engine.requestReply(session.id);
  assert.deepEqual(previews, ["", "", "Hello", "Hello\n\n", "Hello\n\nWorld"]);
  const saved = await storage.readSession(session.id);
  assert.deepEqual(saved.messages.filter((message) => message.role === "assistant").map((message) => message.content), ["Hello", "World"]);
  assert.doesNotMatch(JSON.stringify((await storage.readSession(session.id)).messages), /2026-10-05/);
});

test("timestamp-only reply follows existing empty failure semantics", async () => {
  const { storage, session, document } = await setup();
  const engine = createChatEngine(storage, async () => document, async function* () { yield stamp; });
  const reply = await engine.requestReply(session.id);
  assert.equal(reply?.status, "error");
  assert.equal(reply?.content, "");
  assert.match(reply?.error || "", /no reply text/);
});

test("Stop and provider error never persist a withheld metadata prefix", async () => {
  for (const stop of [true, false]) {
    const { storage, session, document } = await setup();
    const engine = createChatEngine(storage, async () => document, async function* () {
      yield "Hello\n\n[2026-10-";
      if (stop) engine.stop(session.id);
      else throw new Error("provider failed");
    });
    const reply = await engine.requestReply(session.id);
    assert.equal(reply?.status, stop ? "cancelled" : "error");
    assert.equal(reply?.content, "Hello\n\n");
  }
});
