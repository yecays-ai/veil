import { normalizeBindings, type BindingDocument } from "./bindings";
import type { StringStorage } from "./foundation-storage";

export const BINDING_STORAGE_KEY = "veil.bindings.v1";
export function normalizeBindingDocument(value: unknown): BindingDocument {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return normalizeBindings(raw, Object.keys(raw.characters && typeof raw.characters === "object" ? raw.characters : {})
    .filter((id) => !["__proto__", "constructor", "prototype"].includes(id)));
}
export function migrateLegacyBindings(storage: StringStorage) {
  const legacyRaw = storage.getItem("veil.foundation.v1");
  if (!legacyRaw) return;
  const legacy = JSON.parse(legacyRaw);
  if (!legacy || !Object.hasOwn(legacy, "bindings")) return;
  const existing = storage.getItem(BINDING_STORAGE_KEY);
  if (existing !== null) normalizeBindingDocument(JSON.parse(existing));
  if (existing === null)
    storage.setItem(BINDING_STORAGE_KEY, JSON.stringify(normalizeBindings(legacy.bindings,
      Array.isArray(legacy.characters) ? legacy.characters.map((item: { characterId: string }) => item.characterId) : [])));
  delete legacy.bindings;
  storage.setItem("veil.foundation.v1", JSON.stringify(legacy));
}
export function createBindingStorage(getStorage: () => StringStorage) {
  let queue = Promise.resolve();
  const load = async (): Promise<BindingDocument> => {
    const storage = getStorage(); migrateLegacyBindings(storage);
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
  return { load, transact, save: (document: BindingDocument) => transact(() => document),
    async readRaw() { migrateLegacyBindings(getStorage()); return getStorage().getItem(BINDING_STORAGE_KEY); },
    async replaceIfCurrent(expected: string | null, document: BindingDocument) {
      const next = await transact(() => {
        if (getStorage().getItem(BINDING_STORAGE_KEY) !== expected) throw new Error("Bindings changed while restore was being prepared.");
        return document;
      });
      return JSON.stringify(next);
    },
    async rollbackIfCurrent(expected: string, previous: string | null) {
      const operation = queue.then(() => {
        const storage = getStorage();
        if (storage.getItem(BINDING_STORAGE_KEY) !== expected) return false;
        if (previous === null) {
          if (!storage.removeItem) throw new Error("Binding rollback unavailable.");
          storage.removeItem(BINDING_STORAGE_KEY);
        } else storage.setItem(BINDING_STORAGE_KEY, previous);
        return true;
      });
      queue = operation.then(() => {}, () => {});
      return operation;
    },
  };
}
export type BindingStorage = ReturnType<typeof createBindingStorage>;
export const browserBindingStorage = createBindingStorage(() => window.localStorage);
