import type { FoundationStorage, StringStorage } from "./foundation-storage";
import { withoutRegexBinding } from "./bindings";
import { emptyRegexDocument, validateRegexDocument, type RegexDocument } from "./regex";
import { DEFAULT_REGEX_GROUP_ID, DEFAULT_RULE_IDS, withDefaultRegexGroup } from "./regex-defaults";
import { chatStorage } from "./chat/storage";

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
const rawBrowserRegexStorage = createRegexStorage(() => window.localStorage);
let initializing: Promise<void> | undefined;
async function ensureBrowserDefaults() {
  if (!initializing) initializing = (async () => {
    const current = await rawBrowserRegexStorage.load();
    if (current.groups.some((group) => group.id === DEFAULT_REGEX_GROUP_ID)) return;
    const legacy = await chatStorage.readLegacyChatFormatting();
    const addDefaults = (document: RegexDocument): RegexDocument => {
      if (document.groups.some((group) => group.id === DEFAULT_REGEX_GROUP_ID)) return document;
      const groups = withDefaultRegexGroup(document.groups);
      if (legacy) {
        const defaults = groups[0];
        defaults.rules = defaults.rules.map((rule) => {
          const key = (Object.keys(DEFAULT_RULE_IDS) as (keyof typeof DEFAULT_RULE_IDS)[])
            .find((item) => DEFAULT_RULE_IDS[item] === rule.id);
          return key ? { ...rule, enabled: legacy[key] } : rule;
        });
      }
      return { ...document, groups };
    };
    try { await rawBrowserRegexStorage.transact(addDefaults); }
    catch (reason) {
      if (!(await rawBrowserRegexStorage.load()).groups.some((group) => group.id === DEFAULT_REGEX_GROUP_ID))
        throw reason;
    }
    if (legacy) await chatStorage.deleteLegacyChatFormatting();
  })().finally(() => { initializing = undefined; });
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
  regex: ReturnType<typeof createRegexStorage>,
  foundation: FoundationStorage,
): Promise<RegexDocument> {
  const before = await regex.load();
  if (groupId === DEFAULT_REGEX_GROUP_ID) throw new Error("Default Rules cannot be deleted.");
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
