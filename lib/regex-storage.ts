import type { BindingStorage } from "./binding-storage";
import type { StringStorage } from "./storage-types";
import { withoutRegexBinding } from "./bindings";
import { emptyRegexDocument, validateRegexDocument, type RegexDocument } from "./regex";
import { DEFAULT_REGEX_GROUP_ID, defaultRegexGroup, withDefaultRegexGroup } from "./regex-defaults";

const KEY = "veil.regex.v1";
export interface RegexStorage {
  load(): Promise<RegexDocument>;
  save(document: RegexDocument): Promise<void>;
  transact(update: (current: RegexDocument) => RegexDocument): Promise<RegexDocument>;
}
export function createRegexStorage(getStorage: () => StringStorage): RegexStorage {
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
const rawBrowserRegexStorage = createRegexStorage(() => window.localStorage);
export async function ensureDefaultRegexGroup(storage: RegexStorage) {
  const current = await storage.load();
  const builtin = current.groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
  if (builtin && (builtin.createdAt !== 0 || builtin.updatedAt !== 0)) return;
  const addOrRefreshDefaults = (document: RegexDocument): RegexDocument => {
    const existing = document.groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
    if (existing && (existing.createdAt !== 0 || existing.updatedAt !== 0)) return document;
    const groups = existing
      ? document.groups.map((group) => group.id === DEFAULT_REGEX_GROUP_ID ? defaultRegexGroup() : group)
      : withDefaultRegexGroup(document.groups);
    return { ...document, groups };
  };
  try { await storage.transact(addOrRefreshDefaults); }
  catch (reason) {
    const after = (await storage.load()).groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
    if (!after || (after.createdAt === 0 && after.updatedAt === 0)) throw reason;
  }
}
let initializing: Promise<void> | undefined;
async function ensureBrowserDefaults() {
  if (!initializing) initializing = ensureDefaultRegexGroup(rawBrowserRegexStorage)
    .finally(() => { initializing = undefined; });
  await initializing;
}
export const browserRegexStorage = {
  async load() { await ensureBrowserDefaults(); return rawBrowserRegexStorage.load(); },
  async save(document: RegexDocument) { await ensureBrowserDefaults(); return rawBrowserRegexStorage.save(document); },
  async transact(update: (current: RegexDocument) => RegexDocument) {
    await ensureBrowserDefaults();
    return rawBrowserRegexStorage.transact(update);
  },
};

export async function deleteRegexGroupAndBindings(
  groupId: string,
  regex: RegexStorage,
  bindings: BindingStorage,
): Promise<RegexDocument> {
  const before = await regex.load();
  if (groupId === DEFAULT_REGEX_GROUP_ID) throw new Error("Default Rules cannot be deleted.");
  const index = before.groups.findIndex((group) => group.id === groupId);
  if (index < 0) throw new Error("Regex Group not found.");
  await regex.transact((current) => ({ ...current,
    groups: current.groups.filter((group) => group.id !== groupId) }));
  try {
    await bindings.transact((current) => withoutRegexBinding(current, groupId));
  } catch (reason) {
    await regex.transact((current) => current.groups.some((group) => group.id === groupId) ? current : {
      ...current,
      groups: [...current.groups.slice(0, index), before.groups[index], ...current.groups.slice(index)],
    });
    throw reason;
  }
  return regex.load();
}
