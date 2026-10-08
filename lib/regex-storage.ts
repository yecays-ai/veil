import type { BindingStorage } from "./binding-storage";
import type { StringStorage } from "./storage-types";
import { withoutRegexBinding } from "./bindings";
import { emptyRegexDocument, validateRegexDocument, type RegexDocument } from "./regex";
import { DEFAULT_REGEX_GROUP_ID, defaultRegexGroup, withDefaultRegexGroup } from "./regex-defaults";

const KEY = "veil.regex.v1";
export interface RegexStorage {
  load(): Promise<RegexDocument>;
  save(document: RegexDocument, expected?: RegexDocument): Promise<void>;
  transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument): Promise<RegexDocument>;
}
export function createRegexStorage(getStorage: () => StringStorage): RegexStorage {
  const exclusive = async <T>(operation: () => T, guarded: boolean): Promise<T> => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request(KEY, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error("Regex is being saved elsewhere. Try again.");
        return operation();
      });
    if (guarded && typeof window !== "undefined")
      throw new Error("Safe Regex editing requires browser Web Locks. Your draft has been kept.");
    return operation();
  };
  const assertSnapshot = (current: RegexDocument, expected?: RegexDocument) => {
    if (expected && JSON.stringify(current) !== JSON.stringify(validateRegexDocument(expected)))
      throw new Error("Regex changed elsewhere or was deleted. Your draft has been kept. Copy it, then reopen the editor to review the latest data.");
  };
  const load = (): RegexDocument => {
    const raw = getStorage().getItem(KEY);
    if (!raw) return emptyRegexDocument();
    try { return validateRegexDocument(JSON.parse(raw)); }
    catch { throw new Error("Saved Regex data could not be read."); }
  };
  return {
    async load() { return load(); },
    save(document: RegexDocument, expected?: RegexDocument) { return exclusive(() => {
      assertSnapshot(load(), expected);
      getStorage().setItem(KEY, JSON.stringify(validateRegexDocument(document)));
    }, expected !== undefined); },
    transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument) { return exclusive(() => {
      const before = getStorage().getItem(KEY);
      const current = load();
      assertSnapshot(current, expected);
      const next = validateRegexDocument(update(current));
      if (getStorage().getItem(KEY) !== before)
        throw new Error("Regex data changed while saving. Try again.");
      getStorage().setItem(KEY, JSON.stringify(next));
      return next;
    }, expected !== undefined); },
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
  async save(document: RegexDocument, expected?: RegexDocument) { await ensureBrowserDefaults(); return rawBrowserRegexStorage.save(document, expected); },
  async transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument) {
    await ensureBrowserDefaults();
    return rawBrowserRegexStorage.transact(update, expected);
  },
};

export async function deleteRegexGroupAndBindings(
  groupId: string,
  regex: RegexStorage,
  bindings: BindingStorage,
  expected?: RegexDocument,
  assertOwner: () => void = () => {},
): Promise<RegexDocument> {
  if (groupId === DEFAULT_REGEX_GROUP_ID) throw new Error("Default Rules cannot be deleted.");
  let before!: RegexDocument;
  const after = await regex.transact((current) => {
    assertOwner();
    if (!current.groups.some((group) => group.id === groupId)) throw new Error("Regex Group not found.");
    before = structuredClone(current);
    return { ...current, groups: current.groups.filter((group) => group.id !== groupId) };
  }, expected);
  try {
    await bindings.transact((current) => withoutRegexBinding(current, groupId));
  } catch (reason) {
    try { await regex.transact(() => before, after); }
    catch { throw new Error("Regex changed while Binding cleanup failed. Newer data was kept; review Regex and Bindings."); }
    throw reason;
  }
  return regex.load();
}
