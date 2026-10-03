import { normalizeBindings, type BindingDocument } from "./bindings";
import {
  browserFoundationStorage,
  type FoundationStorage,
} from "./foundation-storage";

export function createBindingStorage(storage: FoundationStorage) {
  return {
    async load(): Promise<BindingDocument> {
      return (await storage.load()).bindings;
    },
    async save(bindings: BindingDocument): Promise<BindingDocument> {
      const document = await storage.transact((d) => ({
        ...d,
        bindings: normalizeBindings(
          bindings,
          d.characters.map((c) => c.characterId),
        ),
      }));
      return document.bindings;
    },
  };
}
export const browserBindingStorage = createBindingStorage(
  browserFoundationStorage,
);
