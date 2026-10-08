import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import type { BindingDocument } from "../lib/bindings";
import { ChatStorage } from "../lib/chat/storage";
import { createChatEngine } from "./chat-engine-fixture";
import { defaultFoundation, normalizeCharacterInput } from "../lib/foundation-types";
import { normalizeBindingSlot } from "../lib/bindings";
import { normalizeWorldBook, selectBoundWorldBooks, type WorldBook } from "../lib/worldbook";

// Library order is A, B, C; every entry is constant with equal priority so only book order differs.
const library = (): WorldBook[] => ["A", "B", "C"].map((name) =>
  normalizeWorldBook({ name, entries: [{ content: `Lore ${name}`, constant: true }] }, `book-${name}`));
const ids = (books: readonly WorldBook[]) => books.map((book) => book.id);

test("an explicit selection keeps the Binding order, not the library order", () => {
  assert.deepEqual(ids(selectBoundWorldBooks(library(), ["book-C", "book-A", "book-B"])), ["book-C", "book-A", "book-B"]);
  assert.deepEqual(ids(selectBoundWorldBooks(library(), ["book-B", "book-A"])), ["book-B", "book-A"]);
});

test("Default All keeps library order and returns every book; explicit None selects nothing", () => {
  const books = library();
  assert.deepEqual(ids(selectBoundWorldBooks(books, undefined)), ["book-A", "book-B", "book-C"]);
  assert.notEqual(selectBoundWorldBooks(books, undefined), books, "callers never receive the library array itself");
  assert.deepEqual(selectBoundWorldBooks(books, []), []);
});

test("duplicate and stale ids are handled stably: first position wins, missing books are skipped", () => {
  const books = library();
  assert.deepEqual(ids(selectBoundWorldBooks(books, ["book-C", "gone", "book-A", "book-C", "book-A", "also-gone"])),
    ["book-C", "book-A"]);
  assert.deepEqual(ids(selectBoundWorldBooks(books, ["gone"])), []);
  // Persisted Bindings already dedupe in order; the resolver stays correct without relying on that.
  assert.deepEqual(normalizeBindingSlot({ worldBookIds: ["book-C", "book-A", "book-C", " ", 7] }).worldBookIds, ["book-C", "book-A"]);
  // Resolution does not alter book content.
  assert.deepEqual(selectBoundWorldBooks(books, ["book-B"])[0], books[1]);
});

async function promptFor(worldBookIds: string[] | undefined, books: WorldBook[] = library()) {
  const storage = new ChatStorage(() => new IDBFactory());
  const document = defaultFoundation(); document.runtime.timeAware = false;
  document.characters = [{ characterId: "p", ...normalizeCharacterInput({ name: "Peter" }) }];
  const session = await storage.openSession("p");
  await storage.send(session.id, "Hello");
  const bindings: BindingDocument = { global: worldBookIds === undefined ? {} : { worldBookIds }, characters: {} };
  let prompt = "";
  const engine = createChatEngine(storage, async () => document, async function* (_config, turns) {
    prompt = turns.map((turn) => turn.content).join("\n"); yield "Ok";
  }, undefined, undefined, async () => ({ version: 1, books }), undefined, async () => bindings);
  await engine.requestReply(session.id);
  return [...prompt.matchAll(/Lore ([ABC])/g)].map((match) => match[1]);
}

test("the generation context uses the Binding order for the final prompt", async () => {
  assert.deepEqual(await promptFor(["book-C", "book-B", "book-A"]), ["C", "B", "A"], "reverse of the library");
  assert.deepEqual(await promptFor(["book-B", "book-C"]), ["B", "C"]);
  assert.deepEqual(await promptFor(["book-C", "book-A"]), ["C", "A"], "unselected books stay out");
  assert.deepEqual(await promptFor(undefined), ["A", "B", "C"], "Default All keeps the library order");
  assert.deepEqual(await promptFor([]), [], "explicit None sends no books");
  assert.deepEqual(await promptFor(["book-B", "gone", "book-B", "book-A"]), ["B", "A"], "duplicates and stale ids");
});

test("fault injection: restoring library-order filtering fails the ordering assertions", async () => {
  const legacy = (books: readonly WorldBook[], selected: readonly string[] | undefined) =>
    books.filter((book) => selected === undefined || selected.includes(book.id));
  assert.deepEqual(ids(legacy(library(), ["book-C", "book-A"])), ["book-A", "book-C"], "the old filter follows the library");
  assert.notDeepEqual(ids(legacy(library(), ["book-C", "book-A"])), ids(selectBoundWorldBooks(library(), ["book-C", "book-A"])));
});
