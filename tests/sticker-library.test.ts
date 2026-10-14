import assert from "node:assert/strict";
import test from "node:test";
import {
  addStickers, createPack, createStickerStorage, deletePack, emptyStickerDocument, MAX_STICKERS_PER_PACK, normalizeStickerDocument,
  packsForCharacter, removeSticker, renameSticker, resolveStickerChoice, setPackCharacter, stickerMenu, unbindCharacter, updatePackInfo,
} from "../lib/chat/sticker-storage";
import { isMessageSticker, stickerContent } from "../lib/chat/sticker-message";

const row = (name: string, n: number) => ({ name, url: `https://img.test/${n}.png` });
function library() {
  let doc = createPack(emptyStickerDocument(), "丑猫", "", "p1", 1);
  doc = createPack(doc, "蜘蛛侠", "", "p2", 2);
  let n = 0;
  doc = addStickers(doc, "p1", [row("贴贴", 1), row("无语", 2)], () => `s${++n}`).document;
  doc = addStickers(doc, "p2", [row("贴贴", 3)], () => `s${++n}`).document;
  return doc;
}

test("pack and sticker edits are pure and keep names, notes and bindings tidy", () => {
  let doc = library();
  assert.equal(doc.packs[0].note, undefined, "no empty note field");
  doc = updatePackInfo(doc, "p1", { name: "  丑  猫 ", note: "来自社区" });
  assert.deepEqual([doc.packs[0].name, doc.packs[0].note], ["丑 猫", "来自社区"]);
  doc = updatePackInfo(doc, "p1", { note: "" });
  assert.equal(Object.hasOwn(doc.packs[0], "note"), false);
  assert.throws(() => updatePackInfo(doc, "p1", { name: "  " }));
  doc = renameSticker(doc, "p1", "s1", "抱抱");
  assert.equal(doc.packs[0].stickers[0].name, "抱抱");
  doc = removeSticker(doc, "p1", "s2");
  assert.deepEqual(doc.packs[0].stickers.map((item) => item.id), ["s1"]);
  doc = setPackCharacter(doc, "p1", "peter", true);
  doc = setPackCharacter(setPackCharacter(doc, "p1", "pep", true), "p1", "pep", true);
  assert.deepEqual(doc.packs[0].characterIds, ["peter", "pep"]);
  doc = setPackCharacter(setPackCharacter(doc, "p1", "peter", false), "p1", "pep", false);
  assert.equal(Object.hasOwn(doc.packs[0], "characterIds"), false);
  assert.deepEqual(deletePack(doc, "p1").packs.map((pack) => pack.id), ["p2"]);
  const bound = setPackCharacter(setPackCharacter(doc, "p1", "peter", true), "p2", "peter", true);
  assert.ok(unbindCharacter(bound, "peter").packs.every((pack) => !("characterIds" in pack)));
});

test("adding skips repeated links, bad rows, and stops at the pack limit", () => {
  let doc = createPack(emptyStickerDocument(), "a", "", "p", 1);
  const first = addStickers(doc, "p", [row("x", 1), row("y", 1), { name: "", url: "https://img.test/9.png" }, { name: "z", url: "javascript:1" }]);
  assert.equal(first.added, 1);
  doc = first.document;
  const many = Array.from({ length: MAX_STICKERS_PER_PACK + 5 }, (_, i) => row(`n${i}`, 100 + i));
  const filled = addStickers(doc, "p", many);
  assert.equal(filled.document.packs[0].stickers.length, MAX_STICKERS_PER_PACK);
  assert.ok(filled.full);
});

test("a Character is offered only its bound packs, with short codes and 图集｜表情 labels", () => {
  let doc = library();
  assert.deepEqual(stickerMenu(doc, "peter"), []);
  doc = setPackCharacter(setPackCharacter(doc, "p2", "peter", true), "p1", "peter", true);
  const menu = stickerMenu(doc, "peter");
  assert.deepEqual(menu.map((choice) => [choice.code, choice.label]),
    [["S01", "丑猫｜贴贴"], ["S02", "丑猫｜无语"], ["S03", "蜘蛛侠｜贴贴"]], "same sticker name in two packs stays distinct");
  assert.deepEqual(stickerMenu(doc, "pep"), []);
  assert.equal(stickerMenu(doc, "peter", 2).length, 2);
  assert.equal(packsForCharacter(createPack(doc, "空", "", "p3", 3), "peter").length, 2);
});

test("a chosen code maps to the stored ids and is checked again: unknown, unbound, removed or invented → null", () => {
  let doc = setPackCharacter(library(), "p2", "peter", true);
  const menu = stickerMenu(doc, "peter");
  const chosen = resolveStickerChoice(doc, "peter", menu, " s01 ");
  assert.deepEqual(chosen, { packId: "p2", packName: "蜘蛛侠", stickerId: "s3", name: "贴贴", url: "https://img.test/3.png" });
  assert.ok(isMessageSticker(chosen));
  assert.equal(resolveStickerChoice(doc, "peter", menu, "S09"), null);
  assert.equal(resolveStickerChoice(doc, "peter", menu, "贴贴"), null, "names are never accepted");
  assert.equal(resolveStickerChoice(doc, "peter", menu, 1), null);
  assert.equal(resolveStickerChoice(doc, "pep", menu, "S01"), null, "another Character cannot use peter's menu");
  assert.equal(resolveStickerChoice(setPackCharacter(doc, "p2", "peter", false), "peter", menu, "S01"), null, "unbound since the offer");
  assert.equal(resolveStickerChoice(removeSticker(doc, "p2", "s3"), "peter", menu, "S01"), null, "removed since the offer");
  doc = renameSticker(doc, "p2", "s3", "新名字");
  assert.equal(resolveStickerChoice(doc, "peter", menu, "S01")!.name, "新名字", "ids decide, names are current");
});

test("stored data that is damaged loses only the bad rows", () => {
  const doc = normalizeStickerDocument({ version: 1, packs: [
    { id: "a", name: "好", stickers: [{ id: "1", name: "x", url: "https://i.test/1.png" }, { id: "1", name: "dup", url: "https://i.test/2.png" },
      { id: "2", name: "bad", url: "file:///etc/passwd" }, null], characterIds: ["peter", 5, "peter"], createdAt: "no" },
    { id: "a", name: "same id" }, { id: "b", name: "  " }, "x"] });
  assert.equal(doc.packs.length, 1);
  assert.deepEqual(doc.packs[0].stickers.map((item) => item.id), ["1"]);
  assert.deepEqual(doc.packs[0].characterIds, ["peter"]);
  assert.deepEqual(normalizeStickerDocument(null), emptyStickerDocument());
});

class MemoryStorage { data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; } setItem(key: string, value: string) { this.data.set(key, value); } removeItem(key: string) { this.data.delete(key); } }
const noLocks = () => undefined;

test("the library is saved whole, reading never writes, and data from a newer version is never replaced", async () => {
  const memory = new MemoryStorage(), storage = createStickerStorage(() => memory, noLocks);
  assert.deepEqual(await storage.load(), emptyStickerDocument());
  assert.equal(memory.data.size, 0, "reading an empty library writes nothing");
  await storage.transact((doc) => doc);
  assert.equal(memory.data.size, 0, "a change that changes nothing writes nothing");
  await storage.transact((doc) => createPack(doc, "丑猫", "", "p1", 1));
  assert.equal((await storage.load()).packs[0].name, "丑猫");
  memory.data.set("veil.stickers.v1", JSON.stringify({ version: 2, packs: [] }));
  await assert.rejects(storage.load());
  await assert.rejects(storage.transact((doc) => createPack(doc, "x")));
  assert.equal(memory.data.get("veil.stickers.v1"), JSON.stringify({ version: 2, packs: [] }));
});

test("the semantic text names the sender and the picture, never the link", () => {
  const sticker = { packName: "丑猫", name: "贴贴" };
  assert.equal(stickerContent("user", sticker), "[用户发送了一个表情包：丑猫｜贴贴]");
  assert.equal(stickerContent("assistant", sticker), "[你发送了一个表情包：丑猫｜贴贴]");
  assert.equal(isMessageSticker({ packId: "p", packName: "a", stickerId: "s", name: "b", url: "https://i.test/x.png" }), true);
  for (const bad of [null, {}, { packId: "p", packName: "a", stickerId: "s", name: "b", url: "javascript:1" },
    { packId: "p", packName: "a", stickerId: "s", name: "b", url: "https://i.test/x.png", extra: 1 }, { packId: "", packName: "a", stickerId: "s", name: "b", url: "https://i.test/x.png" }])
    assert.equal(isMessageSticker(bad), false);
});
