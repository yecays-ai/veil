import type { StringStorage } from "./foundation-storage";
import { emptyWorldBookDocument, validateWorldBookDocument, type WorldBookDocument } from "./worldbook";

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
