import type { FoundationStorage, StringStorage } from "./foundation-storage";
import { withoutRegexBinding } from "./bindings";
import { emptyRegexDocument, validateRegexDocument, type RegexDocument } from "./regex";

const KEY = "veil.regex.v1";
export function createRegexStorage(getStorage: () => StringStorage) {
  const load = (): RegexDocument => {
    const raw = getStorage().getItem(KEY);
    if (!raw) return emptyRegexDocument();
    try { return validateRegexDocument(JSON.parse(raw)); }
    catch { throw new Error("Saved Regex data could not be read."); }
  };
  return {
    async load() { return load(); },
    async save(document: RegexDocument) {
      getStorage().setItem(KEY, JSON.stringify(validateRegexDocument(document)));
    },
    async transact(update: (current: RegexDocument) => RegexDocument) {
      const before = getStorage().getItem(KEY);
      const next = validateRegexDocument(update(load()));
      if (getStorage().getItem(KEY) !== before)
        throw new Error("Regex data changed while saving. Try again.");
      getStorage().setItem(KEY, JSON.stringify(next));
      return next;
    },
  };
}
export const browserRegexStorage = createRegexStorage(() => window.localStorage);

export async function deleteRegexGroupAndBindings(
  groupId: string,
  regex: ReturnType<typeof createRegexStorage>,
  foundation: FoundationStorage,
): Promise<RegexDocument> {
  const before = await regex.load();
  const index = before.groups.findIndex((group) => group.id === groupId);
  if (index < 0) throw new Error("Regex Group not found.");
  await regex.transact((current) => ({ ...current,
    groups: current.groups.filter((group) => group.id !== groupId) }));
  try {
    await foundation.transact((current) => ({ ...current,
      bindings: withoutRegexBinding(current.bindings, groupId) }));
  } catch (reason) {
    await regex.transact((current) => current.groups.some((group) => group.id === groupId) ? current : {
      ...current,
      groups: [...current.groups.slice(0, index), before.groups[index], ...current.groups.slice(index)],
    });
    throw reason;
  }
  return regex.load();
}
