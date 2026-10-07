import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { CHAT_DATABASE_NAME, ChatStorage, affectsChatBackground, affectsChatSession,
  type ChatStorageChange } from "../lib/chat/storage";

async function database(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(CHAT_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("current chat schema contains only conversation-owned stores", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  await storage.listSessions();
  const db = await database(factory);
  assert.deepEqual([...db.objectStoreNames], ["assets", "chatSettings", "messages", "sessions", "worldBookStates"]);
  assert(!db.objectStoreNames.contains("apiConfigs"));
  const tx = db.transaction(["sessions", "messages"]);
  assert.deepEqual([...tx.objectStore("sessions").indexNames], []);
  assert.deepEqual([...tx.objectStore("messages").indexNames], ["sessionId"]);
  db.close();
});

test("concurrent direct opens reuse one conversation for a Character", async () => {
  const factory = new IDBFactory();
  const first = new ChatStorage(() => factory), second = new ChatStorage(() => factory);
  const [one, two] = await Promise.all([first.openSession("peter"), second.openSession("peter")]);
  assert.equal(one.id, two.id);
  assert.equal((await first.listSessions()).length, 1);
});

test("scoped notifications avoid unrelated session, background and profile reads", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const first = await storage.openSession("peter");
  const other = await storage.openSession("lan");
  const events: ChatStorageChange[] = [];
  let sessionReads = 0, backgroundReads = 0, profileReads = 0;
  const unsubscribe = storage.subscribe((change) => {
    events.push(change);
    if (affectsChatSession(change, first.id)) sessionReads++;
    if (affectsChatBackground(change, first.id)) backgroundReads++;
    if (change.domain === "global-profile") profileReads++;
  });
  await storage.send(other.id, "other message");
  assert.deepEqual(events, [{ domain: "messages", sessionId: other.id }]);
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [0, 0, 0]);
  await storage.send(first.id, "our message");
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [1, 0, 0]);
  await storage.updateBubbleTiming({ shortMs: 1500 });
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [1, 0, 1]);
  await storage.updateSessionSettings(other.id, { backgroundBlur: 2 });
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [1, 0, 1]);
  await storage.updateSessionSettings(first.id, { backgroundBlur: 3 });
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [2, 1, 1]);
  await storage.updateGlobalChatBackgroundBlur(4);
  assert.deepEqual([sessionReads, backgroundReads, profileReads], [2, 2, 1]);
  await storage.ensureHereThereSchedule(1_000_000, () => 0);
  const scheduledReads = profileReads;
  await storage.ensureHereThereSchedule(1_000_001, () => 0);
  await storage.claimHereThereOpportunity(1_000_001, () => 0);
  assert.equal(profileReads, scheduledReads);
  unsubscribe();
});

test("scoped BroadcastChannel events refresh matching data in another tab", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalChannel = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  class TestChannel {
    static channels = new Set<TestChannel>();
    onmessage: ((event: MessageEvent<ChatStorageChange>) => void) | null = null;
    constructor(readonly name: string) { TestChannel.channels.add(this); }
    postMessage(data: ChatStorageChange) {
      for (const peer of TestChannel.channels) if (peer !== this && peer.name === this.name)
        peer.onmessage?.({ data } as MessageEvent<ChatStorageChange>);
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: TestChannel });
  try {
    const factory = new IDBFactory();
    const first = new ChatStorage(() => factory), second = new ChatStorage(() => factory);
    const session = await first.openSession("peter");
    const other = await first.openSession("lan");
    const seen: ChatStorageChange[] = [];
    let sessionRefreshes = 0, profileRefreshes = 0;
    const stopFirst = first.subscribe(() => {});
    const stopSecond = second.subscribe((change) => {
      seen.push(change);
      if (affectsChatSession(change, session.id)) sessionRefreshes++;
      if (change.domain === "global-profile") profileRefreshes++;
    });
    await first.send(other.id, "unrelated");
    await first.send(session.id, "matching");
    await first.updateBubbleTiming({ mediumMs: 2800 });
    assert.deepEqual(seen, [
      { domain: "messages", sessionId: other.id },
      { domain: "messages", sessionId: session.id },
      { domain: "global-profile" },
    ]);
    assert.equal(sessionRefreshes, 1);
    assert.equal(profileRefreshes, 1);
    assert.deepEqual((await second.readSession(session.id)).messages.map((message) => message.content), ["matching"]);
    stopFirst(); stopSecond();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalChannel) Object.defineProperty(globalThis, "BroadcastChannel", originalChannel);
    else Reflect.deleteProperty(globalThis, "BroadcastChannel");
  }
});

test("chat sessions, messages and session-linked settings remain available in the current schema", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const session = await storage.openSession("peter");
  await storage.send(session.id, "hello");
  await storage.updateSessionSettings(session.id, { streamOnline: true, customCSS: ".chat-bubble { opacity: .9; }" });
  const reloaded = await new ChatStorage(() => factory).readSession(session.id);
  assert.equal(reloaded.session.streamOnline, true);
  assert.match(reloaded.session.customCSS ?? "", /opacity/);
  assert.deepEqual(reloaded.messages.map((message) => message.content), ["hello"]);
});

test("global profile settings persist independent timing tiers and reject invalid writes", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  assert.deepEqual((await storage.readGlobalProfileSettings()).bubbleTiming, { shortMs: 1200, mediumMs: 2400, longMs: 3600 });
  await Promise.all([storage.updateBubbleTiming({ shortMs: 1500 }), storage.updateBubbleTiming({ longMs: 5000 })]);
  await storage.updateHereThereEnabled(false, 1_000_000);
  const reloaded = await new ChatStorage(() => factory).readGlobalProfileSettings();
  assert.deepEqual(reloaded.bubbleTiming, { shortMs: 1500, mediumMs: 2400, longMs: 5000 });
  assert.equal(reloaded.hereThereEnabled, false);
  assert.equal(reloaded.nextCommentAt, null);
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 60001])
    await assert.rejects(storage.updateBubbleTiming({ mediumMs: value }), /Invalid bubble timing/);
  const db = await database(factory);
  const raw = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = db.transaction("chatSettings").objectStore("chatSettings").get("global-profile-settings");
    request.onsuccess = () => resolve(request.result as Record<string, unknown>);
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual(raw.bubbleTiming, { shortMs: 1500, mediumMs: 2400, longMs: 5000 });
  assert.equal(Object.hasOwn(raw, "bubbleDelayScale"), false);
  db.close();
});

test("portable timing backup restores all three values atomically", async () => {
  const original = new ChatStorage(() => new IDBFactory());
  await original.updateBubbleTiming({ shortMs: 900, mediumMs: 2500, longMs: 5000 });
  const serialized = await original.exportBubbleTiming();
  const factory = new IDBFactory();
  const restored = new ChatStorage(() => factory);
  await restored.restoreBubbleTiming(serialized);
  assert.deepEqual((await new ChatStorage(() => factory).readGlobalProfileSettings()).bubbleTiming,
    { shortMs: 900, mediumMs: 2500, longMs: 5000 });
  await assert.rejects(restored.restoreBubbleTiming(JSON.stringify({ bubbleTiming: { shortMs: 1, mediumMs: 0, longMs: 2 } })));
  assert.deepEqual((await restored.readGlobalProfileSettings()).bubbleTiming, { shortMs: 900, mediumMs: 2500, longMs: 5000 });
});

test("Here & There keeps one persisted future schedule and atomically claims an opportunity", async () => {
  const factory = new IDBFactory();
  const first = new ChatStorage(() => factory), second = new ChatStorage(() => factory);
  const now = 50_000_000;
  const scheduled = await first.ensureHereThereSchedule(now, () => 0.25);
  assert.equal(scheduled.nextCommentAt, now + 2 * 60 * 60 * 1000);
  const reloaded = await second.ensureHereThereSchedule(now + 5_000, () => 0.99);
  assert.equal(reloaded.nextCommentAt, scheduled.nextCommentAt);
  assert.equal(await first.claimHereThereOpportunity(scheduled.nextCommentAt! - 1, () => 0), null);
  const claims = await Promise.all([
    first.claimHereThereOpportunity(scheduled.nextCommentAt!, () => 0.5),
    second.claimHereThereOpportunity(scheduled.nextCommentAt!, () => 0.5),
  ]);
  assert.equal(claims.filter((claim) => claim !== null).length, 1);
  const next = await first.readGlobalProfileSettings();
  assert.equal(next.nextCommentAt, claims.find((claim) => claim !== null));
  assert(next.nextCommentAt! > scheduled.nextCommentAt!);
  assert(next.nextCommentAt! - scheduled.nextCommentAt! >= 60 * 60 * 1000);
  assert(next.nextCommentAt! - scheduled.nextCommentAt! < 5 * 60 * 60 * 1000);
});

test("disabling Here & There cancels expired schedules and re-enabling starts in the future", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const now = 80_000_000;
  await storage.ensureHereThereSchedule(now, () => 0);
  await storage.updateHereThereEnabled(false, now + 10 * 60 * 60 * 1000);
  assert.equal(await storage.claimHereThereOpportunity(now + 10 * 60 * 60 * 1000, () => 0), null);
  await storage.updateHereThereEnabled(true, now + 10 * 60 * 60 * 1000, () => 0.75);
  const settings = await storage.readGlobalProfileSettings();
  assert.equal(settings.hereThereEnabled, true);
  assert.equal(settings.nextCommentAt, now + 10 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000);
});

test("failed Here & There opportunities only reschedule their owned opportunity", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const now = 90_000_000;
  const schedule = await storage.ensureHereThereSchedule(now, () => 0);
  const claimedSchedule = await storage.claimHereThereOpportunity(schedule.nextCommentAt!, () => 0);
  assert.notEqual(claimedSchedule, null);
  const failureTime = schedule.nextCommentAt! + 2 * 60 * 1000;
  const retryAt = failureTime + 5 * 60 * 1000;
  assert.equal(await storage.rescheduleHereThereOpportunity(claimedSchedule!, failureTime, 5 * 60 * 1000), true);
  assert.equal((await storage.readGlobalProfileSettings()).nextCommentAt, retryAt);
  await storage.updateHereThereEnabled(false, retryAt + 1);
  assert.equal(await storage.rescheduleHereThereOpportunity(claimedSchedule!, retryAt + 2, 5 * 60 * 1000), false);
  assert.equal((await storage.readGlobalProfileSettings()).nextCommentAt, null);

  const reenabledAt = retryAt + 10_000;
  await storage.updateHereThereEnabled(true, reenabledAt, () => 0.75);
  const reenabledSchedule = (await storage.readGlobalProfileSettings()).nextCommentAt;
  assert.notEqual(reenabledSchedule, claimedSchedule);
  assert.equal(await storage.rescheduleHereThereOpportunity(claimedSchedule!, retryAt + 20_000, 5 * 60 * 1000), false);
  assert.equal((await storage.readGlobalProfileSettings()).nextCommentAt, reenabledSchedule);
});

async function seedHistoryAndWorldBookState(storage: ChatStorage, sessionId: string) {
  await storage.send(sessionId, "old history");
  const batch = await storage.beginReply(sessionId);
  assert(batch);
  await storage.finalizeReply(batch.assistant.id, "old reply", {
    cycle: 3, prefix: [], entries: { "book:entry": { stickyUntil: 5 } },
  });
}

test("Clear Conversation History resets messages and WorldBook state but preserves the conversation shell settings", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const imageId = await storage.saveChatImage(new Blob(["background"], { type: "image/png" }));
  await storage.updateSessionSettings(session.id, {
    pinned: true, streamOnline: true, autoReplyOnKeyboardDismiss: true,
    backgroundImage: imageId, customCSS: ".chat-bubble { opacity: .9; }",
  });
  await seedHistoryAndWorldBookState(storage, session.id);
  assert(await storage.readWorldBookState(session.id));

  assert.equal(await storage.clearSession(session.id), 2);
  const saved = await storage.readSession(session.id);
  assert.equal(saved.messages.length, 0);
  assert.equal(await storage.readWorldBookState(session.id), null);
  assert.equal(saved.session.nextOrder, 1);
  assert.equal(saved.session.lastMessageId, undefined);
  assert.equal(saved.session.lastMessagePreview, "");
  assert.equal(saved.session.pinned, true);
  assert.equal(saved.session.streamOnline, true);
  assert.equal(saved.session.autoReplyOnKeyboardDismiss, true);
  assert.equal(saved.session.backgroundImage, imageId);
  assert.match(saved.session.customCSS ?? "", /opacity/);
  assert(await storage.readChatImage(imageId));
});

test("Delete Conversation resets history, removes only its session and unused background asset, and permits a fresh direct session", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  const other = await storage.openSession("lan");
  const imageId = await storage.saveChatImage(new Blob(["background"], { type: "image/png" }));
  await storage.updateSessionSettings(session.id, { backgroundImage: imageId });
  await seedHistoryAndWorldBookState(storage, session.id);
  await storage.send(other.id, "other conversation stays");

  let notified = 0;
  const unsubscribe = storage.subscribe(() => { notified++; });
  await storage.deleteSession(session.id);
  unsubscribe();
  assert(notified > 0);
  assert.deepEqual((await storage.listSessions()).map((item) => item.id), [other.id]);
  assert.equal(await storage.readChatImage(imageId), null);
  assert.equal(await storage.readWorldBookState(session.id), null);
  assert.deepEqual((await storage.readSession(other.id)).messages.map((item) => item.content), ["other conversation stays"]);

  const fresh = await storage.openSession("peter");
  assert.notEqual(fresh.id, session.id);
  assert.deepEqual((await storage.readSession(fresh.id)).messages, []);
  assert.equal(await storage.readWorldBookState(fresh.id), null);
});

test("Clear and Delete refuse an active streaming reply without changing conversation data", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await storage.send(session.id, "question");
  const batch = await storage.beginReply(session.id);
  assert(batch);

  await assert.rejects(storage.clearSession(session.id), /reply is in progress/);
  await assert.rejects(storage.deleteSession(session.id), /reply is in progress/);
  const unchanged = await storage.readSession(session.id);
  assert.equal(unchanged.messages.length, 2);
  assert.equal(unchanged.messages[1].status, "streaming");
  assert.equal((await storage.listSessions()).some((item) => item.id === session.id), true);
});

test("open failures keep the safe user-facing storage error", async () => {
  const storage = new ChatStorage(() => { throw new DOMException("blocked", "SecurityError"); });
  await assert.rejects(storage.listSessions(), /Chat storage is unavailable/);
});
