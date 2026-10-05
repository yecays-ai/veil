import { APP_IDS, type AppId } from "./app-registry";

export type BindingSlot = {
  apiConfigId?: string | null;
  voiceConfigId?: string | null;
  presetId?: string | null;
  worldBookIds?: string[];
  regexIds?: string[];
};
export type BindingDocument = {
  global: BindingSlot;
  characters: Record<
    string,
    { defaults: BindingSlot; apps: Partial<Record<AppId, BindingSlot>> }
  >;
};
const scalarKeys = ["apiConfigId", "voiceConfigId", "presetId"] as const;
const listKeys = ["worldBookIds", "regexIds"] as const;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function normalizeBindingSlot(value: unknown): BindingSlot {
  const raw = record(value),
    result: BindingSlot = {};
  for (const key of scalarKeys) {
    if (raw[key] === null) result[key] = null;
    else if (typeof raw[key] === "string" && raw[key].trim())
      result[key] = raw[key].trim().slice(0, 200);
  }
  for (const key of listKeys)
    if (Array.isArray(raw[key]))
      result[key] = [
        ...new Set(
          raw[key]
            .filter((id): id is string => typeof id === "string" && !!id.trim())
            .map((id) => id.trim().slice(0, 200)),
        ),
      ];
  return result;
}
export function normalizeBindings(
  value: unknown,
  characterIds: readonly string[],
): BindingDocument {
  const raw = record(value),
    source = record(raw.characters);
  const characters: BindingDocument["characters"] = {};
  for (const id of characterIds)
    if (Object.hasOwn(source, id)) {
      const item = record(source[id]),
        apps: Partial<Record<AppId, BindingSlot>> = {};
      for (const appId of APP_IDS)
        if (Object.hasOwn(record(item.apps), appId))
          apps[appId] = normalizeBindingSlot(record(item.apps)[appId]);
      characters[id] = { defaults: normalizeBindingSlot(item.defaults), apps };
    }
  return { global: normalizeBindingSlot(raw.global), characters };
}

// Missing fields inherit; null (scalar) and [] (list) explicitly clear a binding.
// Lists replace their inherited list; they are not concatenated.
export function resolveBindings(
  document: BindingDocument,
  characterId: string | null,
  appId: AppId,
): BindingSlot {
  const character = characterId ? document.characters[characterId] : undefined;
  return normalizeBindingSlot({
    ...normalizeBindingSlot(document.global),
    ...normalizeBindingSlot(character?.defaults),
    ...normalizeBindingSlot(character?.apps[appId]),
  });
}

export function withoutWorldBookBinding(document: BindingDocument, bookId: string): BindingDocument {
  const omit = (slot: BindingSlot): BindingSlot => slot.worldBookIds
    ? { ...slot, worldBookIds: slot.worldBookIds.filter((id) => id !== bookId) } : slot;
  return {
    global: omit(document.global),
    characters: Object.fromEntries(Object.entries(document.characters).map(([id, binding]) => [id, {
      defaults: omit(binding.defaults),
      apps: Object.fromEntries(Object.entries(binding.apps).map(([app, slot]) => [app, omit(slot ?? {})])),
    }])),
  };
}
