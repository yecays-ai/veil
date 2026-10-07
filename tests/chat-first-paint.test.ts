import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { chatLoadingNotice } from "../lib/chat/loading-notice";
import { ChatStorage } from "../lib/chat/storage";
import { createChatSessionLifecycle } from "../lib/chat/session-lifecycle";
import { regressionContract } from "./regression-contract";

regressionContract("chat.route-keeps-identity-boundary", "render-lifecycle",
  "direct chat has no full-page fallback and still awaits and keys the current route identity", () => {
  assert.equal(existsSync("app/messages/[characterId]/loading.tsx"), false);
  assert.equal(existsSync("app/messages/loading.tsx"), false);
  const page = readFileSync("app/messages/[characterId]/page.tsx", "utf8");
  assert.match(page, /await params/);
  assert.match(page, /<ChatRoom key=\{characterId\} characterId=\{characterId\}/);
  const room = readFileSync("components/chat/chat-room.tsx", "utf8");
  const pending = room.slice(room.indexOf("if (!ready || !character)"), room.indexOf("const pending ="));
  assert.doesNotMatch(pending, /contactName|ChatAvatar|session\?|groupedMessages/);
  for (const key of ["header", "history", "composer"])
    assert.equal(room.split(`key="${key}"`).length - 1, 2, `${key} retains its anchor during identity hydration`);
  for (const ref of ["shell", "history", "composerBar", "composer"])
    assert.match(pending, new RegExp(`ref=\\{${ref}\\}`));
  assert.match(pending, /<textarea[^>]*[\s\S]*?disabled placeholder="Message…"/);
  assert.match(room, /aria-busy=\{!session && !loadError\}/);
});

regressionContract("chat.first-paint-notice", "render-lifecycle",
  "warm validated identity paints without a loading notice; cold absence, invalid identity and failure stay explicit", () => {
  assert.equal(chatLoadingNotice(false, false, ""), "Loading Character…");
  assert.equal(chatLoadingNotice(false, true, ""), "Loading Character…", "default data is not validated identity");
  assert.equal(chatLoadingNotice(true, false, ""), "This Character is no longer available.");
  assert.equal(chatLoadingNotice(true, true, ""), undefined);
  assert.equal(chatLoadingNotice(true, true, "failed"), "Conversation unavailable.");
});

regressionContract("chat.first-paint-remount-budget", "subscription-hygiene",
  "warm navigation presentation adds no hydration or subscriptions and never publishes the previous character", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  for (const id of ["peter", "pep"]) {
    const session = await storage.openSession(id);
    await storage.send(session.id, id);
  }
  const counts = { opens: 0, reads: 0, existing: 0, active: 0, subscriptions: 0 };
  const adapter = {
    openSession: (id: string) => { counts.opens++; return storage.openSession(id); },
    readSession: (id: string) => { counts.reads++; return storage.readSession(id); },
    readExistingSession: (id: string) => { counts.existing++; return storage.readExistingSession(id); },
    subscribe: (listener: Parameters<ChatStorage["subscribe"]>[0]) => {
      counts.subscriptions++; counts.active++;
      const unsubscribe = storage.subscribe(listener);
      return () => { counts.active--; unsubscribe(); };
    },
  };
  for (const id of ["peter", "pep", "peter"]) {
    let publish!: () => void;
    const loaded = new Promise<void>((resolve) => { publish = resolve; });
    const owner = createChatSessionLifecycle(id, adapter, (snapshot) => {
      if (!snapshot) return;
      assert.equal(snapshot.session.characterId, id);
      assert.deepEqual(snapshot.messages.map((message) => message.content), [id]);
      publish();
    }, () => {});
    assert.equal(chatLoadingNotice(true, true, ""), undefined);
    owner.mount(true);
    owner.setEnabled(true);
    await loaded;
    for (let render = 0; render < 5; render++)
      assert.equal(chatLoadingNotice(true, true, ""), undefined);
    assert.equal(counts.active, 1);
    owner.unmount();
    assert.equal(counts.active, 0);
  }
  assert.deepEqual(counts, { opens: 3, reads: 3, existing: 0, active: 0, subscriptions: 3 });
});
