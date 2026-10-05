import type { FoundationStorage, StringStorage } from "./foundation-storage";
import { emptyWorldBookDocument, validateWorldBookDocument, type WorldBookDocument } from "./worldbook";
import { withoutWorldBookBinding } from "./bindings";

const KEY = "veil.worldbooks.v1";
export function createWorldBookStorage(getStorage: () => StringStorage) {
  const load = (): WorldBookDocument => {
    const raw = getStorage().getItem(KEY);
    if (!raw) return emptyWorldBookDocument();
    try { return validateWorldBookDocument(JSON.parse(raw)); }
    catch { throw new Error("Saved WorldBook data could not be read."); }
  };
  return {
    async load() { return load(); },
    async save(document: WorldBookDocument) {
      getStorage().setItem(KEY, JSON.stringify(validateWorldBookDocument(document)));
    },
    async transact(update: (current: WorldBookDocument) => WorldBookDocument) {
      const before = getStorage().getItem(KEY);
      const current = load();
      const next = validateWorldBookDocument(update(current));
      if (getStorage().getItem(KEY) !== before)
        throw new Error("WorldBook data changed while saving. Try again.");
      getStorage().setItem(KEY, JSON.stringify(next));
      return next;
    },
  };
}
export const browserWorldBookStorage = createWorldBookStorage(() => window.localStorage);

export async function deleteWorldBookAndBindings(
  bookId: string,
  worldBooks: ReturnType<typeof createWorldBookStorage>,
  foundation: FoundationStorage,
): Promise<WorldBookDocument> {
  const before = await worldBooks.load();
  const index = before.books.findIndex((book) => book.id === bookId);
  if (index < 0) throw new Error("WorldBook not found.");
  await worldBooks.transact((current) => ({ ...current,
    books: current.books.filter((book) => book.id !== bookId) }));
  try {
    await foundation.transact((current) => ({ ...current,
      bindings: withoutWorldBookBinding(current.bindings, bookId) }));
  } catch (reason) {
    // Restore the book if binding cleanup could not be committed.
    await worldBooks.transact((current) => current.books.some((book) => book.id === bookId) ? current : {
      ...current, books: [...current.books.slice(0, index), before.books[index], ...current.books.slice(index)],
    });
    throw reason;
  }
  return worldBooks.load();
}
