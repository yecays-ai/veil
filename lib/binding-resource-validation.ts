import { browserApiConfigStorage, type ApiConfigStorage } from "./api-config-storage";
import type { AvailableBindingResources, BindingDocument } from "./bindings";
import { browserPresetStorage, type PresetStorage } from "./preset-storage";
import { createPresetDocument, validatePresetDocument } from "./preset";
import { browserWorldBookStorage, type WorldBookStorage } from "./worldbook-storage";
import { createRegexStorage, type RegexStorage } from "./regex-storage";
import { DEFAULT_REGEX_GROUP_ID } from "./regex-defaults";

type ResourceReaders = {
  api: Pick<ApiConfigStorage, "withApiConfigs">;
  presets: Pick<PresetStorage, "readRaw">;
  worldBooks: Pick<WorldBookStorage, "load">;
  regex: Pick<RegexStorage, "load">;
};

// These are the EXISTING adapters' origin lock names, not a second lock namespace.
// Order: Binding (caller), then these resources, then the API readonly transaction.
// Resource deletion releases its resource lock before requesting Binding cleanup.
const RESOURCE_LOCKS = ["veil.preset.v1", "veil.worldbooks.v1", "veil.regex.v1"] as const;

export function createBindingResourceValidation(readers: ResourceReaders,
  getLocks: () => Pick<LockManager, "request"> | undefined = () => globalThis.navigator?.locks) {
  return async (write: (available: AvailableBindingResources) => BindingDocument): Promise<BindingDocument> => {
    const locks = getLocks();
    if (!locks) throw new Error("Safe Binding cleanup requires browser Web Locks. Nothing was cleaned.");
    const protectedRead = async () => {
      // Preset.load and browserRegexStorage.load can themselves take these locks/write defaults.
      // Read through their non-mutating adapter paths instead; never reset or repair catalogs here.
      const [rawPreset, worldBooks, regex] = await Promise.all([
        readers.presets.readRaw(), readers.worldBooks.load(), readers.regex.load(),
      ]);
      const presets = rawPreset === null ? createPresetDocument() : validatePresetDocument(JSON.parse(rawPreset));
      return readers.api.withApiConfigs((api) => write({
        apiConfigIds: new Set(api.map((item) => item.id)),
        presetIds: new Set(presets.presets.map((item) => item.id)),
        worldBookIds: new Set(worldBooks.books.map((item) => item.id)),
        regexIds: new Set(regex.groups.filter((item) => item.id !== DEFAULT_REGEX_GROUP_ID).map((item) => item.id)),
      }));
    };
    const protect = async (index: number): Promise<BindingDocument> => index === RESOURCE_LOCKS.length
      ? await protectedRead()
      : await locks.request(RESOURCE_LOCKS[index], { mode: "exclusive", ifAvailable: true }, (lock) => {
        if (!lock) throw new Error("Binding resources are busy elsewhere. Nothing was cleaned; reopen Bindings to retry.");
        return protect(index + 1);
      });
    return protect(0);
  };
}

export const withCurrentBindingResources = createBindingResourceValidation({
  api: browserApiConfigStorage,
  presets: browserPresetStorage,
  worldBooks: browserWorldBookStorage,
  regex: createRegexStorage(() => window.localStorage),
});
