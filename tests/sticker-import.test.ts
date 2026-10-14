import assert from "node:assert/strict";
import test from "node:test";
import { parseStickerText } from "../lib/chat/sticker-import";

const U = "https://imgbed.heliar.top/file";

test("名称：URL with Chinese or English colon, plain spacing, and blank lines", () => {
  const { rows, skipped } = parseStickerText(`贴贴：${U}/a.png\n\n  可爱: ${U}/b.gif  \n\n\n无语   ${U}/c.webp\n`);
  assert.deepEqual(rows, [{ name: "贴贴", url: `${U}/a.png` }, { name: "可爱", url: `${U}/b.gif` }, { name: "无语", url: `${U}/c.webp` }]);
  assert.deepEqual(skipped, []);
});

test("names may contain slashes, punctuation, ellipsis and question marks", () => {
  const { rows } = parseStickerText(`请帮我一下/被挤扁了：${U}/1.png\n真的吗？...：${U}/2.png\n哈哈,哈（笑）：${U}/3.png`);
  assert.deepEqual(rows.map((row) => row.name), ["请帮我一下/被挤扁了", "真的吗？...", "哈哈,哈（笑）"]);
});

test("a URL wrapped onto the next line is joined back, and a stray line is reported rather than glued on", () => {
  const wrapped = parseStickerText(`贴贴：${U}/%E8%B4%B4\n%E8%B4%B4.png\n可爱：${U}/b.gif`);
  assert.deepEqual(wrapped.rows, [{ name: "贴贴", url: `${U}/%E8%B4%B4%E8%B4%B4.png` }, { name: "可爱", url: `${U}/b.gif` }]);
  assert.deepEqual(wrapped.skipped, []);
  const split = parseStickerText(`请帮我一下：${U}/请帮我一下/\n被挤扁了.png`);
  assert.equal(split.rows.length, 1);
  assert.equal(decodeURIComponent(split.rows[0].url), `${U}/请帮我一下/被挤扁了.png`);
  // A link with no image ending keeps itself; the following plain line is not part of it.
  const stray = parseStickerText(`名字：${U}/noextension\n孤立的一行`);
  assert.equal(stray.rows.length, 1);
  assert.equal(stray.rows[0].url, `${U}/noextension`);
  assert.deepEqual(stray.skipped, [{ text: "孤立的一行", reason: "no-url" }]);
});

test("several rows on one line, list markers, repeated spaces, CRLF", () => {
  const { rows } = parseStickerText(`1. 贴贴  ${U}/a.png   可爱   ${U}/b.png\r\n- 无语：${U}/c.png\r\n`);
  assert.deepEqual(rows.map((row) => row.name), ["贴贴", "可爱", "无语"]);
});

test("a missing name falls back to the file name; unusable lines are reported with a reason", () => {
  const { rows, skipped } = parseStickerText(`${U}/%E5%93%88%E5%93%88.png\n标题行\n坏链接：https://\nftp://x/y.png\n重复：${U}/%E5%93%88%E5%93%88.png`);
  assert.deepEqual(rows, [{ name: "哈哈", url: `${U}/%E5%93%88%E5%93%88.png` }]);
  assert.deepEqual(skipped.map((skip) => skip.reason), ["no-url", "bad-url", "no-url", "duplicate"]);
});

test("only http(s) links are accepted and trailing punctuation is not part of the link", () => {
  const { rows, skipped } = parseStickerText(`a：${U}/a.png，\nb：javascript:alert(1)\nc：data:image/png;base64,AAAA`);
  assert.deepEqual(rows, [{ name: "a", url: `${U}/a.png` }]);
  assert.equal(skipped.length, 2);
});

test("names are capped at 40 characters and carry no control characters", () => {
  const { rows } = parseStickerText(`${"长".repeat(60)}​：${U}/a.png`);
  assert.equal(Array.from(rows[0].name).length, 40);
});
