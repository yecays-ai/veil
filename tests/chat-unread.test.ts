import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { backupData, packageFixture } from "./backup-fixture";
import { validateBackupPackage } from "../lib/backup/validation";
import { restoreIntoEmpty, type RestoreDevice } from "../lib/backup/restore";
import { readStaticBackupSource } from "../lib/backup/static-source";
import { lockOrigin } from "./generation-lock-fixture";

function setup() {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const reply = (...chunks: string[]) => createChatEngine(storage, async () => document,
    async function* () { for (const chunk of chunks) yield chunk; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  return { storage, reply };
}
const unread = async (storage: ChatStorage, id: string) => (await storage.readSession(id)).session.unreadCount;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("bubbles that land while no chat page shows the conversation are counted, one per stored message", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  assert.equal(await unread(storage, session.id), undefined, "absent until something is unread");
  await reply("one\n\ntwo\n\nthree").initiate(session.id);
  assert.equal(await unread(storage, session.id), 3);
});

test("nothing is counted while a chat page shows that conversation, and leaving makes new bubbles unread again", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  const release = storage.viewSession(session.id);
  await reply("seen\n\nseen too").initiate(session.id);
  assert.equal(await unread(storage, session.id), undefined);
  release(); release(); // a second release is a no-op
  const engine = reply("after");
  await engine.send(session.id, "hello");
  await engine.requestReply(session.id);
  assert.equal(await unread(storage, session.id), 1, "once the page is gone, the next bubble is unread");
});

test("entering the conversation clears the count and notifies the list; a second page keeps it open", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  await reply("a\n\nb").initiate(session.id);
  assert.equal(await unread(storage, session.id), 2);
  const changes: string[] = [];
  const stop = storage.subscribe((change) => changes.push("sessionId" in change ? `${change.domain}:${change.sessionId}` : change.domain));
  const first = storage.viewSession(session.id); const second = storage.viewSession(session.id);
  await settle();
  assert.equal(await unread(storage, session.id), undefined);
  assert.ok(changes.includes(`session:${session.id}`));
  first(); second(); stop();
});

test("a reply that finishes after the user left counts, one that finishes while they look does not", async () => {
  const { storage } = setup();
  const session = await storage.openSession("a");
  let open!: () => void; const gate = new Promise<void>((resolve) => { open = resolve; });
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "a", ...normalizeCharacterInput({ name: "A" }) }];
  const slow = createChatEngine(storage, async () => document,
    async function* () { await gate; yield "late one\n\nlate two"; },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {}, async () => undefined);
  const release = storage.viewSession(session.id);
  await slow.send(session.id, "hello");
  const pending = slow.requestReply(session.id);
  await settle(); release(); open(); await pending;
  assert.equal(await unread(storage, session.id), 2);
  const again = storage.viewSession(session.id); await settle(); assert.equal(await unread(storage, session.id), undefined);
  await slow.send(session.id, "and again");
  const second = slow.requestReply(session.id); await second;
  assert.equal(await unread(storage, session.id), undefined, "still viewing");
  again();
});

test("clearing the history clears the count", async () => {
  const { storage, reply } = setup();
  const session = await storage.openSession("a");
  await reply("x\n\ny").initiate(session.id);
  assert.equal(await unread(storage, session.id), 2);
  await storage.clearSession(session.id);
  assert.equal(await unread(storage, session.id), undefined);
});

const device = () => { const raw = new Map<string, string>();
  return { indexedDB: new IDBFactory(), localStorage: { getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => { raw.set(k, v); },
    removeItem: (k: string) => { raw.delete(k); } } } satisfies RestoreDevice; };
test("backup validates and restores unreadCount and refuses damaged ones", async () => {
  const ok = backupData(); (ok.chat.sessions[0] as unknown as Record<string, unknown>).unreadCount = 4;
  const f = await packageFixture(ok), manifest = JSON.stringify(f.manifest);
  await validateBackupPackage(manifest, f.files);
  const d = device(); await restoreIntoEmpty(manifest, f.files, d, lockOrigin().client());
  assert.equal(((await readStaticBackupSource(d)).chat.sessions[0] as { unreadCount?: unknown }).unreadCount, 4);
  for (const damaged of [0, -1, 1.5, "2", null]) {
    const bad = backupData(); (bad.chat.sessions[0] as unknown as Record<string, unknown>).unreadCount = damaged;
    const p = await packageFixture(bad); await assert.rejects(validateBackupPackage(JSON.stringify(p.manifest), p.files));
  }
});
