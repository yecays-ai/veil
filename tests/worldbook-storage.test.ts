import assert from "node:assert/strict";
import test from "node:test";
import { createWorldBookStorage } from "../lib/worldbook-storage";
import { exportWorldBook, exportWorldBookEntry, importWorldBook, importWorldBookEntry,
  normalizeWorldBook, normalizeWorldBookEntry } from "../lib/worldbook";

test("WorldBook books and entries persist, toggle, reorder and delete", async () => {
  const values = new Map<string, string>();
  const store = createWorldBookStorage(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  }));
  const first = normalizeWorldBook({ name: "City", entries: [] });
  const second = normalizeWorldBook({ name: "School", entries: [] });
  await store.transact((current) => ({ ...current, books: [first, second] }));
  const entry = normalizeWorldBookEntry({ content: "Otto lives here", key: ["Otto"] });
  await store.transact((current) => ({ ...current, books: current.books.map((book) => book.id === first.id
    ? { ...book, entries: [entry, { ...entry, id: crypto.randomUUID(), content: "Another fact" }] } : book) }));
  await store.transact((current) => ({ ...current, books: current.books.reverse().map((book) => book.id === first.id
    ? { ...book, enabled: false, entries: book.entries.reverse().map((item) => ({ ...item, enabled: false })) } : book) }));
  let saved = await store.load();
  assert.deepEqual(saved.books.map((book) => book.name), ["School", "City"]);
  assert.equal(saved.books[1].enabled, false);
  assert.equal(saved.books[1].entries[0].enabled, false);
  await store.transact((current) => ({ ...current, books: current.books.filter((book) => book.id !== first.id) }));
  saved = await store.load();
  assert.deepEqual(saved.books.map((book) => book.name), ["School"]);
});

test("old float and Tavern imports normalize keys, ignore unsupported behavior, and own fresh IDs", () => {
  const original = normalizeWorldBook({ name: "Existing", entries: [] });
  const source = { id: original.id, name: "Imported", entries: { 0: { id: "foreign", comment: "Otto",
    content: "A character", key: ["Otto", "friend"], disable: false, use_regex: true,
    insertion_order: 9, position: 4, probability: 1 } } };
  const imported = importWorldBook({ version: 1, books: [original] }, JSON.stringify(source));
  assert.equal(imported.books.length, 2);
  const book = imported.books[1], entry = book.entries[0];
  assert.notEqual(book.id, original.id);
  assert.notEqual(entry.id, "foreign");
  assert.deepEqual(entry.keywords, ["Otto", "friend"]);
  assert.equal(entry.matchMode, "regex");
  assert.equal(entry.priority, 9);
  assert.equal(entry.position, "before");
  assert.equal(JSON.parse(exportWorldBook(book)).entries[0].content, "A character");
  const appended = importWorldBookEntry(imported, book.id, exportWorldBookEntry(entry));
  assert.equal(appended.books[1].entries.length, 2);
  assert.notEqual(appended.books[1].entries[1].id, entry.id);
  const replaced = importWorldBookEntry(appended, book.id, JSON.stringify({ comment: "Changed", content: "New" }), entry.id);
  assert.equal(replaced.books[1].entries[0].id, entry.id);
  assert.equal(replaced.books[1].entries[0].content, "New");
});

test("malformed import rejects without changing an existing document", () => {
  const document = { version: 1 as const, books: [normalizeWorldBook({ name: "Safe", entries: [] })] };
  for (const json of ["{bad", "{}", '{"entries":[{"content":7}]}', '{"entries":{"x":{"content":"ok","key":[4]}}}'])
    assert.throws(() => importWorldBook(document, json));
  assert.equal(document.books.length, 1);
  assert.equal(document.books[0].name, "Safe");
});
