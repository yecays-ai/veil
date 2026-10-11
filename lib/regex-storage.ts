import type { BindingStorage } from "./binding-storage";
import type { StringStorage } from "./storage-types";
import { browserPersistenceWriteGate, withPersistenceWriteScope,
  type PersistenceWriteGate, type PersistenceWriteScope } from "./backup/persistence-write-gate";
import { withoutRegexBinding } from "./bindings";
import { emptyRegexDocument, validateRegexDocument, type RegexDocument } from "./regex";
import { DEFAULT_REGEX_GROUP_ID, defaultRegexGroup, withDefaultRegexGroup } from "./regex-defaults";
import { createRegexWorldBookWriteGuard, EditorSnapshotConflict } from "./regex-worldbook-write-guard";

const KEY = "veil.regex.v1";
export interface RegexStorage {
  load(scope?: PersistenceWriteScope): Promise<RegexDocument>;
  save(document: RegexDocument, expected?: RegexDocument): Promise<void>;
  transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument, scope?: PersistenceWriteScope): Promise<RegexDocument>;
}
export function createRegexStorage(getStorage: () => StringStorage,
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate): RegexStorage {
  const { exclusive, assertSnapshot } = createRegexWorldBookWriteGuard(KEY, validateRegexDocument, {
    busy: "Regex is being saved elsewhere. Try again.",
    unsupported: "Safe Regex editing requires browser Web Locks. Your draft has been kept.",
    conflict: "Regex changed elsewhere or was deleted. Your draft has been kept. Copy it, then reopen the editor to review the latest data.",
  }, writeGate);
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
    transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument, scope?: PersistenceWriteScope) { return exclusive(() => {
      const before = getStorage().getItem(KEY);
      const current = load();
      assertSnapshot(current, expected);
      const next = validateRegexDocument(update(current));
      if (getStorage().getItem(KEY) !== before)
        throw new Error("Regex data changed while saving. Try again.");
      getStorage().setItem(KEY, JSON.stringify(next));
      return next;
    }, expected !== undefined, scope); },
  };
}
const rawBrowserRegexStorage = createRegexStorage(() => window.localStorage);
export async function ensureDefaultRegexGroup(storage: RegexStorage, scope?: PersistenceWriteScope) {
  const current = await storage.load(scope);
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
  try { await storage.transact(addOrRefreshDefaults, undefined, scope); }
  catch (reason) {
    const after = (await storage.load(scope)).groups.find((group) => group.id === DEFAULT_REGEX_GROUP_ID);
    if (!after || (after.createdAt === 0 && after.updatedAt === 0)) throw reason;
  }
}
let initializing: Promise<void> | undefined;
async function ensureBrowserDefaults(scope?: PersistenceWriteScope) {
  // Scoped work cannot wait for another initialization queued behind an exclusive snapshot.
  if (scope) return ensureDefaultRegexGroup(rawBrowserRegexStorage, scope);
  if (!initializing) initializing = ensureDefaultRegexGroup(rawBrowserRegexStorage)
    .finally(() => { initializing = undefined; });
  await initializing;
}
export const browserRegexStorage = {
  async load(scope?: PersistenceWriteScope) { await ensureBrowserDefaults(scope); return rawBrowserRegexStorage.load(scope); },
  async save(document: RegexDocument, expected?: RegexDocument) { await ensureBrowserDefaults(); return rawBrowserRegexStorage.save(document, expected); },
  async transact(update: (current: RegexDocument) => RegexDocument, expected?: RegexDocument, scope?: PersistenceWriteScope) {
    await ensureBrowserDefaults(scope);
    return rawBrowserRegexStorage.transact(update, expected, scope);
  },
};

export async function deleteRegexGroupAndBindings(
  groupId: string,
  regex: RegexStorage,
  bindings: BindingStorage,
  expected?: RegexDocument,
  assertOwner: () => void = () => {},
  writeGate: PersistenceWriteGate = browserPersistenceWriteGate,
): Promise<RegexDocument> {
  if (groupId === DEFAULT_REGEX_GROUP_ID) throw new Error("Default Rules cannot be deleted.");
  return withPersistenceWriteScope(writeGate, (scope) => deleteRegexWithScope(groupId, regex, bindings, expected, assertOwner, scope));
}

async function deleteRegexWithScope(groupId: string, regex: RegexStorage, bindings: BindingStorage,
  expected: RegexDocument | undefined, assertOwner: () => void, scope: PersistenceWriteScope): Promise<RegexDocument> {
  let before!: RegexDocument;
  const after = await regex.transact((current) => {
    assertOwner();
    if (!current.groups.some((group) => group.id === groupId)) throw new Error("Regex Group not found.");
    before = structuredClone(current);
    return { ...current, groups: current.groups.filter((group) => group.id !== groupId) };
  }, expected, scope);
  try {
    await bindings.transact((current) => withoutRegexBinding(current, groupId), scope);
  } catch (reason) {
    try { await regex.transact(() => before, after, scope); }
    catch (rollback) {
      if (rollback instanceof EditorSnapshotConflict)
        throw new Error("Regex changed while Binding cleanup failed. Newer data was kept; review Regex and Bindings.", { cause: reason });
      throw new Error(`Binding cleanup failed and the Regex Group could not be restored: ${rollback instanceof Error ? rollback.message : String(rollback)}`, { cause: reason });
    }
    throw reason;
  }
  return regex.load(scope);
}
