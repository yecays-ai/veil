import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRegexReadGuard } from "../lib/chat/regex-read-guard";
import { chatScrollIntentMatchesSession, shouldPositionChatHistoryAtBottom } from "../lib/chat/initial-scroll";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a stale Display Regex read cannot overwrite the latest result", async () => {
  const guard = createRegexReadGuard();
  const older = deferred<string>();
  const newer = deferred<string>();
  let visible = "";
  const publish = async (read: Promise<string>) => {
    const revision = guard.next();
    const value = await read;
    if (guard.isCurrent(revision)) visible = value;
  };
  const olderRead = publish(older.promise);
  const newerRead = publish(newer.promise);

  newer.resolve("new display result");
  await newerRead;
  older.resolve("stale display result");
  await olderRead;

  assert.equal(visible, "new display result");
});

test("unmounted Regex readers invalidate their outstanding result", () => {
  const guard = createRegexReadGuard();
  const request = guard.next();
  guard.invalidate();
  assert.equal(guard.isCurrent(request), false);
});

test("initial history uses the new session default and keeps scroll input from its own loading phase", () => {
  const sessionA = { characterId: "peter", id: "session-a" };
  const sessionB = { characterId: "pep", id: "session-b" };
  const scrolledUpInA = { characterId: "peter", sessionId: "session-a", value: false };
  const untouchedB = { characterId: "pep", sessionId: undefined, value: true };
  const scrolledUpWhileBLoads = { characterId: "pep", sessionId: undefined, value: false };

  assert.equal(shouldPositionChatHistoryAtBottom(scrolledUpInA, sessionB), true,
    "a previous session's scroll position cannot suppress the new session's initial bottom positioning");
  assert.equal(chatScrollIntentMatchesSession(scrolledUpWhileBLoads, sessionB), true);
  assert.equal(shouldPositionChatHistoryAtBottom(scrolledUpWhileBLoads, sessionB), false,
    "a scroll choice recorded for the destination Character while its session loads is preserved");
  assert.equal(shouldPositionChatHistoryAtBottom(untouchedB, sessionB), true);
});

test("initial Chat publication waits for Display Regex and positions history before paint", () => {
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  assert.match(room, /chatBackground\.readyForFrame && regexReady/);
  assert.match(room, /regexReadState\.owner === regexOwner && regexReadState\.ready/);
  assert.match(room, /const bindingReadFailed = !bindingsReady && !!bindingsError;/);
  assert.match(room, /const regexGroups = bindingReadFailed \? \[\]/);
  assert.match(room, /const regexReady = bindingReadFailed \|\|/);
  assert.match(room, /if \(active && regexReadGuard\.isCurrent\(revision\)\)/);
  assert.match(room, /useLayoutEffect\(\(\) => \{\s*if \(!framePublished \|\| !session \|\| initialPositionedSession\.current === session\.id\) return;[\s\S]*?history\.current\?\.scrollTo\(\{ top: history\.current\.scrollHeight \}\);[\s\S]*?\}, \[framePublished, session\?\.id\]\)/);
});
