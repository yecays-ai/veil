import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import {
  getChatImageFromIndexedDB,
  resolveChatBackgroundImage,
  resolveChatBackground,
  saveChatImageToIndexedDB,
} from "../lib/chat/background";
import { ChatStorage } from "../lib/chat/storage";

test("chat backgrounds resolve per conversation then global and persist across reload", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const peter = await storage.openSession("peter");
  const lan = await storage.openSession("lan");
  const globalId = await saveChatImageToIndexedDB(
    new Blob(["global"], { type: "image/png" }),
    storage,
  );
  const peterId = await saveChatImageToIndexedDB(
    new Blob(["peter"], { type: "image/jpeg" }),
    storage,
  );
  await storage.updateGlobalChatBackground(globalId);
  await storage.updateSessionSettings(peter.id, { backgroundImage: peterId });

  const reloaded = new ChatStorage(() => factory);
  const settings = await reloaded.readChatBackgroundSettings();
  const peterReloaded = (await reloaded.readSession(peter.id)).session;
  const lanReloaded = (await reloaded.readSession(lan.id)).session;
  assert.equal(resolveChatBackgroundImage(peterReloaded, settings), peterId);
  assert.equal(resolveChatBackgroundImage(lanReloaded, settings), globalId);
  assert.equal(await (await getChatImageFromIndexedDB(peterId, reloaded))?.text(), "peter");

  await reloaded.updateSessionSettings(peter.id, { backgroundImage: null });
  const following = (await reloaded.readSession(peter.id)).session;
  assert.equal(resolveChatBackgroundImage(following, settings), globalId);
  await reloaded.updateGlobalChatBackground(null);
  assert.equal(
    resolveChatBackgroundImage(following, await reloaded.readChatBackgroundSettings()),
    null,
  );
});

test("chat background storage rejects non-images and unknown asset references", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const session = await storage.openSession("peter");
  await assert.rejects(
    () => saveChatImageToIndexedDB(new Blob(["text"], { type: "text/plain" }), storage),
    /Choose an image file/,
  );
  await assert.rejects(
    () => storage.updateSessionSettings(session.id, { backgroundImage: "missing" }),
    /was not found/,
  );
});

test("global and per-chat blur persist and only affect resolved background", async () => {
  const factory = new IDBFactory();
  const storage = new ChatStorage(() => factory);
  const peter = await storage.openSession("peter");
  const lan = await storage.openSession("lan");
  const globalId = await storage.saveChatImage(new Blob(["global crop"], { type: "image/png" }));
  const peterId = await storage.saveChatImage(new Blob(["peter crop"], { type: "image/png" }));
  await storage.updateGlobalChatBackground(globalId);
  await storage.updateGlobalChatBackgroundBlur(6);
  await storage.updateSessionSettings(peter.id, { backgroundImage: peterId, backgroundBlur: 11 });
  const reloaded = new ChatStorage(() => factory);
  const settings = await reloaded.readChatBackgroundSettings();
  assert.deepEqual(resolveChatBackground((await reloaded.readSession(peter.id)).session, settings),
    { image: peterId, blur: 11 });
  assert.deepEqual(resolveChatBackground((await reloaded.readSession(lan.id)).session, settings),
    { image: globalId, blur: 6 });
  assert.equal(await (await reloaded.readChatImage(peterId))?.text(), "peter crop");
  await reloaded.updateSessionSettings(peter.id, { backgroundImage: null, backgroundBlur: null });
  assert.deepEqual(resolveChatBackground((await reloaded.readSession(peter.id)).session, settings),
    { image: globalId, blur: 6 });
  assert.equal(await reloaded.readChatImage(peterId), null);
  await reloaded.updateGlobalChatBackground(null);
  assert.equal(await reloaded.readChatImage(globalId), null);
  assert.deepEqual(resolveChatBackground((await reloaded.readSession(lan.id)).session,
    await reloaded.readChatBackgroundSettings()), { image: null, blur: 6 });
});

test("background image replacement retains assets still referenced by other conversations", async () => {
  const storage = new ChatStorage(() => new IDBFactory());
  const peter = await storage.openSession("peter");
  const lan = await storage.openSession("lan");
  const shared = await storage.saveChatImage(new Blob(["shared"], { type: "image/png" }));
  const newer = await storage.saveChatImage(new Blob(["newer"], { type: "image/png" }));
  await storage.updateSessionSettings(peter.id, { backgroundImage: shared });
  await storage.updateSessionSettings(lan.id, { backgroundImage: shared });
  await storage.updateSessionSettings(peter.id, { backgroundImage: newer });
  assert(await storage.readChatImage(shared));
  await storage.updateSessionSettings(lan.id, { backgroundImage: null });
  assert.equal(await storage.readChatImage(shared), null);
});
