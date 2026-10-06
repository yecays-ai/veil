import { normalizeBindings, type BindingDocument } from "./bindings";
import type { StringStorage } from "./storage-types";

export const BINDING_STORAGE_KEY = "veil.bindings.v1";
export function normalizeBindingDocument(value: unknown): BindingDocument {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return normalizeBindings(raw, Object.keys(raw.characters && typeof raw.characters === "object" ? raw.characters : {})
    .filter((id) => !["__proto__", "constructor", "prototype"].includes(id)));
}
export function createBindingStorage(getStorage: () => StringStorage) {
  let queue = Promise.resolve();
  const load = async (): Promise<BindingDocument> => {
    const storage = getStorage();
    const raw = storage.getItem(BINDING_STORAGE_KEY);
    return normalizeBindingDocument(raw ? JSON.parse(raw) : null);
  };
  const transact = (update: (current: BindingDocument) => BindingDocument) => {
    const operation = queue.then(async () => {
      const next = normalizeBindingDocument(update(await load()));
      getStorage().setItem(BINDING_STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== "undefined") window.dispatchEvent(new Event("veil-bindings-change"));
      return next;
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  return { load, transact, save: (document: BindingDocument) => transact(() => document) };
}
export type BindingStorage = ReturnType<typeof createBindingStorage>;
export const browserBindingStorage = createBindingStorage(() => window.localStorage);
