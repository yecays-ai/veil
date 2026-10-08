import type { BindingStorage } from "./binding-storage";
import type { StringStorage } from "./storage-types";
import { emptyWorldBookDocument, validateWorldBookDocument, type WorldBookDocument } from "./worldbook";
import { withoutWorldBookBinding } from "./bindings";
import { createRegexWorldBookWriteGuard, EditorSnapshotConflict } from "./regex-worldbook-write-guard";

const KEY = "veil.worldbooks.v1";
export interface WorldBookStorage {
  load(): Promise<WorldBookDocument>;
  save(document: WorldBookDocument, expected?: WorldBookDocument): Promise<void>;
  transact(update: (current: WorldBookDocument) => WorldBookDocument, expected?: WorldBookDocument): Promise<WorldBookDocument>;
}
export function createWorldBookStorage(getStorage: () => StringStorage): WorldBookStorage {
  const { exclusive, assertSnapshot } = createRegexWorldBookWriteGuard(KEY, validateWorldBookDocument, {
    busy: "WorldBooks are being saved elsewhere. Try again.",
    unsupported: "Safe WorldBook editing requires browser Web Locks. Your draft has been kept.",
    conflict: "WorldBook changed elsewhere or was deleted. Your draft has been kept. Copy it, then reopen the editor to review the latest data.",
  });
  const load = (): WorldBookDocument => {
    const raw = getStorage().getItem(KEY);
    if (!raw) return emptyWorldBookDocument();
    try { return validateWorldBookDocument(JSON.parse(raw)); }
    catch { throw new Error("Saved WorldBook data could not be read."); }
  };
  return {
    async load() { return load(); },
    save(document: WorldBookDocument, expected?: WorldBookDocument) { return exclusive(() => {
      assertSnapshot(load(), expected);
      getStorage().setItem(KEY, JSON.stringify(validateWorldBookDocument(document)));
    }, expected !== undefined); },
    transact(update: (current: WorldBookDocument) => WorldBookDocument, expected?: WorldBookDocument) { return exclusive(() => {
      const before = getStorage().getItem(KEY);
      const current = load();
      assertSnapshot(current, expected);
      const next = validateWorldBookDocument(update(current));
      if (getStorage().getItem(KEY) !== before)
        throw new Error("WorldBook data changed while saving. Try again.");
      getStorage().setItem(KEY, JSON.stringify(next));
      return next;
    }, expected !== undefined); },
  };
}
export const browserWorldBookStorage = createWorldBookStorage(() => window.localStorage);

export async function deleteWorldBookAndBindings(
  bookId: string,
  worldBooks: WorldBookStorage,
  bindings: BindingStorage,
  expected?: WorldBookDocument,
  assertOwner: () => void = () => {},
): Promise<WorldBookDocument> {
  let before!: WorldBookDocument;
  const after = await worldBooks.transact((current) => {
    assertOwner();
    if (!current.books.some((book) => book.id === bookId)) throw new Error("WorldBook not found.");
    before = structuredClone(current);
    return { ...current, books: current.books.filter((book) => book.id !== bookId) };
  }, expected);
  try {
    await bindings.transact((current) => withoutWorldBookBinding(current, bookId));
  } catch (reason) {
    try { await worldBooks.transact(() => before, after); }
    catch (rollback) {
      if (rollback instanceof EditorSnapshotConflict)
        throw new Error("WorldBooks changed while Binding cleanup failed. Newer data was kept; review WorldBooks and Bindings.", { cause: reason });
      throw new Error(`Binding cleanup failed and the WorldBook could not be restored: ${rollback instanceof Error ? rollback.message : String(rollback)}`, { cause: reason });
    }
    throw reason;
  }
  return worldBooks.load();
}
