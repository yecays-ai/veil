import { normalizeBindings, type BindingDocument } from "./bindings";
import type { StringStorage } from "./storage-types";

export const BINDING_STORAGE_KEY = "veil.bindings.v1";
export function normalizeBindingDocument(value: unknown): BindingDocument {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return normalizeBindings(raw, Object.keys(raw.characters && typeof raw.characters === "object" ? raw.characters : {})
    .filter((id) => !["__proto__", "constructor", "prototype"].includes(id)));
}
const WRITE_ATTEMPTS = 3;
/**
 * Every write is one read-modify-write of the whole Binding document, coordinated at three levels:
 * 1. This instance runs its own writes in order.
 * 2. Across tabs each write holds an exclusive Web Lock (`BINDING_STORAGE_KEY`), so cooperating tabs
 *    never interleave and each write starts from the latest stored document. Without Web Locks
 *    (`getLocks()` undefined) only levels 1 and 3 apply.
 * 3. Just before writing, the stored value is re-read; if another context changed it since the read,
 *    the update is recomputed (at most WRITE_ATTEMPTS times, then the write fails and saves nothing).
 *    This narrows, but cannot close, the gap before setItem (localStorage has no atomic compare-and-set).
 * Updaters must be pure functions of the document they receive. A failed write leaves stored data
 * untouched and does not block later writes. Stored data is never migrated or reset here.
 */
export function createBindingStorage(getStorage: () => StringStorage,
  getLocks: () => Pick<LockManager, "request"> | undefined = () => globalThis.navigator?.locks) {
  let queue: Promise<unknown> = Promise.resolve();
  const parse = (raw: string | null) => normalizeBindingDocument(raw ? JSON.parse(raw) : null);
  const load = async (): Promise<BindingDocument> => parse(getStorage().getItem(BINDING_STORAGE_KEY));
  const commit = (update: (current: BindingDocument) => BindingDocument): BindingDocument => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const before = getStorage().getItem(BINDING_STORAGE_KEY);
      const next = normalizeBindingDocument(update(parse(before)));
      if (getStorage().getItem(BINDING_STORAGE_KEY) !== before) continue;
      getStorage().setItem(BINDING_STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("veil-bindings-change"));
      return next;
    }
    throw new Error("Bindings changed in another tab. Nothing was saved; try again.");
  };
  const transact = (update: (current: BindingDocument) => BindingDocument) => {
    const run = async () => {
      const locks = getLocks();
      return locks ? await locks.request(BINDING_STORAGE_KEY, { mode: "exclusive" }, async () => commit(update))
        : commit(update);
    };
    const operation = queue.then(run, run);
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  return { load, transact, save: (document: BindingDocument) => transact(() => document) };
}
export type BindingStorage = ReturnType<typeof createBindingStorage>;
export const browserBindingStorage = createBindingStorage(() => window.localStorage);
