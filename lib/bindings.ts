import { APP_IDS, type AppId } from "./app-registry";

export type BindingSlot = {
  apiConfigId?: string | null;
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
export type ManagedBindingField = "apiConfigId" | "presetId" | "worldBookIds" | "regexIds";
export type BindingScope = { characterId?: string; appId?: AppId };
const scalarKeys = ["apiConfigId", "presetId"] as const;
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

function compactCharacters(characters: BindingDocument["characters"]): BindingDocument["characters"] {
  return Object.fromEntries(Object.entries(characters).flatMap(([id, binding]) => {
    const apps = Object.fromEntries(Object.entries(binding.apps)
      .filter(([, slot]) => slot && Object.keys(slot).length)) as typeof binding.apps;
    return Object.keys(binding.defaults).length || Object.keys(apps).length
      ? [[id, { defaults: binding.defaults, apps }]] : [];
  }));
}

export function setBindingField(
  document: BindingDocument, scope: BindingScope, field: ManagedBindingField,
  value: BindingSlot[ManagedBindingField],
): BindingDocument {
  const update = (slot: BindingSlot): BindingSlot => {
    const next = { ...slot, [field]: value };
    if (value === undefined) delete next[field];
    return normalizeBindingSlot(next);
  };
  if (!scope.characterId) return { ...document, global: update(document.global) };
  const previous = document.characters[scope.characterId] ?? { defaults: {}, apps: {} };
  const next = scope.appId
    ? { ...previous, apps: { ...previous.apps,
      [scope.appId]: update(previous.apps[scope.appId] ?? {}) } }
    : { ...previous, defaults: update(previous.defaults) };
  return { ...document, characters: compactCharacters({ ...document.characters,
    [scope.characterId]: next }) };
}

// The value a scope itself shows and edits: global alone, global + Character defaults (no App
// override), or the full chain for an App. Character defaults must never be written from a list
// that already includes an App override.
export function resolveScopeBindings(document: BindingDocument, scope: BindingScope): BindingSlot {
  if (scope.appId) return resolveBindings(document, scope.characterId ?? null, scope.appId);
  const character = scope.characterId ? document.characters[scope.characterId] : undefined;
  return normalizeBindingSlot({ ...normalizeBindingSlot(document.global), ...normalizeBindingSlot(character?.defaults) });
}

export type BindingListEdit = { type: "add"; id: string } | { type: "remove"; id: string } | { type: "move"; id: string; by: -1 | 1 };

// List edits are expressed as intents (add or remove one id, move one id by one place) and applied
// to the document being written, never to a copy rendered earlier, so a stale tab cannot drop
// another tab's additions or reorder. The list the user was looking at is the effective one
// (own override, else inherited, else unset = Default (All), which starts from empty).
// Absolute choices (None = [], Default = undefined, a scalar) still go through setBindingField.
export function editBindingList(
  document: BindingDocument, scope: BindingScope, field: "worldBookIds" | "regexIds", edit: BindingListEdit,
): BindingDocument {
  const current = resolveScopeBindings(document, scope)[field] ?? [];
  // add/remove are idempotent: the caller decides the direction from what the user saw, so a
  // concurrent change in another tab can never turn "select" into "deselect".
  if (edit.type === "add")
    return current.includes(edit.id) ? document : setBindingField(document, scope, field, [...current, edit.id]);
  if (edit.type === "remove")
    return current.includes(edit.id)
      ? setBindingField(document, scope, field, current.filter((id) => id !== edit.id)) : document;
  const from = current.indexOf(edit.id), to = from + edit.by;
  if (from < 0 || to < 0 || to >= current.length) return document;
  const next = [...current];
  [next[from], next[to]] = [next[to], next[from]];
  return setBindingField(document, scope, field, next);
}

export type AvailableBindingResources = {
  apiConfigIds: ReadonlySet<string>; presetIds: ReadonlySet<string>;
  worldBookIds: ReadonlySet<string>; regexIds: ReadonlySet<string>;
};

export function cleanStaleBindings(document: BindingDocument, available: AvailableBindingResources): BindingDocument {
  const clean = (slot: BindingSlot): BindingSlot => {
    const next = { ...slot };
    if (next.apiConfigId && !available.apiConfigIds.has(next.apiConfigId))
      next.apiConfigId = null; // Keep a missing Text API fail-closed; inheritance may select another key.
    if (next.presetId && !available.presetIds.has(next.presetId)) delete next.presetId;
    if (next.worldBookIds) next.worldBookIds = next.worldBookIds.filter((id) => available.worldBookIds.has(id));
    if (next.regexIds) next.regexIds = next.regexIds.filter((id) => available.regexIds.has(id));
    return next;
  };
  return {
    global: clean(document.global),
    characters: compactCharacters(Object.fromEntries(Object.entries(document.characters).map(([id, binding]) =>
      [id, { defaults: clean(binding.defaults), apps: Object.fromEntries(Object.entries(binding.apps)
        .map(([app, slot]) => [app, clean(slot ?? {})])) }]))),
  };
}

export function withoutPresetBinding(document: BindingDocument, presetId: string): BindingDocument {
  const omit = (slot: BindingSlot): BindingSlot => {
    if (slot.presetId !== presetId) return slot;
    const next = { ...slot }; delete next.presetId; return next;
  };
  return { global: omit(document.global),
    characters: compactCharacters(Object.fromEntries(Object.entries(document.characters).map(([id, binding]) =>
      [id, { defaults: omit(binding.defaults), apps: Object.fromEntries(Object.entries(binding.apps)
        .map(([app, slot]) => [app, omit(slot ?? {})])) }]))),
  };
}

export function withoutApiConfigBinding(document: BindingDocument, apiConfigId: string): BindingDocument {
  const omit = (slot: BindingSlot): BindingSlot => slot.apiConfigId === apiConfigId
    ? { ...slot, apiConfigId: null } : slot;
  return { global: omit(document.global),
    characters: compactCharacters(Object.fromEntries(Object.entries(document.characters).map(([id, binding]) =>
      [id, { defaults: omit(binding.defaults), apps: Object.fromEntries(Object.entries(binding.apps)
        .map(([app, slot]) => [app, omit(slot ?? {})])) }]))),
  };
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

export function withoutRegexBinding(document: BindingDocument, regexId: string): BindingDocument {
  const omit = (slot: BindingSlot): BindingSlot => slot.regexIds
    ? { ...slot, regexIds: slot.regexIds.filter((id) => id !== regexId) } : slot;
  return {
    global: omit(document.global),
    characters: Object.fromEntries(Object.entries(document.characters).map(([id, binding]) => [id, {
      defaults: omit(binding.defaults),
      apps: Object.fromEntries(Object.entries(binding.apps).map(([app, slot]) => [app, omit(slot ?? {})])),
    }])),
  };
}
